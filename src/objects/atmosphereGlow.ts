import * as THREE from 'three'

// Airlight up the bore: a soft, sky-tinted additive glow parked on the +Y axis
// (toward the sun end), so looking along the colony you see the air column
// catching sunlight — luminous atmospheric depth rather than a flat fade. It is
// tinted by the current sky grade (warm at dusk, blue by day) and dims at night.
// It belongs to the inertial sky (sits on the spin axis, invariant to the frame).

const GLOW_AXIAL_FRACTION = 0.32 // how far up the half-length toward the sun
const GLOW_SIZE_FRACTION = 1.8 // sprite size as a fraction of the radius

const buildGlowTexture = (): THREE.Texture | null => {
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
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  // A very soft falloff so it reads as haze, not a disc.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.18)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class AtmosphereGlow {
  readonly group = new THREE.Group()

  private sprite: THREE.Sprite | null = null
  private readonly material: THREE.SpriteMaterial | null
  private readonly texture: THREE.Texture | null

  constructor(dimensions: { radius: number; length: number }) {
    this.texture = buildGlowTexture()

    if (this.texture !== null) {
      this.material = new THREE.SpriteMaterial({
        map: this.texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        // Sit in the air: never writes depth (so it cannot punch a hole) but the
        // colony wall / end cap still occludes it.
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false
      })
      this.sprite = new THREE.Sprite(this.material)
      this.sprite.frustumCulled = false
      this.group.add(this.sprite)
    } else {
      this.material = null
    }

    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: { radius: number; length: number }) {
    if (this.sprite !== null) {
      const size = radius * GLOW_SIZE_FRACTION
      this.sprite.scale.set(size, size, 1)
      this.group.position.set(0, length * 0.5 * GLOW_AXIAL_FRACTION, 0)
    }
  }

  // Tint with the sky-grade colour and fade with the day (faint at night).
  setGrade(color: THREE.Color, intensity: number) {
    if (this.material !== null) {
      this.material.color.copy(color)
      this.material.opacity = Math.max(0, intensity)
    }
  }

  dispose() {
    if (this.sprite !== null) {
      this.group.remove(this.sprite)
    }

    this.material?.dispose()
    this.texture?.dispose()
    this.sprite = null
  }
}
