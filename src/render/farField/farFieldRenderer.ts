import * as THREE from 'three'

import { resolveFarFieldLodProfile, type FarFieldLodProfile } from './farFieldLod'
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

export type FarFieldDebugSnapshot = {
  enabled: boolean
  layerCount: number
  textureSize: number
  radialSegments: number
}

type FarFieldLayer = {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
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

export const getFarFieldThetaStart = (arcRadians: number) =>
  Math.PI * 1.5 - arcRadians * 0.5

export const createFarFieldSignature = (
  settings: FarFieldSettings,
  habitat: FarFieldHabitatState,
  profile: FarFieldLodProfile
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
    textureSize: profile.textureSize,
    effectiveLayers: profile.layerCount,
    radialSegments: profile.radialSegments,
    heightSegments: profile.heightSegments,
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
  private currentProfile: FarFieldLodProfile = {
    layerCount: 1,
    textureSize: 256,
    radialSegments: 40,
    heightSegments: 4,
    refreshInterval_s: 0
  }

  constructor(
    scene: THREE.Scene | THREE.Group,
    private readonly getSettings: () => FarFieldSettings,
    private readonly getHabitat: () => FarFieldHabitatState,
    private readonly getRuntime: () => { xrActive: boolean; devicePixelRatio: number } = () => ({
      xrActive: false,
      devicePixelRatio: 1
    })
  ) {
    scene.add(this.group)
    this.group.renderOrder = 1
  }

  sync() {
    const settings = this.getSettings()
    this.currentProfile = resolveFarFieldLodProfile(settings, this.getRuntime())
    const signature = createFarFieldSignature(
      settings,
      this.getHabitat(),
      this.currentProfile
    )

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
    const layerCount = this.currentProfile.layerCount
    const clampedBandHeight = Math.min(settings.bandHeight_m, habitat.span * 0.9)
    const arcRadians = THREE.MathUtils.degToRad(settings.bandArc_deg)
    const thetaStart = getFarFieldThetaStart(arcRadians)
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
        this.currentProfile.radialSegments,
        this.currentProfile.heightSegments,
        true,
        thetaStart,
        arcRadians
      )
      const { canvas, context } = createCanvas(this.currentProfile.textureSize)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color().setScalar(
          resolvedMode === 'night' ? Math.max(0.25, settings.intensity) : 1
        ),
        side: THREE.BackSide,
        fog: false,
        toneMapped: false
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
      this.currentProfile.refreshInterval_s <= 0 ||
      this.layers.length === 0
    ) {
      return
    }

    this.elapsedSinceRefresh += Math.max(0, deltaSeconds)

    if (this.elapsedSinceRefresh < this.currentProfile.refreshInterval_s) {
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

  getDebugSnapshot(): FarFieldDebugSnapshot {
    return {
      enabled: this.group.visible,
      layerCount: this.layers.length,
      textureSize: this.currentProfile.textureSize,
      radialSegments: this.currentProfile.radialSegments
    }
  }

  private repaintTextures(mode: Exclude<FarFieldMode, 'auto'>) {
    const settings = this.getSettings()

    for (const [index, layer] of this.layers.entries()) {
      const plan = createFarFieldTexturePlan({
        textureSize: this.currentProfile.textureSize,
        density: settings.density,
        seed: layer.seed + this.refreshEpoch + index * 97
      })
      layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      renderFarFieldTexturePlan(layer.context, plan, mode)
      layer.texture.needsUpdate = true
      layer.mesh.material.color.setScalar(
        mode === 'night' ? Math.max(0.25, settings.intensity) : 1
      )
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
