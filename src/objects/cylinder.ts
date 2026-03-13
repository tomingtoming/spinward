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

  private shell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null = null
  private guides = new THREE.Group()
  private startMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null

  constructor(dimensions: CylinderDimensions) {
    this.group.add(this.guides)
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

    this.rebuildGuides(radius, length)
    this.rebuildStartMarker(radius)
  }

  private rebuildGuides(radius: number, length: number) {
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
}
