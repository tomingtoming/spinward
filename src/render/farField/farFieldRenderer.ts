import * as THREE from 'three'

import {
  createFarFieldTexturePlan,
  renderFarFieldTexturePlan
} from './farFieldTexture'
import {
  resolveFarFieldMode,
  type FarFieldMode,
  type FarFieldSettings
} from './farFieldSettings'

export type FarFieldHabitatState = {
  radius: number
  span: number
  presetId: string
}

type FarFieldLayer = {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  seed: number
}

const createCanvas = (size: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for far-field rendering')
  }

  return { canvas, context }
}

const disableRaycast = () => undefined

export const createFarFieldSignature = (
  settings: FarFieldSettings,
  habitat: FarFieldHabitatState
) =>
  JSON.stringify({
    enabled: settings.enabled,
    mode: settings.mode,
    intensity: settings.intensity,
    density: settings.density,
    bandHeight_m: settings.bandHeight_m,
    bandArc_deg: settings.bandArc_deg,
    parallaxLayers: settings.parallaxLayers,
    parallaxOffset_m: settings.parallaxOffset_m,
    textureSize: settings.textureSize,
    presetId: habitat.presetId,
    radius: habitat.radius,
    span: habitat.span
  })

export class FarFieldRenderer {
  readonly group = new THREE.Group()

  private readonly layers: FarFieldLayer[] = []
  private elapsedSinceRefresh = 0
  private refreshEpoch = 0
  private lastSignature: string | null = null

  constructor(
    scene: THREE.Scene | THREE.Group,
    private readonly getSettings: () => FarFieldSettings,
    private readonly getHabitat: () => FarFieldHabitatState
  ) {
    scene.add(this.group)
    this.group.renderOrder = 1
  }

  sync() {
    const signature = createFarFieldSignature(this.getSettings(), this.getHabitat())

    if (signature === this.lastSignature) {
      return
    }

    this.lastSignature = signature
    this.rebuild()
  }

  rebuild() {
    const settings = this.getSettings()
    const habitat = this.getHabitat()
    this.disposeLayers()
    this.group.visible = settings.enabled

    if (!settings.enabled) {
      return
    }

    const resolvedMode = resolveFarFieldMode(settings.mode, habitat.presetId)
    const layerCount = settings.parallaxLayers
    const clampedBandHeight = Math.min(settings.bandHeight_m, habitat.span * 0.9)
    const arcRadians = THREE.MathUtils.degToRad(settings.bandArc_deg)
    const thetaStart = Math.PI - arcRadians * 0.5
    const baseInset = Math.max(12, settings.parallaxOffset_m * 0.3)

    for (let index = 0; index < layerCount; index += 1) {
      const layerRadius = Math.max(
        4,
        habitat.radius - baseInset - index * settings.parallaxOffset_m
      )
      const geometry = new THREE.CylinderGeometry(
        layerRadius,
        layerRadius,
        clampedBandHeight,
        64,
        8,
        true,
        thetaStart,
        arcRadians
      )
      const { canvas, context } = createCanvas(settings.textureSize)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: resolvedMode === 'night' ? new THREE.Color(0xf8fafc) : new THREE.Color(0x000000),
        emissiveIntensity: resolvedMode === 'night' ? settings.intensity : 0,
        color: resolvedMode === 'day' ? new THREE.Color(0xcbd5e1) : new THREE.Color(0x1f2937),
        roughness: 1,
        metalness: 0,
        side: THREE.BackSide,
        fog: false
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.raycast = disableRaycast
      this.group.add(mesh)
      this.layers.push({
        mesh,
        canvas,
        context,
        texture,
        seed: this.computeSeed(index, habitat.presetId)
      })
    }

    this.repaintTextures(resolvedMode)
  }

  update(deltaSeconds: number) {
    const settings = this.getSettings()

    if (
      !settings.enabled ||
      settings.updateInterval_s <= 0 ||
      this.layers.length === 0
    ) {
      return
    }

    this.elapsedSinceRefresh += Math.max(0, deltaSeconds)

    if (this.elapsedSinceRefresh < settings.updateInterval_s) {
      return
    }

    this.elapsedSinceRefresh = 0
    this.refreshEpoch += 1
    this.repaintTextures(resolveFarFieldMode(settings.mode, this.getHabitat().presetId))
  }

  dispose() {
    this.disposeLayers()
    this.group.parent?.remove(this.group)
  }

  private repaintTextures(mode: Exclude<FarFieldMode, 'auto'>) {
    const settings = this.getSettings()

    for (const [index, layer] of this.layers.entries()) {
      const plan = createFarFieldTexturePlan({
        textureSize: settings.textureSize,
        density: settings.density,
        seed: layer.seed + this.refreshEpoch + index * 97
      })
      layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      renderFarFieldTexturePlan(layer.context, plan, mode)
      layer.texture.needsUpdate = true
      layer.mesh.material.emissiveIntensity = mode === 'night' ? settings.intensity : 0
      layer.mesh.material.needsUpdate = true
    }
  }

  private computeSeed(index: number, presetId: string) {
    let seed = 0x9e3779b9 ^ index

    for (const char of presetId) {
      seed = ((seed << 5) - seed + char.charCodeAt(0)) >>> 0
    }

    return seed
  }

  private disposeLayers() {
    this.elapsedSinceRefresh = 0

    for (const layer of this.layers.splice(0)) {
      layer.mesh.geometry.dispose()
      layer.mesh.material.dispose()
      layer.texture.dispose()
      this.group.remove(layer.mesh)
    }
  }
}
