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

export class CylinderHabitat {
  readonly group = new THREE.Group()
  readonly shellGroup = new THREE.Group()
  private readonly shellTexture = createCylinderSurfaceTexture()

  private readonly nearShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x243447,
    map: this.shellTexture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    metalness: 0.05
  })

  private readonly farShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2532,
    map: this.shellTexture,
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

  private readonly airlockFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5e7eb,
    emissive: 0x111827
  })

  private readonly airlockDoorMaterial = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    emissive: 0x0f172a,
    side: THREE.DoubleSide
  })

  private readonly beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0x78350f
  })

  private nearShell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private farShell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private readonly guides = new THREE.Group()
  private readonly landmarks = new THREE.Group()
  private startMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null
  private radius = 0
  private length = 0
  private shellFocusAzimuth = 0

  constructor(dimensions: CylinderDimensions) {
    this.group.add(this.shellGroup)
    this.group.add(this.guides)
    this.group.add(this.landmarks)
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: CylinderDimensions) {
    this.radius = radius
    this.length = length

    this.rebuildShells()

    this.rebuildGuides(radius, length)
    this.rebuildStartMarker(radius)
    this.rebuildLandmarks(radius, length)
  }

  setFocusAzimuth(focusAzimuth: number) {
    const quantizedFocus = quantizeCylinderShellFocus(focusAzimuth)

    if (quantizedFocus === this.shellFocusAzimuth) {
      return
    }

    this.shellFocusAzimuth = quantizedFocus
    this.rebuildShells()
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
    this.shellTexture.repeat.set(
      surfaceRepeat.circumferential,
      surfaceRepeat.axial
    )
    this.shellTexture.needsUpdate = true

    const shellArcs = splitCylinderShellArcs(this.shellFocusAzimuth)

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

    const airlock = new THREE.Group()
    const airlockY = -length * 0.32
    const frameDepth = 0.28
    const airlockQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0)
    )

    const door = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), this.airlockDoorMaterial)
    door.position.set(radius - 0.08, airlockY, 0)
    door.quaternion.copy(airlockQuaternion)
    airlock.add(door)

    const frameParts = [
      { size: new THREE.Vector3(8.4, 0.26, frameDepth), offset: new THREE.Vector3(radius - 0.04, airlockY + 4, 0) },
      { size: new THREE.Vector3(8.4, 0.26, frameDepth), offset: new THREE.Vector3(radius - 0.04, airlockY - 4, 0) },
      { size: new THREE.Vector3(0.26, 8.4, frameDepth), offset: new THREE.Vector3(radius - 0.04, airlockY, 4) },
      { size: new THREE.Vector3(0.26, 8.4, frameDepth), offset: new THREE.Vector3(radius - 0.04, airlockY, -4) }
    ]

    for (const framePart of frameParts) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(framePart.size.x, framePart.size.y, framePart.size.z),
        this.airlockFrameMaterial
      )
      mesh.position.copy(framePart.offset)
      mesh.quaternion.copy(airlockQuaternion)
      airlock.add(mesh)
    }

    const beaconOffsets = [
      new THREE.Vector3(radius - 0.12, airlockY + 4.4, 4.35),
      new THREE.Vector3(radius - 0.12, airlockY + 4.4, -4.35)
    ]

    for (const offset of beaconOffsets) {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), this.beaconMaterial)
      beacon.position.copy(offset)
      airlock.add(beacon)
    }

    this.landmarks.add(airlock)
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
