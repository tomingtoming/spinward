import * as THREE from 'three'
import {
  ISLAND_THREE_TOPOLOGY,
  type HabitatTopology
} from '../sim/habitatConfig'
import { getWindowArcs } from './cityLayout'
import {
  createCylinderSurfaceTexture,
  getCylinderSurfaceRepeat
} from './cylinderSurface'

type CylinderDimensions = {
  radius: number
  length: number
  topology?: HabitatTopology
}

type CylinderShellArc = {
  thetaStart: number
  arcRadians: number
}

export type ArcInterval = {
  start: number
  length: number
}

export const mergeBufferGeometries = (
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry | null => {
  if (geometries.length === 0) return null

  let totalPositions = 0
  let totalIndices = 0

  for (const g of geometries) {
    const pos = g.getAttribute('position')
    if (pos === undefined) return null
    totalPositions += pos.count
    totalIndices += g.index !== null ? g.index.count : pos.count
  }

  const positions = new Float32Array(totalPositions * 3)
  const normals = new Float32Array(totalPositions * 3)
  const hasAllUvs = geometries.every((g) => g.getAttribute('uv') !== undefined)
  const uvs = hasAllUvs ? new Float32Array(totalPositions * 2) : null
  const indices = new Uint32Array(totalIndices)
  let positionOffset = 0
  let indexOffset = 0
  let vertexOffset = 0

  for (const g of geometries) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const norm = g.getAttribute('normal') as THREE.BufferAttribute | undefined
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined

    for (let i = 0; i < pos.count * 3; i++) {
      positions[positionOffset + i] = pos.array[i]
    }
    if (norm !== undefined) {
      for (let i = 0; i < norm.count * 3; i++) {
        normals[positionOffset + i] = norm.array[i]
      }
    }
    if (uvs !== null && uv !== undefined) {
      for (let i = 0; i < uv.count * 2; i++) {
        uvs[vertexOffset * 2 + i] = uv.array[i]
      }
    }

    if (g.index !== null) {
      for (let i = 0; i < g.index.count; i++) {
        indices[indexOffset + i] = g.index.array[i] + vertexOffset
      }
      indexOffset += g.index.count
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[indexOffset + i] = i + vertexOffset
      }
      indexOffset += pos.count
    }

    vertexOffset += pos.count
    positionOffset += pos.count * 3
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (uvs !== null) {
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}

// Subtracts hole arcs from a circular interval, returning the surviving
// sub-intervals (absolute starts, same angular space, all lengths positive).
export const subtractArcIntervals = (
  start: number,
  length: number,
  holes: ArcInterval[]
): ArcInterval[] => {
  const covered: Array<[number, number]> = []

  for (const hole of holes) {
    const relative = THREE.MathUtils.euclideanModulo(hole.start - start, fullTurn)

    // Hole begins inside the interval.
    if (relative < length) {
      covered.push([relative, Math.min(length, relative + hole.length)])
    }

    // Hole wraps across the interval start.
    const wrapped = relative - fullTurn
    if (wrapped + hole.length > 0) {
      covered.push([0, Math.min(length, wrapped + hole.length)])
    }
  }

  covered.sort((a, b) => a[0] - b[0])

  const result: ArcInterval[] = []
  let cursor = 0

  for (const [coveredStart, coveredEnd] of covered) {
    if (coveredStart > cursor + 1e-9) {
      result.push({ start: start + cursor, length: coveredStart - cursor })
    }
    cursor = Math.max(cursor, coveredEnd)
  }

  if (cursor < length - 1e-9) {
    result.push({ start: start + cursor, length: length - cursor })
  }

  return result
}

const fullTurn = Math.PI * 2
const defaultNearArcRadians = THREE.MathUtils.degToRad(140)
const defaultFocusStepRadians = THREE.MathUtils.degToRad(7.5)
const nearShellSegments = 192
const farShellSegments = 40

export const normalizeCylinderAzimuth = (azimuth: number) =>
  THREE.MathUtils.euclideanModulo(azimuth, fullTurn)

const getCylinderThetaStart = (centerAzimuth: number, arcRadians: number) =>
  THREE.MathUtils.euclideanModulo(
    Math.PI * 0.5 - centerAzimuth - arcRadians * 0.5,
    fullTurn
  )

export const splitCylinderShellArcs = (
  focusAzimuth: number,
  nearArcRadians = defaultNearArcRadians
) => {
  const normalizedFocus = normalizeCylinderAzimuth(focusAzimuth)
  const clampedNearArc = THREE.MathUtils.clamp(nearArcRadians, Math.PI / 6, fullTurn - Math.PI / 6)
  const farArcRadians = fullTurn - clampedNearArc

  return {
    near: {
      thetaStart: getCylinderThetaStart(normalizedFocus, clampedNearArc),
      arcRadians: clampedNearArc
    } satisfies CylinderShellArc,
    far: {
      thetaStart: getCylinderThetaStart(normalizedFocus + Math.PI, farArcRadians),
      arcRadians: farArcRadians
    } satisfies CylinderShellArc
  }
}

export const quantizeCylinderShellFocus = (
  focusAzimuth: number,
  stepRadians = defaultFocusStepRadians
) => {
  const normalizedFocus = normalizeCylinderAzimuth(focusAzimuth)
  return normalizeCylinderAzimuth(
    Math.round(normalizedFocus / stepRadians) * stepRadians
  )
}

export const resolveCylinderShellUvTransform = (
  totalRepeat: number,
  shellArc: CylinderShellArc
) => ({
  repeatX: totalRepeat * (shellArc.arcRadians / fullTurn),
  offsetX: THREE.MathUtils.euclideanModulo(
    totalRepeat * (shellArc.thetaStart / fullTurn),
    1
  )
})

export class CylinderHabitat {
  readonly group = new THREE.Group()
  readonly shellGroup = new THREE.Group()
  private readonly nearShellTexture = createCylinderSurfaceTexture()
  private readonly farShellTexture = createCylinderSurfaceTexture()

  // Solid ground: the land strips are opaque terrain — translucency made
  // stars bleed through the floor and read as glass. Openness lives in the
  // carved window strips instead.
  private readonly nearShellMaterial = new THREE.MeshStandardMaterial({
    color: 0xa9adb2,
    map: this.nearShellTexture,
    side: THREE.BackSide,
    roughness: 0.92,
    metalness: 0.04
  })

  private readonly farShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x8d9298,
    map: this.farShellTexture,
    side: THREE.BackSide,
    roughness: 0.95,
    metalness: 0.03
  })

  private readonly markerMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  private readonly runwayMaterial = new THREE.LineBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.72
  })

  // Outward-facing hull so the colony is opaque from space; the interior
  // shells are BackSide-only and vanish when seen from outside.
  private readonly hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x39434e,
    roughness: 0.6,
    metalness: 0.5,
    side: THREE.FrontSide
  })

  private readonly endCapMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a6478,
    emissive: 0x101a26,
    emissiveIntensity: 0.8,
    // Visible from inside the colony (the closed cap is a flat annulus).
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.4
  })

  // The air itself: scene fog only tints surfaces, so the carved windows
  // (holes to space) show stars and mirrors with zero haze and the
  // atmosphere reads as vacuum. These panes sit in the window openings and
  // apply the same exponential in-scatter — alpha = 1 - exp(-density * d) —
  // per fragment, so a window overhead across the cylinder is milky while
  // the one beside you stays clear.
  private readonly hazeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      hazeColor: { value: new THREE.Color(0x728ba0) },
      hazeDensity: { value: 0.0001 }
    },
    vertexShader: /* glsl */ `
      varying float vViewDistance;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDistance = length(mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 hazeColor;
      uniform float hazeDensity;
      varying float vViewDistance;
      void main() {
        float alpha = 1.0 - exp(-hazeDensity * vViewDistance);
        gl_FragColor = vec4(hazeColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide
  })

  private nearShell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null
  private farShell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null
  private hullShell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null
  private hazeShell: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
  private readonly landmarks = new THREE.Group()
  private startMarker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null
  private endCaps: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null
  private radius = 0
  private length = 0
  private focusAzimuth = 0
  private topology: HabitatTopology = ISLAND_THREE_TOPOLOGY

  constructor(dimensions: CylinderDimensions) {
    this.group.add(this.shellGroup)
    this.group.add(this.landmarks)
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length, topology }: CylinderDimensions) {
    this.radius = radius
    this.length = length

    if (topology !== undefined) {
      this.topology = topology
    }

    this.rebuildShells()

    this.rebuildStartMarker(radius)
    this.rebuildLandmarks(radius, length)
    this.rebuildEndCaps(radius, length)
  }

  // Both ends carry a rim ring and a central hub ring. The space between them
  // is either left open as radial docking spokes ('docking-ring' — you can see
  // stars through the gaps and drift out) or filled with a solid annulus
  // ('closed-cap' — an enclosed Island Three cylinder), keeping the central hub
  // aperture clear in both cases so the docking port still reaches the axis.
  private rebuildEndCaps(radius: number, length: number) {
    if (this.endCaps !== null) {
      this.endCaps.geometry.dispose()
      this.group.remove(this.endCaps)
      this.endCaps = null
    }

    const tube = Math.max(0.15, Math.min(radius * 0.012, length * 0.02))
    const rimRadius = radius - tube * 1.2
    const hubRadius = radius * 0.26
    const spokeLength = rimRadius - hubRadius
    const spokeCount = 8
    const closed = this.topology.endStructure === 'closed-cap'
    const geometries: THREE.BufferGeometry[] = []

    for (const endSign of [-1, 1]) {
      const y = endSign * length * 0.5

      const rim = new THREE.TorusGeometry(rimRadius, tube, 6, 48)
      rim.rotateX(Math.PI * 0.5)
      rim.translate(0, y, 0)
      geometries.push(rim)

      const hub = new THREE.TorusGeometry(hubRadius, tube, 6, 20)
      hub.rotateX(Math.PI * 0.5)
      hub.translate(0, y, 0)
      geometries.push(hub)

      if (closed) {
        // Solid annulus from the hub aperture out to the wall, closing the
        // gaps the spokes would leave open to space.
        const cap = new THREE.RingGeometry(hubRadius, radius, 64)
        cap.rotateX(Math.PI * 0.5)
        cap.translate(0, y, 0)
        geometries.push(cap)
        continue
      }

      for (let index = 0; index < spokeCount; index += 1) {
        const angle = (index / spokeCount) * fullTurn
        const spoke = new THREE.BoxGeometry(spokeLength, tube * 1.6, tube * 1.6)
        spoke.translate(hubRadius + spokeLength * 0.5, 0, 0)
        spoke.rotateY(-angle)
        spoke.translate(0, y, 0)
        geometries.push(spoke)
      }
    }

    const merged = mergeBufferGeometries(geometries)

    for (const geometry of geometries) {
      geometry.dispose()
    }

    if (merged === null) {
      return
    }

    this.endCaps = new THREE.Mesh(merged, this.endCapMaterial)
    this.group.add(this.endCaps)
  }

  setFocusAzimuth(focusAzimuth: number) {
    // The window cutouts are fixed in the colony frame, so the high-detail
    // arc is rebuilt at quantized focus steps instead of rotating the group.
    const quantized = quantizeCylinderShellFocus(focusAzimuth)

    if (quantized === this.focusAzimuth) {
      return
    }

    this.focusAzimuth = quantized
    this.rebuildShells()
  }

  // One shell mesh from a set of azimuth intervals. UVs are baked in absolute
  // angular space so every interval samples the shared texture seamlessly.
  private buildShellGeometry(
    intervals: ArcInterval[],
    segmentsPerRadian: number,
    circumferentialRepeat: number,
    axialRepeat: number,
    shellRadius = this.radius
  ) {
    const parts: THREE.BufferGeometry[] = []

    for (const interval of intervals) {
      if (interval.length <= 1e-6) {
        continue
      }

      const thetaStart = getCylinderThetaStart(
        interval.start + interval.length * 0.5,
        interval.length
      )
      const part = new THREE.CylinderGeometry(
        shellRadius,
        shellRadius,
        this.length,
        Math.max(4, Math.ceil(segmentsPerRadian * interval.length)),
        1,
        true,
        thetaStart,
        interval.length
      )
      const uv = part.getAttribute('uv') as THREE.BufferAttribute

      for (let i = 0; i < uv.count; i += 1) {
        const theta = thetaStart + uv.getX(i) * interval.length
        uv.setXY(
          i,
          (theta / fullTurn) * circumferentialRepeat,
          uv.getY(i) * axialRepeat
        )
      }

      parts.push(part)
    }

    const merged = mergeBufferGeometries(parts)

    for (const part of parts) {
      part.dispose()
    }

    return merged
  }

  private rebuildShells() {
    this.nearShell?.geometry.dispose()
    this.farShell?.geometry.dispose()

    this.hullShell?.geometry.dispose()
    this.hazeShell?.geometry.dispose()

    if (this.nearShell !== null) {
      this.shellGroup.remove(this.nearShell)
    }

    if (this.farShell !== null) {
      this.shellGroup.remove(this.farShell)
    }

    if (this.hullShell !== null) {
      this.shellGroup.remove(this.hullShell)
    }

    if (this.hazeShell !== null) {
      this.shellGroup.remove(this.hazeShell)
    }

    const surfaceRepeat = getCylinderSurfaceRepeat(this.radius, this.length)
    this.nearShellTexture.repeat.set(1, 1)
    this.nearShellTexture.offset.set(0, 0)
    this.nearShellTexture.needsUpdate = true
    this.farShellTexture.repeat.set(1, 1)
    this.farShellTexture.offset.set(0, 0)
    this.farShellTexture.needsUpdate = true

    const windowHoles: ArcInterval[] = getWindowArcs(this.topology).map((arc) => ({
      start: arc.centerAzimuth - arc.arcRadians * 0.5,
      length: arc.arcRadians
    }))
    const farArcRadians = fullTurn - defaultNearArcRadians
    const nearIntervals = subtractArcIntervals(
      this.focusAzimuth - defaultNearArcRadians * 0.5,
      defaultNearArcRadians,
      windowHoles
    )
    const farIntervals = subtractArcIntervals(
      this.focusAzimuth + defaultNearArcRadians * 0.5,
      farArcRadians,
      windowHoles
    )

    const nearGeometry = this.buildShellGeometry(
      nearIntervals,
      nearShellSegments / defaultNearArcRadians,
      surfaceRepeat.circumferential,
      surfaceRepeat.axial
    )
    const farGeometry = this.buildShellGeometry(
      farIntervals,
      farShellSegments / farArcRadians,
      surfaceRepeat.circumferential,
      surfaceRepeat.axial
    )

    if (farGeometry !== null) {
      this.farShell = new THREE.Mesh(farGeometry, this.farShellMaterial)
      this.shellGroup.add(this.farShell)
    } else {
      this.farShell = null
    }

    if (nearGeometry !== null) {
      this.nearShell = new THREE.Mesh(nearGeometry, this.nearShellMaterial)
      this.shellGroup.add(this.nearShell)
    } else {
      this.nearShell = null
    }

    // One coarse outward-facing hull over the full land arcs (windows stay
    // open), slightly outside the floor so it never z-fights the interior.
    const hullGeometry = this.buildShellGeometry(
      [...nearIntervals, ...farIntervals],
      farShellSegments / farArcRadians,
      1,
      1,
      this.radius + Math.max(0.5, this.radius * 0.001)
    )

    if (hullGeometry !== null) {
      this.hullShell = new THREE.Mesh(hullGeometry, this.hullMaterial)
      this.shellGroup.add(this.hullShell)
    } else {
      this.hullShell = null
    }

    // Atmosphere panes over the window openings, just inside the wall.
    const hazeGeometry = this.buildShellGeometry(
      windowHoles,
      farShellSegments / farArcRadians,
      1,
      1,
      this.radius - Math.max(0.5, this.radius * 0.001)
    )

    if (hazeGeometry !== null) {
      this.hazeShell = new THREE.Mesh(hazeGeometry, this.hazeMaterial)
      this.shellGroup.add(this.hazeShell)
    } else {
      this.hazeShell = null
    }
  }

  // Keeps the window haze in sync with the scene fog each frame.
  setAtmosphere(color: THREE.Color, density: number) {
    ;(this.hazeMaterial.uniforms.hazeColor.value as THREE.Color).copy(color)
    this.hazeMaterial.uniforms.hazeDensity.value = density
  }


  private rebuildStartMarker(radius: number) {
    if (this.startMarker !== null) {
      this.startMarker.geometry.dispose()
      this.group.remove(this.startMarker)
    }

    // Subtle pavement inlay at the spawn instead of the old blue billboard.
    this.startMarker = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.1, 40), this.markerMaterial)
    this.startMarker.position.set(radius - 0.08, 0, 0)
    this.startMarker.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0)
    )
    this.group.add(this.startMarker)
  }

  private rebuildLandmarks(radius: number, length: number) {
    this.disposeGroupGeometries(this.landmarks)
    this.landmarks.clear()

    const runwayAngles = [-0.18, 0, 0.18]

    for (const angle of runwayAngles) {
      const points = [
        new THREE.Vector3(Math.cos(angle) * radius, -length / 2, Math.sin(angle) * radius),
        new THREE.Vector3(Math.cos(angle) * radius, length / 2, Math.sin(angle) * radius)
      ]
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        this.runwayMaterial
      )
      this.landmarks.add(line)
    }
  }

  private disposeGroupGeometries(group: THREE.Group) {
    for (const child of group.children) {
      const disposable = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry
      }
      disposable.geometry?.dispose()

      if (child instanceof THREE.Group) {
        this.disposeGroupGeometries(child)
      }
    }
  }
}
