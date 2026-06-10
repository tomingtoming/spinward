import * as THREE from 'three'
import {
  createCylinderSurfaceTexture,
  getCylinderSurfaceRepeat
} from './cylinderSurface'

type CylinderDimensions = {
  radius: number
  length: number
}

type CylinderShellArc = {
  thetaStart: number
  arcRadians: number
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
  const indices = new Uint32Array(totalIndices)
  let positionOffset = 0
  let indexOffset = 0
  let vertexOffset = 0

  for (const g of geometries) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const norm = g.getAttribute('normal') as THREE.BufferAttribute | undefined

    for (let i = 0; i < pos.count * 3; i++) {
      positions[positionOffset + i] = pos.array[i]
    }
    if (norm !== undefined) {
      for (let i = 0; i < norm.count * 3; i++) {
        normals[positionOffset + i] = norm.array[i]
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
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
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

  private readonly nearShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x243447,
    map: this.nearShellTexture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    metalness: 0.05
  })

  private readonly farShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2532,
    map: this.farShellTexture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.84,
    roughness: 0.95,
    metalness: 0.03
  })

  private readonly guideMaterial = new THREE.LineBasicMaterial({
    color: 0x6ee7f9,
    transparent: true,
    opacity: 0.28
  })

  private readonly markerMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x0f1f3d,
    side: THREE.DoubleSide
  })

  private readonly runwayMaterial = new THREE.LineBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.72
  })

  private readonly ribMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a556a,
    emissive: 0x0e1e2d,
    roughness: 0.8,
    metalness: 0.3,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
    depthWrite: false
  })

  private nearShell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private farShell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private readonly guides = new THREE.Group()
  private readonly landmarks = new THREE.Group()
  private readonly ribs = new THREE.Group()
  private startMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null
  private radius = 0
  private length = 0

  constructor(dimensions: CylinderDimensions) {
    this.group.add(this.shellGroup)
    this.group.add(this.guides)
    this.group.add(this.ribs)
    this.group.add(this.landmarks)
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: CylinderDimensions) {
    this.radius = radius
    this.length = length

    this.rebuildShells()

    this.rebuildGuides(radius, length)
    this.rebuildRibs(radius, length)
    this.rebuildStartMarker(radius)
    this.rebuildLandmarks(radius, length)
  }

  setFocusAzimuth(focusAzimuth: number) {
    this.shellGroup.rotation.y = focusAzimuth
  }


  private rebuildShells() {
    this.nearShell?.geometry.dispose()
    this.farShell?.geometry.dispose()

    if (this.nearShell !== null) {
      this.shellGroup.remove(this.nearShell)
    }

    if (this.farShell !== null) {
      this.shellGroup.remove(this.farShell)
    }

    const surfaceRepeat = getCylinderSurfaceRepeat(this.radius, this.length)

    const shellArcs = splitCylinderShellArcs(0)
    const nearSurfaceUv = resolveCylinderShellUvTransform(
      surfaceRepeat.circumferential,
      shellArcs.near
    )
    const farSurfaceUv = resolveCylinderShellUvTransform(
      surfaceRepeat.circumferential,
      shellArcs.far
    )
    this.nearShellTexture.repeat.set(nearSurfaceUv.repeatX, surfaceRepeat.axial)
    this.nearShellTexture.offset.set(nearSurfaceUv.offsetX, 0)
    this.nearShellTexture.needsUpdate = true
    this.farShellTexture.repeat.set(farSurfaceUv.repeatX, surfaceRepeat.axial)
    this.farShellTexture.offset.set(farSurfaceUv.offsetX, 0)
    this.farShellTexture.needsUpdate = true

    this.nearShell = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius,
        this.radius,
        this.length,
        nearShellSegments,
        1,
        true,
        shellArcs.near.thetaStart,
        shellArcs.near.arcRadians
      ),
      this.nearShellMaterial
    )
    this.farShell = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius,
        this.radius,
        this.length,
        farShellSegments,
        1,
        true,
        shellArcs.far.thetaStart,
        shellArcs.far.arcRadians
      ),
      this.farShellMaterial
    )

    this.shellGroup.add(this.farShell)
    this.shellGroup.add(this.nearShell)
  }


  private rebuildRibs(radius: number, length: number) {
    this.disposeGroupGeometries(this.ribs)
    this.ribs.clear()

    const ribRadius = Math.max(0.5, radius - 0.06)
    const ribThickness = Math.min(1.5, Math.max(0.12, radius * 0.003))
    const ribCount = Math.min(5, Math.max(3, Math.round(length / (radius * 0.8))))
    const ribSpacing = length / (ribCount + 1)

    // Merge all ribs into a single geometry to avoid per-rib draw calls
    const singleRib = new THREE.TorusGeometry(ribRadius, ribThickness, 4, 48)
    singleRib.rotateX(Math.PI * 0.5)

    const matrices: THREE.Matrix4[] = []

    for (let i = 1; i <= ribCount; i++) {
      const y = -length * 0.5 + ribSpacing * i
      matrices.push(new THREE.Matrix4().makeTranslation(0, y, 0))
    }

    const ribGeometries = matrices.map((matrix) => {
      const clone = singleRib.clone()
      clone.applyMatrix4(matrix)
      return clone
    })

    if (ribGeometries.length > 0) {
      const mergedGeometry = mergeBufferGeometries(ribGeometries)
      if (mergedGeometry !== null) {
        const mesh = new THREE.Mesh(mergedGeometry, this.ribMaterial)
        this.ribs.add(mesh)
      }
    }

    singleRib.dispose()
    for (const g of ribGeometries) g.dispose()
  }

  private rebuildGuides(radius: number, length: number) {
    this.disposeGroupGeometries(this.guides)
    this.guides.clear()

    const ringCount = 9
    const verticalCount = 24

    for (let index = 0; index < ringCount; index += 1) {
      const y = -length / 2 + (length / (ringCount - 1)) * index
      const points: THREE.Vector3[] = []

      for (let segment = 0; segment <= 64; segment += 1) {
        const angle = (segment / 64) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius))
      }

      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        this.guideMaterial
      )
      this.guides.add(ring)
    }

    for (let index = 0; index < verticalCount; index += 1) {
      const angle = (index / verticalCount) * Math.PI * 2
      const points = [
        new THREE.Vector3(Math.cos(angle) * radius, -length / 2, Math.sin(angle) * radius),
        new THREE.Vector3(Math.cos(angle) * radius, length / 2, Math.sin(angle) * radius)
      ]
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        this.guideMaterial
      )
      this.guides.add(line)
    }
  }

  private rebuildStartMarker(radius: number) {
    if (this.startMarker !== null) {
      this.startMarker.geometry.dispose()
      this.group.remove(this.startMarker)
    }

    this.startMarker = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), this.markerMaterial)
    this.startMarker.position.set(radius - 0.04, 0, 0)
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
