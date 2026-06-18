import * as THREE from 'three'

import { computeStarShellRadius } from './starfield'

// The colony's spin (and length) axis is world +Y. The spaceport hub always
// sits on the -Y end (getSpaceportDimensions: hubCenterY = -length / 2), so the
// end *without* a port is +Y. Parking the sun on +Y is what makes the
// spaceport-free end face the sun for every preset — and because the colony
// only ever spins about Y (and the observer modes only roll worldRoot about Y),
// the sun stays fixed on that axis no matter the frame angle. No per-frame
// re-aiming is needed: the geometry does the pointing.
export const SUN_DIRECTION = Object.freeze(new THREE.Vector3(0, 1, 0))

type SunDimensions = {
  radius: number
  length: number
}

// Sit just inside the star shell so the sun reads as the most distant object
// without clipping the camera far plane (which tracks the shell at 1.25x).
const SUN_SHELL_FRACTION = 0.92

// Sprite world size as a fraction of the sun's distance, so its angular size on
// screen stays constant across the huge range of habitat scales.
const SUN_CORE_SIZE = 0.05
const SUN_GLOW_SIZE = 0.2

// Distance from the colony center to the visible sun, for a given habitat.
export const getSunDistance = (radius: number, length: number) =>
  computeStarShellRadius(radius, length) * SUN_SHELL_FRACTION

// Sun position in colony space: straight up the +Y axis, the spaceport-free end.
export const getSunPosition = (
  radius: number,
  length: number,
  target = new THREE.Vector3()
) => target.set(0, getSunDistance(radius, length), 0)

// Window sunlight rakes in from the +Y (sun) end as well as radially inward, so
// the interior shading agrees with where the sun visibly hangs. The radial span
// is kept (it sets which strip is lit / how the floor reads); the +Y lift only
// adds a downward component, which tilts the light off Y-facing surfaces
// (building tops, end caps, terrain) without touching the purely-radial floor.
export const WINDOW_SUN_RADIAL = 10
export const WINDOW_SUN_LIFT = 5

export const getWindowSunPosition = (
  centerAzimuth: number,
  target = new THREE.Vector3()
) =>
  target.set(
    Math.cos(centerAzimuth) * WINDOW_SUN_RADIAL,
    WINDOW_SUN_LIFT,
    Math.sin(centerAzimuth) * WINDOW_SUN_RADIAL
  )

// Soft radial-gradient disc used for both the core and the glow halo. White at
// the center fading to transparent, so additive blending stacks into a warm
// bloom. Returns null where there is no DOM (e.g. headless test/SSR); callers
// skip the sprite rather than crash.
const buildSunTexture = (
  innerStop: number,
  midColor: string
): THREE.Texture | null => {
  if (typeof document === 'undefined') {
    return null
  }

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    return null
  }

  const center = size / 2
  const gradient = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center
  )
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(innerStop, midColor)
  gradient.addColorStop(1, 'rgba(255, 196, 120, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// The visible sun: a bright billboarded core wrapped in a softer glow halo,
// parked on the +Y axis among the far stars. It belongs to the inertial sky,
// not the rotating colony, but sitting on the spin axis it is invariant to the
// frame angle either way.
export class Sun {
  readonly group = new THREE.Group()

  private readonly sprites: THREE.Sprite[] = []
  private readonly textures: THREE.Texture[] = []
  private readonly materials: THREE.SpriteMaterial[] = []
  private coreSprite: THREE.Sprite | null = null
  private glowSprite: THREE.Sprite | null = null
  private distance = 0

  constructor(dimensions: SunDimensions) {
    this.glowSprite = this.buildSprite(
      buildSunTexture(0.35, 'rgba(255, 214, 150, 0.55)'),
      0xffdca0,
      0.85
    )
    this.coreSprite = this.buildSprite(
      buildSunTexture(0.5, 'rgba(255, 240, 214, 0.95)'),
      0xfff4e2,
      1
    )
    this.setDimensions(dimensions)
  }

  private buildSprite(
    texture: THREE.Texture | null,
    color: number,
    opacity: number
  ): THREE.Sprite | null {
    if (texture === null) {
      return null
    }

    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      // Far behind everything: never write depth (so it can't punch a hole in
      // the haze) but still let near geometry — a wall, an end cap — occlude it.
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false
    })
    const sprite = new THREE.Sprite(material)
    // The far stars cull at the shell; without this the sun would pop out of
    // view at glancing angles because its center sits near the frustum edge.
    sprite.frustumCulled = false
    this.group.add(sprite)
    this.sprites.push(sprite)
    this.materials.push(material)
    this.textures.push(texture)
    return sprite
  }

  setDimensions({ radius, length }: SunDimensions) {
    this.distance = getSunDistance(radius, length)
    this.group.position.set(0, this.distance, 0)

    if (this.coreSprite !== null) {
      const size = this.distance * SUN_CORE_SIZE
      this.coreSprite.scale.set(size, size, 1)
    }

    if (this.glowSprite !== null) {
      const size = this.distance * SUN_GLOW_SIZE
      this.glowSprite.scale.set(size, size, 1)
    }
  }

  dispose() {
    for (const sprite of this.sprites) {
      this.group.remove(sprite)
    }

    for (const material of this.materials) {
      material.dispose()
    }

    for (const texture of this.textures) {
      texture.dispose()
    }

    this.sprites.length = 0
    this.materials.length = 0
    this.textures.length = 0
    this.coreSprite = null
    this.glowSprite = null
  }
}
