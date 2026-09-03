import * as THREE from 'three'

import { kenneyPickForBuilding } from './buildingAssets'
import type { CityBuilding, CityPlan } from './cityLayout'
import {
  FACADE_LIT_CHANCE,
  KENNEY_ROOF_TONES,
  ROAD_GLOW,
  WINDOW_COOL,
  WINDOW_WARM,
  buildingTone
} from './cityscape'

// Far-field LOD stage 3 (docs/far-field-lod.md): the city baked into the
// cylinder shell as a colour field (albedo overlay) plus a night-light field
// (emissive). Beyond the angular-size cull the far batch drops buildings and
// the painted roads finish their fade — this bake returns that mass to the
// shell, so the far side never has holes. It is generated at city-build time
// from the SAME CityPlan the geometry uses and from the SAME shared palette
// (buildingTone / KENNEY_ROOF_TONES / FACADE_LIT_CHANCE), so a future facade
// restyle propagates here without touching this file.

const TWO_PI = Math.PI * 2

// The shell geometry's UVs live in three's CylinderGeometry angular space
// (x = R·sinθ, z = R·cosθ), while the city plan speaks azimuth
// (x = R·cos a, z = R·sin a): θ = π/2 − a. buildShellGeometry bakes
// uv.x = θ/2π × repeat, so with the city texture sampled at uv/repeat this
// maps an azimuth straight to the texture's U coordinate.
export const azimuthToShellU = (azimuth: number) =>
  THREE.MathUtils.euclideanModulo(Math.PI * 0.5 - azimuth, TWO_PI) / TWO_PI

// CylinderGeometry's V runs 0 at y=−L/2 (the port end) to 1 at y=+L/2, and
// CanvasTexture flips Y, so V=0 samples the canvas BOTTOM row. This returns
// the canvas-space Y fraction measured from the top row.
export const axialToShellYFraction = (axial: number, length: number) =>
  0.5 - axial / length

// Below this the whole colony fits inside the fade-in distance of the bake —
// small drums read their real geometry everywhere and need no shell city.
export const CITY_SHELL_MIN_RADIUS = 800

export type CityShellTextureSet = {
  albedo: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
}

type BakeContext = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  metersToPxX: number
  metersToPxY: number
  radius: number
  length: number
}

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }
}

const createBakeContext = (
  width: number,
  height: number,
  radius: number,
  length: number
): BakeContext => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (ctx === null) {
    throw new Error('2D canvas context is required for the city shell bake')
  }

  return {
    ctx,
    width,
    height,
    metersToPxX: width / (TWO_PI * radius),
    metersToPxY: height / length,
    radius,
    length
  }
}

// One axis-aligned surface rectangle, drawn three times (x, x±width) so
// footprints crossing the U seam wrap instead of clipping. Sizes are FULL
// extents in surface metres, centred on (azimuth, axial) — the same
// convention as CityRoad / CityPatch / parcel extents.
const bakeRect = (
  bake: BakeContext,
  azimuth: number,
  axial: number,
  tangentMeters: number,
  axialMeters: number,
  minPx = 0
) => {
  const w = Math.max(minPx, tangentMeters * bake.metersToPxX)
  const h = Math.max(minPx, axialMeters * bake.metersToPxY)
  const x = azimuthToShellU(azimuth) * bake.width - w * 0.5
  const y = axialToShellYFraction(axial, bake.length) * bake.height - h * 0.5

  for (const offset of [-bake.width, 0, bake.width]) {
    bake.ctx.fillRect(x + offset, y, w, h)
  }
}

const cssColor = (color: THREE.Color) => `#${color.getHexString()}`

const scratchColor = new THREE.Color()
const scratchColor2 = new THREE.Color()

// ── Albedo overlay ──────────────────────────────────────────────────────
// Urban ground fabric + field patches + road asphalt + building roofs, so the
// far side reads as a CITY on land even in daylight, not boxes on a lawn.

const FARM_TONES = ['#9a9a52', '#8f9a48', '#a3924b', '#7f8f45']
const PARK_TONE = '#557a3f'
const URBAN_FABRIC_TONE = '#8c8d86'
const ARTERIAL_TONE = '#585a5e'
const LOCAL_TONE = '#606268'
const EXPRESSWAY_TONE = '#4a4c52'

const bakeAlbedo = (bake: BakeContext, plan: CityPlan) => {
  const { ctx } = bake
  const random = createSeededRandom(0x51ab7e01)
  ctx.clearRect(0, 0, bake.width, bake.height)

  // Field patches first: farms give the frontier its crop mosaic, parks stay
  // a deeper green than the wild mottling.
  for (const patch of plan.patches) {
    if (patch.kind === 'farm') {
      ctx.fillStyle = FARM_TONES[Math.floor(random() * FARM_TONES.length)]
      ctx.globalAlpha = 0.4 + random() * 0.25
    } else {
      ctx.fillStyle = PARK_TONE
      ctx.globalAlpha = 0.45
    }
    bakeRect(bake, patch.azimuth, patch.axial, patch.tangentExtent, patch.axialExtent)
  }

  // Parcel fabric under the buildings: fuses the lots into continuous urban
  // ground the way real blocks read from altitude.
  for (const building of plan.buildings) {
    const urban = building.urban ?? 0.4
    ctx.fillStyle = URBAN_FABRIC_TONE
    ctx.globalAlpha = 0.22 + urban * 0.26
    if (building.parcel !== undefined) {
      bakeRect(
        bake,
        building.azimuth + building.parcel.tangentOffset / bake.radius,
        building.axial + building.parcel.axialOffset,
        building.parcel.tangentExtent,
        building.parcel.axialExtent
      )
    } else {
      bakeRect(bake, building.azimuth, building.axial, building.width * 1.7, building.depth * 1.7)
    }
  }

  // Roads on top of the fabric. Alleys stay unpainted here exactly like the
  // painted far-road pipeline: the glow grid is the arterial/local signature.
  for (const road of plan.roads) {
    if (road.kind === 'alley') {
      continue
    }
    ctx.fillStyle = road.kind === 'arterial' ? ARTERIAL_TONE : LOCAL_TONE
    ctx.globalAlpha = road.kind === 'arterial' ? 0.55 : 0.4
    bakeRect(bake, road.azimuth, road.axial, road.tangentWidth, road.axialLength, 1)
  }

  if (plan.expressway !== null) {
    ctx.fillStyle = EXPRESSWAY_TONE
    ctx.globalAlpha = 0.6
    ctx.fillRect(
      0,
      axialToShellYFraction(plan.expressway.axial, bake.length) * bake.height -
        (plan.expressway.deckWidth * bake.metersToPxY) * 0.5,
      bake.width,
      Math.max(1, plan.expressway.deckWidth * bake.metersToPxY)
    )
  }

  // Building roofs from the shared kit palette, nudged toward the wall tone so
  // grazing views agree with the far-batch boxes.
  for (const building of plan.buildings) {
    const roof = KENNEY_ROOF_TONES[kenneyPickForBuilding(building).set]
    scratchColor.copy(roof).lerp(buildingTone(building, scratchColor2), 0.25)
    ctx.fillStyle = cssColor(scratchColor)
    ctx.globalAlpha = 0.85
    bakeRect(bake, building.azimuth, building.axial, building.width, building.depth, 1)
  }

  if (plan.tower !== null) {
    ctx.fillStyle = '#9aa2ac'
    ctx.globalAlpha = 0.9
    bakeRect(
      bake,
      plan.tower.azimuth,
      plan.tower.axial,
      plan.tower.deckRadius * 2,
      plan.tower.deckRadius * 2,
      1
    )
  }

  if (plan.landmark !== null) {
    ctx.fillStyle = '#b9bcb2'
    ctx.globalAlpha = 0.9
    bakeRect(
      bake,
      plan.landmark.azimuth,
      plan.landmark.axial,
      plan.landmark.domeRadius * 2,
      plan.landmark.domeRadius * 2,
      1
    )
  }

  ctx.globalAlpha = 1
}

// ── Emissive night field ────────────────────────────────────────────────
// The glow grid (arterial/local/expressway) plus one lit-window blob per lit
// building. Relative brightness between roads and windows is baked into the
// texel alpha; the day/night curve is a single uniform on the shell material.

const shellWindowGain = (building: CityBuilding) => {
  switch (building.kind) {
    case 'house':
      return 0.5
    case 'tower':
      return 1
    case 'slab':
      return 0.9
    default:
      return 0.75
  }
}

// Texel alpha of the baked road glow at scale 1, relative to the lit-window
// blobs (shellWindowGain ≤ 1). These are the pre-2026-09-02 values; the
// default `roadGlowScale` below halves them. 定点 B60_night / A_night at
// scale 1: the overhead island read as a Tron lattice and the mid-distance
// arterials bloomed to white — the grid outshone the city it was meant to
// carry. `?grid=<scale>` restores any value on device (`?grid=1` = old look).
export const SHELL_ROAD_CORE_ALPHA = { arterial: 0.7, local: 0.26, expressway: 0.95 } as const
export const SHELL_ROAD_HALO_ALPHA = { arterial: 0.14, local: 0.05, expressway: 0.25 } as const
export const DEFAULT_SHELL_ROAD_GLOW_SCALE = 0.5

export const resolveShellRoadGlowScale = (
  urlValue: string | null,
  defaultScale: number = DEFAULT_SHELL_ROAD_GLOW_SCALE
): number => {
  if (urlValue === null || urlValue.trim() === '') {
    return defaultScale
  }
  const parsed = Number(urlValue)
  if (!Number.isFinite(parsed)) {
    return defaultScale
  }
  return Math.min(2, Math.max(0, parsed))
}

const bakeEmissive = (bake: BakeContext, plan: CityPlan, roadGlowScale: number) => {
  const { ctx } = bake
  const random = createSeededRandom(0x9e11ba25)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, bake.width, bake.height)

  const roadGlow = cssColor(ROAD_GLOW)

  // Soft halo pass then core pass: the mip chain turns this into the diffuse
  // street-grid glow that carries the far city at night. The halo margin is a
  // FIXED few metres of street-lamp spill: a road's long dimension can span
  // kilometres (a full-arc avenue), so scaling the halo by the road's own
  // size would flood the whole canvas.
  const haloMargin = 24
  for (const road of plan.roads) {
    if (road.kind === 'alley') {
      continue
    }
    ctx.fillStyle = roadGlow
    ctx.globalAlpha =
      (road.kind === 'arterial' ? SHELL_ROAD_HALO_ALPHA.arterial : SHELL_ROAD_HALO_ALPHA.local) *
      roadGlowScale
    bakeRect(
      bake,
      road.azimuth,
      road.axial,
      road.tangentWidth + haloMargin,
      road.axialLength + haloMargin,
      2
    )
    ctx.globalAlpha =
      (road.kind === 'arterial' ? SHELL_ROAD_CORE_ALPHA.arterial : SHELL_ROAD_CORE_ALPHA.local) *
      roadGlowScale
    bakeRect(bake, road.azimuth, road.axial, road.tangentWidth, road.axialLength, 1)
  }

  if (plan.expressway !== null) {
    const y =
      axialToShellYFraction(plan.expressway.axial, bake.length) * bake.height
    ctx.fillStyle = roadGlow
    ctx.globalAlpha = SHELL_ROAD_HALO_ALPHA.expressway * roadGlowScale
    ctx.fillRect(0, y - Math.max(1.5, plan.expressway.deckWidth * bake.metersToPxY) * 1.5, bake.width, Math.max(3, plan.expressway.deckWidth * bake.metersToPxY * 3))
    ctx.globalAlpha = SHELL_ROAD_CORE_ALPHA.expressway * roadGlowScale
    ctx.fillRect(0, y - Math.max(0.5, plan.expressway.deckWidth * bake.metersToPxY) * 0.5, bake.width, Math.max(1, plan.expressway.deckWidth * bake.metersToPxY))
  }

  for (const building of plan.buildings) {
    const litChance = FACADE_LIT_CHANCE * (building.industrial === true ? 0.4 : 1)
    if (random() >= litChance) {
      continue
    }

    const urban = building.urban ?? 0.4
    const oldTown = building.oldTown ?? 0
    // Windows cool toward the deep-night palette, warmed by the old town's
    // first-generation district and a per-building roll.
    scratchColor
      .copy(WINDOW_COOL)
      .lerp(WINDOW_WARM, Math.min(1, 0.2 + oldTown * 0.6 + random() * 0.3))
    const gain = shellWindowGain(building) * (0.6 + urban * 0.4)
    const heightNorm = Math.min(1, building.height / 60)

    ctx.fillStyle = cssColor(scratchColor)
    ctx.globalAlpha = gain * (0.38 + heightNorm * 0.55)
    bakeRect(bake, building.azimuth, building.axial, building.width, building.depth, 1)

    // Street-level commerce: urban non-house blocks carry the shop-band glow,
    // a beat warmer and brighter than the office windows above them.
    if (building.kind !== 'house' && building.height >= 8 && urban >= 0.55) {
      scratchColor.copy(WINDOW_WARM).lerp(ROAD_GLOW, 0.2)
      ctx.fillStyle = cssColor(scratchColor)
      ctx.globalAlpha = 0.36
      bakeRect(bake, building.azimuth, building.axial, building.width * 1.4, building.depth * 1.4, 1)
    }
  }

  if (plan.landmark !== null) {
    ctx.fillStyle = cssColor(WINDOW_WARM)
    ctx.globalAlpha = 0.5
    bakeRect(
      bake,
      plan.landmark.azimuth,
      plan.landmark.axial,
      plan.landmark.domeRadius * 2.4,
      plan.landmark.domeRadius * 2.4,
      2
    )
  }

  if (plan.tower !== null) {
    ctx.fillStyle = cssColor(WINDOW_COOL)
    ctx.globalAlpha = 0.8
    bakeRect(bake, plan.tower.azimuth, plan.tower.axial, plan.tower.deckRadius * 2, plan.tower.deckRadius * 2, 2)
  }

  ctx.globalAlpha = 1
}

const finishCityTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // U wraps around the bore; V must NOT wrap or the port end's lights would
  // bleed into the frontier farms through the mip chain.
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = 16
  return texture
}

// Bakes the city plan into the shell texture pair. `emissiveWidth` is the
// emissive canvas width in texels (the albedo runs at half that: colour
// fields blur gracefully, light grids are the detail that must survive).
// Returns null for habitats too small to need a far-field city.
export const createCityShellTextureSet = (
  plan: CityPlan,
  radius: number,
  length: number,
  emissiveWidth = 4096,
  roadGlowScale = DEFAULT_SHELL_ROAD_GLOW_SCALE
): CityShellTextureSet | null => {
  if (radius < CITY_SHELL_MIN_RADIUS || plan.buildings.length === 0) {
    return null
  }

  const emissiveBake = createBakeContext(emissiveWidth, emissiveWidth / 2, radius, length)
  const albedoBake = createBakeContext(emissiveWidth / 2, emissiveWidth / 4, radius, length)

  bakeAlbedo(albedoBake, plan)
  bakeEmissive(emissiveBake, plan, roadGlowScale)

  return {
    albedo: finishCityTexture(albedoBake.ctx.canvas),
    emissive: finishCityTexture(emissiveBake.ctx.canvas)
  }
}
