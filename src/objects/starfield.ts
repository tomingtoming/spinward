import * as THREE from 'three'

type StarfieldDimensions = {
  radius: number
  length: number
}

const shellDirection = new THREE.Vector3()

export class Starfield {
  readonly group = new THREE.Group()

  private readonly starsMaterial = new THREE.PointsMaterial({
    color: 0xe5f4ff,
    size: 0.9,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95
  })

  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
  private radius = 250

  constructor(dimensions: StarfieldDimensions) {
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: StarfieldDimensions) {
    this.radius = Math.max(250, radius * 4, length * 2.5)

    if (this.stars !== null) {
      this.stars.geometry.dispose()
      this.group.remove(this.stars)
    }

    this.stars = new THREE.Points(this.buildStarsGeometry(this.radius, 1800), this.starsMaterial)
    this.group.add(this.stars)
  }

  setFrameAngle(frameAngle: number) {
    // In the rotating frame, inertial stars appear to sweep past in the opposite direction.
    this.group.rotation.y = -frameAngle
  }

  getSuggestedCameraFar() {
    return this.radius * 1.25
  }

  private buildStarsGeometry(radius: number, count: number) {
    const positions = new Float32Array(count * 3)
    let seed = 0x5f3759df

    for (let index = 0; index < count; index += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0
      const u = seed / 0xffffffff
      seed = (1664525 * seed + 1013904223) >>> 0
      const v = seed / 0xffffffff

      const theta = u * Math.PI * 2
      const phi = Math.acos(2 * v - 1)
      shellDirection.setFromSphericalCoords(radius, phi, theta)

      const offset = index * 3
      positions[offset] = shellDirection.x
      positions[offset + 1] = shellDirection.y
      positions[offset + 2] = shellDirection.z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geometry
  }
}
