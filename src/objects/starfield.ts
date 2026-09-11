import * as THREE from 'three'

type StarfieldDimensions = {
  radius: number
  length: number
}

// Base radius of the inertial sky, large enough to sit behind the habitat.
// Observer translation expands it further without changing angular positions.
// The sun shares this scale so both remain a distant background.
export const computeStarShellRadius = (radius: number, length: number) =>
  Math.max(250, radius * 4, length * 2.5)

// Keep a viewer-centred sky behind the whole colony even when the observer is
// farther away than the original shell. Scaling both position and sprite size
// preserves angular size; translating the shell removes artificial parallax.
export const computeDistantSkyScale = (shellRadius: number, observerDistance: number) =>
  1 + 2 * observerDistance / shellRadius

const shellDirection = new THREE.Vector3()
const STAR_OPACITY_NIGHT = 0.9
const STAR_OPACITY_VACUUM = 0.6

// A display treatment, not stellar radiometry: colony daylight hides stars
// through its air, but its artificial day must not switch off the outer sky.
export const starVisibility = (daylight: number, inAir: boolean) =>
  inAir ? STAR_OPACITY_NIGHT * (1 - THREE.MathUtils.smoothstep(daylight, 0.12, 0.55)) : STAR_OPACITY_VACUUM

const createStarSprite = () => {
  const size = 32, data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1)
    const alpha = 1 - THREE.MathUtils.smoothstep(distance, 0.05, 1)
    const offset = (y * size + x) * 4
    data[offset] = data[offset + 1] = data[offset + 2] = 255
    data[offset + 3] = Math.round(alpha * 255)
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export class Starfield {
  readonly group = new THREE.Group()

  // Fixed pixel size: with world-unit attenuation, small habitats put the
  // star shell close to the camera and the stars turned into chunky dots.
  private readonly starSprite = createStarSprite()
  private readonly starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: this.starSprite,
    depthWrite: false,
    toneMapped: false,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: STAR_OPACITY_NIGHT,
    // Stars sit outside the habitat atmosphere; the interior haze must not
    // wash them out.
    fog: false
  })

  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
  private radius = 250

  constructor(dimensions: StarfieldDimensions) {
    this.group.name = 'starfield'
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: StarfieldDimensions) {
    this.radius = computeStarShellRadius(radius, length)
    this.group.scale.setScalar(1)
    this.group.position.set(0, 0, 0)

    if (this.stars !== null) {
      this.stars.geometry.dispose()
      this.group.remove(this.stars)
    }

    this.stars = new THREE.Points(this.buildStarsGeometry(this.radius, 1800), this.starsMaterial)
    this.group.add(this.stars)
  }

  // Fade the air/vacuum boundary without coupling the outer sky to the
  // colony's artificial day. Initialization may set the target immediately.
  setDaylight(daylight: number, inAir = true, deltaSeconds?: number) {
    const target = starVisibility(daylight, inAir)
    this.starsMaterial.opacity = deltaSeconds === undefined ? target
      : THREE.MathUtils.damp(this.starsMaterial.opacity, target, 7, Math.max(0, deltaSeconds))
  }

  setFrameAngle(frameAngle: number) {
    // In the rotating frame, inertial stars appear to sweep past in the opposite direction.
    this.group.rotation.y = -frameAngle
  }

  setObserverPosition(position: THREE.Vector3) {
    this.group.position.copy(position)
    this.group.scale.setScalar(computeDistantSkyScale(this.radius, position.length()))
  }

  getSuggestedCameraFar() {
    return this.radius * this.group.scale.x * 1.25
  }

  getShellRadius() {
    return this.radius
  }

  dispose() {
    this.stars?.geometry.dispose()
    this.starsMaterial.dispose()
    this.starSprite.dispose()
    this.group.removeFromParent()
  }

  private buildStarsGeometry(radius: number, count: number) {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const tint = new THREE.Color()
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
      // Independent hash keeps the original angular positions unchanged.
      let hash = Math.imul(index + 1, 0x45d9f3b) >>> 0
      hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0
      const brightness = 0.14 + 0.86 * Math.pow((hash >>> 0) / 0xffffffff, 3)
      tint.setHex(index % 7 === 0 ? 0xffefda : index % 5 === 0 ? 0xcfe2ff : 0xf3f5ff).multiplyScalar(brightness)
      tint.toArray(colors, offset)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return geometry
  }
}
