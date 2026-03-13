import * as THREE from 'three'

type CylinderDimensions = {
  radius: number
  length: number
}

export class CylinderHabitat {
  readonly group = new THREE.Group()

  private readonly shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x243447,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    metalness: 0.05
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

  private shell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private readonly guides = new THREE.Group()
  private readonly landmarks = new THREE.Group()
  private startMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null

  constructor(dimensions: CylinderDimensions) {
    this.group.add(this.guides)
    this.group.add(this.landmarks)
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: CylinderDimensions) {
    this.shell?.geometry.dispose()
    this.group.remove(this.shell ?? this.guides)

    this.shell = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 96, 1, true),
      this.shellMaterial
    )
    this.group.add(this.shell)
    this.group.add(this.guides)
    this.group.add(this.landmarks)

    this.rebuildGuides(radius, length)
    this.rebuildStartMarker(radius)
    this.rebuildLandmarks(radius, length)
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
