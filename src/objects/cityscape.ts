import * as THREE from 'three'

import {
  ISLAND_THREE_TOPOLOGY,
  type HabitatTopology,
  type HabitatType
} from '../sim/habitatConfig'
import {
  computeMirrorFrame,
  openFactorToPhi,
  reflectSun,
  swingPetal,
  type MirrorFrame
} from './mirrorOptics'
import { SUN_DIRECTION } from './sun'
import {
  buildCityCollisionIndex,
  getArterialRoadWidth,
  getCityCellSize,
  getLandArcs,
  getWindowArcs,
  planCity,
  type BuildingKind,
  type CityBuilding,
  type CityCollisionIndex,
  type CityLandmark,
  type CityPatch,
  type CityRoad,
  type CityTower,
  type CityTree
} from './cityLayout'
import { mergeBufferGeometries } from './cylinder'
import { createWindowGlassTexture } from './cylinderSurface'

type CityscapeDimensions = {
  radius: number
  length: number
  topology?: HabitatTopology
  type?: HabitatType
}

const fullTurn = Math.PI * 2

// Same azimuth -> CylinderGeometry theta conversion used by CylinderHabitat.
const getThetaStart = (centerAzimuth: number, arcRadians: number) =>
  THREE.MathUtils.euclideanModulo(
    Math.PI * 0.5 - centerAzimuth - arcRadians * 0.5,
    fullTurn
  )

// Merge parts and tag each with a material index, so archetype buildings
// keep windowed walls (0) and plain roofs (1) in a single instanced draw.
const mergeWithMaterialGroups = (
  parts: Array<{ geometry: THREE.BufferGeometry; materialIndex: number }>
) => {
  const merged = mergeBufferGeometries(parts.map((part) => part.geometry))

  if (merged === null) {
    return null
  }

  let start = 0

  for (const part of parts) {
    const indexCount =
      part.geometry.index !== null
        ? part.geometry.index.count
        : part.geometry.getAttribute('position').count
    merged.addGroup(start, indexCount, part.materialIndex)
    start += indexCount
  }

  return merged
}

// Unit-size archetypes, scaled per instance by (width, height, depth).
// Local +Y is up (toward the axis); the base sits at y = -0.5.
const buildArchetypeGeometry = (kind: BuildingKind) => {
  const parts: Array<{ geometry: THREE.BufferGeometry; materialIndex: number }> = []

  if (kind === 'setback') {
    const lower = new THREE.BoxGeometry(1, 0.6, 1)
    lower.translate(0, -0.2, 0)
    parts.push({ geometry: lower, materialIndex: 0 })

    const lowerCap = new THREE.BoxGeometry(1.02, 0.03, 1.02)
    lowerCap.translate(0, 0.115, 0)
    parts.push({ geometry: lowerCap, materialIndex: 1 })

    const upper = new THREE.BoxGeometry(0.68, 0.4, 0.72)
    upper.translate(0, 0.3, 0)
    parts.push({ geometry: upper, materialIndex: 0 })

    const upperCap = new THREE.BoxGeometry(0.7, 0.03, 0.74)
    upperCap.translate(0, 0.515, 0)
    parts.push({ geometry: upperCap, materialIndex: 1 })
  } else if (kind === 'tower') {
    const shaft = new THREE.CylinderGeometry(0.46, 0.52, 0.96, 8)
    shaft.translate(0, -0.02, 0)
    parts.push({ geometry: shaft, materialIndex: 0 })

    const cap = new THREE.CylinderGeometry(0.48, 0.48, 0.05, 8)
    cap.translate(0, 0.475, 0)
    parts.push({ geometry: cap, materialIndex: 1 })
  } else if (kind === 'house') {
    const body = new THREE.BoxGeometry(1, 0.68, 1)
    body.translate(0, -0.16, 0)
    parts.push({ geometry: body, materialIndex: 0 })

    const roof = new THREE.ConeGeometry(0.74, 0.32, 4)
    roof.rotateY(Math.PI / 4)
    roof.translate(0, 0.34, 0)
    parts.push({ geometry: roof, materialIndex: 1 })
  } else if (kind === 'slab') {
    // Commercial podium filling the lot, narrower bar on top, offset so the
    // podium roof reads as a terrace.
    const podium = new THREE.BoxGeometry(1, 0.3, 1)
    podium.translate(0, -0.35, 0)
    parts.push({ geometry: podium, materialIndex: 0 })

    const podiumCap = new THREE.BoxGeometry(1.02, 0.03, 1.02)
    podiumCap.translate(0, -0.185, 0)
    parts.push({ geometry: podiumCap, materialIndex: 1 })

    const bar = new THREE.BoxGeometry(0.6, 0.72, 0.86)
    bar.translate(0.14, 0.14, 0)
    parts.push({ geometry: bar, materialIndex: 0 })

    const barCap = new THREE.BoxGeometry(0.62, 0.03, 0.88)
    barCap.translate(0.14, 0.515, 0)
    parts.push({ geometry: barCap, materialIndex: 1 })
  } else if (kind === 'lshape') {
    // Two wings at different heights sharing a corner — breaks the endless
    // rectangles without adding a texture or material.
    const longWing = new THREE.BoxGeometry(1, 0.96, 0.5)
    longWing.translate(0, -0.02, -0.25)
    parts.push({ geometry: longWing, materialIndex: 0 })

    const longCap = new THREE.BoxGeometry(1.02, 0.03, 0.52)
    longCap.translate(0, 0.475, -0.25)
    parts.push({ geometry: longCap, materialIndex: 1 })

    const shortWing = new THREE.BoxGeometry(0.52, 0.78, 0.5)
    shortWing.translate(-0.24, -0.11, 0.25)
    parts.push({ geometry: shortWing, materialIndex: 0 })

    const shortCap = new THREE.BoxGeometry(0.54, 0.03, 0.52)
    shortCap.translate(-0.24, 0.295, 0.25)
    parts.push({ geometry: shortCap, materialIndex: 1 })
  }

  const merged = mergeWithMaterialGroups(parts)

  for (const part of parts) {
    part.geometry.dispose()
  }

  return merged
}

// Rooftop clutter kit: water tank, two AC units and a mast merged into one
// geometry, instanced once per qualifying near-arc roof. Unit space: the kit
// sits on y = 0 and fits inside a half-unit footprint, scaled per instance.
const buildRoofClutterKit = () => {
  const parts: THREE.BufferGeometry[] = []

  const tank = new THREE.CylinderGeometry(0.16, 0.16, 0.34, 8)
  tank.translate(-0.2, 0.17, 0.14)
  parts.push(tank)

  const tankLegs = new THREE.BoxGeometry(0.26, 0.06, 0.26)
  tankLegs.translate(-0.2, 0.03, 0.14)
  parts.push(tankLegs)

  const acLarge = new THREE.BoxGeometry(0.3, 0.16, 0.22)
  acLarge.translate(0.16, 0.08, -0.1)
  parts.push(acLarge)

  const acSmall = new THREE.BoxGeometry(0.18, 0.12, 0.16)
  acSmall.translate(-0.04, 0.06, -0.24)
  parts.push(acSmall)

  const mast = new THREE.CylinderGeometry(0.015, 0.025, 0.9, 5)
  mast.translate(0.24, 0.45, 0.22)
  parts.push(mast)

  const merged = mergeBufferGeometries(parts)

  for (const part of parts) {
    part.dispose()
  }

  // mergeBufferGeometries only returns null for an empty/mismatched list;
  // this list is fixed, so assert rather than thread null onward.
  if (merged === null) {
    throw new Error('roof clutter kit failed to merge')
  }

  return merged
}

const tangent = new THREE.Vector3()
const inward = new THREE.Vector3()
const binormal = new THREE.Vector3()
const basis = new THREE.Matrix4()
const instanceMatrix = new THREE.Matrix4()
const instanceQuaternion = new THREE.Quaternion()
const instancePosition = new THREE.Vector3()
const instanceScale = new THREE.Vector3()
const instanceColor = new THREE.Color()

const getSpineRadius = (radius: number) => Math.max(0.35, radius * 0.012)

// Arc tessellation by sagitta budget: a fixed angular step chords meters on
// kilometer-radius habitats (4 deg at izma sagged road bands ~2m above the
// ground every 223m). 2cm keeps surface bands flush at every scale.
const getArcSegments = (arcRadians: number, radius: number, tolerance = 0.02) => {
  const maxArc = Math.sqrt((8 * tolerance) / Math.max(radius, 0.001))
  return THREE.MathUtils.clamp(Math.ceil(arcRadians / maxArc), 2, 720)
}

// Arc distance (meters) within which buildings keep their full-detail
// shapes; beyond it they collapse to plain instanced boxes. Small habitats
// stay all-near via the floor.
const getCityNearDistance = (radius: number) =>
  Math.max(150, Math.min(radius * 0.5, 1000))

const wrapAngleToPi = (angle: number) => {
  const wrapped = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped
}

const MIRROR_DAY = new THREE.Color(0xffffff)
const MIRROR_NIGHT = new THREE.Color(0x55657a)
const LAMP_DAY = new THREE.Color(0x6b5a40)
const LAMP_NIGHT = new THREE.Color(0xffe2b0)
const SPINE_DAY = new THREE.Color(0xffeec4)
const SPINE_NIGHT = new THREE.Color(0x8a7f63)
// Night city signature: luminous road veins, red rooftop beacons, and windows
// that cool from warm dusk amber toward white/cyan at deep night.
const ROAD_GLOW = new THREE.Color(0xbff7ff)
const BEACON_COLOR = new THREE.Color(0xff2e2a)
const WINDOW_WARM = new THREE.Color(0xffe2b8)
const WINDOW_COOL = new THREE.Color(0xdfeaff)

// Peak directional sun intensity, reached when a mirror is fully open (or, for
// end-lit colonies, at noon). Matches the previous per-window light so the
// daytime exposure/bloom balance is preserved.
const DAY_SUN_INTENSITY = 1.3

// Target facet grid per window mirror, capped so the huge Izma panel stays
// instanced-cheap. Real facet count is fitted to the panel aspect under this.
const MAX_FACETS = 4000
// Fraction of each grid cell the facet fills; the remainder is the truss gap.
const FACET_FILL = 0.9
// Per-facet tint gradient: warm reflected sun near the hinge, cooling to deep
// space blue at the free end (multiplies the day/night facet colour).
const FACET_WARM = new THREE.Color(0xf7ead0)
const FACET_COOL = new THREE.Color(0x3a4c64)
// How hard the facet array blazes at full sun-catch. The day tint is pushed this
// far into HDR so the array clips bright (reads as glowing even in VR, where
// bloom is off) and haloes hard under desktop bloom.
const FACET_BLAZE_GAIN = 7

// Facets pivot about the panel-local tangent (localX). Reused per pose to avoid
// per-frame allocation across thousands of instances.
const LOCAL_TANGENT = new THREE.Vector3(1, 0, 0)
const UNIT_SCALE = new THREE.Vector3(1, 1, 1)
const facetTilt = new THREE.Quaternion()
const facetMatrix = new THREE.Matrix4()
// Reused per panel in poseBeam for the band lights' shared root position.
const scratchBeamRoot = new THREE.Vector3()

// A reflected-sun beam for one window mirror, realized as a static truss panel
// carrying a steerable grid of heliostat facets. The facets tilt as a group
// each frame (poseBeam) to re-aim the sun, and the beam is sampled into
// SUN_BEAM_BANDS collimated DirectionalLights across the root→tip axis — each
// aimed from the facet normal on that band's cascade schedule, so the facet
// array (and its tip→root fold) genuinely drives the floor lighting, not just
// the mirror face (see mirrorOptics).
type SunBeam = {
  lights: THREE.DirectionalLight[]
  panel: THREE.Group
  facets: THREE.InstancedMesh
  facetPositions: THREE.Vector3[]
  // Per-facet position along the panel, 0 at the root (hinge, -Y rim) to 1 at the
  // tip (free end, toward the sun). Drives the tip→root fold cascade.
  facetPhases: Float32Array
  // Representative root→tip phase (0 root … 1 tip) for each band light, so a band
  // aims and dims on the same cascade schedule as the facets it stands for.
  bandPhases: Float32Array
  frame: MirrorFrame
  radius: number
  // Last daylight actually written to the GPU; the slow day cycle lets us skip
  // re-uploading thousands of instance matrices on sub-threshold changes.
  lastDaylight: number
}

// Daylight change below this skips the instance-matrix rewrite. The light still
// re-aims every frame; only the ~thousands of facet matrices wait. The slow day
// cycle means this fires only a handful of times a second during dawn/dusk.
const DAYLIGHT_SWEEP_EPSILON = 0.002
// How far (in daylight units) the fold front lags from tip to root across a
// panel. Tips lead the fold at dusk; roots lead the unfold at dawn. Scaled by a
// 4·d·(1−d) bump so the cascade only shows during the transition and the steady
// noon/midnight poses stay perfectly uniform.
const FACET_SWEEP_SPREAD = 0.25

// One mirror panel is sampled into this many DirectionalLights down its root→tip
// axis. A flat panel whose facets sit at a spread of fold angles emits a *spread*
// of collimated beams, which a single light cannot represent; the bands share one
// aim at the steady noon/midnight poses (the cascade bump is zero there) and fan
// apart through dawn/dusk, so the tip→root fold sweeps the lit patch across the
// floor instead of fading it uniformly. Kept small — it multiplies the
// per-fragment light loop by the window count.
const SUN_BEAM_BANDS = 4

// Alternating crop stripes for farm blocks; one texture tile is a pair of
// rows, repeated in world units via baked UVs.
const createFarmTexture = () => {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the farm texture')
  }

  const rows = ['#5b7a3c', '#c5b05e', '#43653a', '#8a9a4e']

  rows.forEach((color, index) => {
    context.fillStyle = color
    context.fillRect(0, (index * size) / rows.length, size, size / rows.length)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // Crop rows tile many times across a field and are seen at grazing angles —
  // right at your feet and, per-eye in VR, badly. Without anisotropic filtering
  // the stripes shimmer/moiré and read like the road↔field surfaces z-fighting.
  // Match the road and ground textures, which already filter at 16x.
  texture.anisotropy = 16
  return texture
}

// One dash cycle of road surface: U spans the full width (edge lines at the
// sides), V repeats along the road in ROAD_TEXTURE_WORLD_METERS units.
export const ROAD_TEXTURE_WORLD_METERS = 12

const createRoadTexture = (kind: 'arterial' | 'local') => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the road texture')
  }

  context.fillStyle = kind === 'arterial' ? '#15191f' : '#20262d'
  context.fillRect(0, 0, size, size)

  // Edge lines on both sides (symmetric, so the BackSide mirror is free).
  context.fillStyle = 'rgba(218, 224, 230, 0.5)'
  context.fillRect(8, 0, 5, size)
  context.fillRect(size - 13, 0, 5, size)

  if (kind === 'arterial') {
    // Solid warm center line plus dashed lane separators (4 lanes).
    context.fillStyle = 'rgba(226, 196, 116, 0.85)'
    context.fillRect(size / 2 - 3, 0, 6, size)
    context.fillStyle = 'rgba(220, 226, 232, 0.7)'
    context.fillRect(62, 16, 4, 120)
    context.fillRect(size - 66, 16, 4, 120)
  } else {
    // Faint short center dash for residential streets.
    context.fillStyle = 'rgba(210, 216, 222, 0.22)'
    context.fillRect(size / 2 - 2, 40, 4, 88)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  // Distant roads are seen at a near-grazing angle, where the lane markings
  // alias and shimmer. Roads are the canonical case for anisotropic filtering:
  // request the hardware max (three.js clamps to the GPU's limit) instead of 4.
  texture.anisotropy = 16
  return texture
}

// Remap an arc-band road geometry's UVs so U spans the road width and V
// runs along the road in world units (one texture cycle per
// ROAD_TEXTURE_WORLD_METERS). `alongIsArc` flips the axes for roads whose
// long direction is the cylinder arc (cross streets, bridges).
const bakeRoadUvs = (
  geometry: THREE.BufferGeometry,
  alongMeters: number,
  alongIsArc: boolean
) => {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const repeat = alongMeters / ROAD_TEXTURE_WORLD_METERS

  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index)
    const v = uv.getY(index)

    if (alongIsArc) {
      uv.setXY(index, v, u * repeat)
    } else {
      uv.setXY(index, u, v * repeat)
    }
  }
}

const buildingTone = (tone: number, urban: number, target: THREE.Color) => {
  // Districts read through the palette: downtown skews glassy blue (higher
  // saturation, fewer warm facades), the countryside keeps plastered warmth.
  // `urban` comes from the same zoning field that drives height/archetype mix,
  // so the colour gradient lines up with the skyline gradient for free.
  const warmCut = 0.85 - (1 - urban) * 0.25
  const isWarm = tone > warmCut
  const hue = isWarm ? 0.07 : 0.58
  const saturation = isWarm ? 0.2 : 0.12 + urban * 0.12
  const lightness = 0.38 + tone * 0.34
  return target.setHSL(hue, saturation, lightness)
}

// Suburban default for plan entries without zoning data (synthetic footprints).
const DEFAULT_URBAN = 0.4

// Walking/roof collision for the plaza dome, as a synthetic plan building.
// The box is inset to the drum so the walkable "roof" height matches where
// the dome visually stands, not its curved apex.
const getLandmarkFootprint = (landmark: CityLandmark): CityBuilding => ({
  azimuth: landmark.azimuth,
  axial: landmark.axial,
  width: landmark.domeRadius * 1.9,
  depth: landmark.domeRadius * 1.9,
  height: landmark.domeRadius * 0.35,
  tone: 0.5,
  kind: 'block'
})

// Window grid baked into each facade texture variant. The same numbers drive
// both the canvas drawing and the per-instance UV scaling, so windows stay a
// constant real size instead of stretching with the building box.
type FacadeGrid = { columns: number; rows: number }
// Small detached houses get a coarse cottage grid (a couple of windows), not the
// apartment-block grids — otherwise a 10m house wears a 70-window skin.
const GRID_HOUSE: FacadeGrid = { columns: 3, rows: 2 }
const GRID_WARM: FacadeGrid = { columns: 7, rows: 10 }
const GRID_DENSE: FacadeGrid = { columns: 14, rows: 20 }
const GRID_TOWER: FacadeGrid = { columns: 6, rows: 18 }
const GRID_FAR: FacadeGrid = { columns: 26, rows: 38 }
// Target real-world size of one facade bay (window column) and floor (window
// row). Per-instance UV repeat = building extent / (grid cells × these), so a
// short, wide block tiles more windows across instead of stretching a few.
const FACADE_BAY_METERS = 4.2
const FACADE_FLOOR_METERS = 3.4

// Fill out[offset..offset+1] with the (U, V) texture repeat for one building so
// its windows read at FACADE_BAY/FLOOR size regardless of the box dimensions.
// Rounded to whole tiles so every wall shows a whole number of texture copies:
// the window columns/floors then land on the box edges (corner ribs line up)
// instead of being sliced mid-window. U maps to the footprint (averaged over
// width/depth, since one instance scale must serve all four walls), V to height.
const writeFacadeUvScale = (
  footprint: number,
  height: number,
  grid: FacadeGrid,
  out: Float32Array,
  offset: number
) => {
  out[offset] = Math.max(1, Math.round(footprint / (grid.columns * FACADE_BAY_METERS)))
  out[offset + 1] = Math.max(1, Math.round(height / (grid.rows * FACADE_FLOOR_METERS)))
}

type TextureSet = {
  albedo: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
}

type FacadeTextureVariant = 'warm' | 'dense' | 'tower' | 'far'

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }
}

const createCanvas = (size: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for city textures')
  }

  return { canvas, context }
}

const finishTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  // Facades and rooftops are usually viewed across the cylinder at glancing
  // angles, exactly where mip anisotropy pays for itself.
  texture.anisotropy = 16
  return texture
}

const drawEmissiveRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  alpha: number
) => {
  context.globalAlpha = alpha * 0.18
  context.fillStyle = color
  context.fillRect(x - width * 0.35, y - height * 0.35, width * 1.7, height * 1.7)
  context.globalAlpha = alpha * 0.82
  context.fillRect(x, y, width, height)
  context.globalAlpha = 1
}

const createFacadeTextureSet = (
  columns: number,
  rows: number,
  variant: FacadeTextureVariant,
  seed: number
): TextureSet => {
  const size = variant === 'far' ? 512 : 256
  const { canvas: albedoCanvas, context: albedo } = createCanvas(size)
  const { canvas: emissiveCanvas, context: emissive } = createCanvas(size)
  const random = createSeededRandom(seed)
  const isTower = variant === 'tower'
  const isDense = variant === 'dense' || variant === 'far'
  const cellWidth = size / columns
  const cellHeight = size / rows
  // Bases sit a stop or two brighter than a pure night skin so the daytime color
  // lift (setDaylight) reaches a believable concrete/glass grey instead of near
  // black; night stays dark because the hemisphere light is low after dusk.
  const base = isTower ? '#2b3340' : variant === 'warm' ? '#5b6470' : '#414b58'
  const rib = isTower ? '#161d27' : variant === 'warm' ? '#6f6770' : '#2a323d'
  const seam = isTower ? 'rgba(177, 198, 216, 0.08)' : 'rgba(255, 218, 183, 0.08)'

  albedo.fillStyle = base
  albedo.fillRect(0, 0, size, size)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)

  const warmWash = albedo.createLinearGradient(0, 0, size, size)
  warmWash.addColorStop(0, isTower ? 'rgba(255, 150, 96, 0.08)' : 'rgba(255, 160, 108, 0.18)')
  warmWash.addColorStop(0.55, 'rgba(42, 48, 60, 0.04)')
  warmWash.addColorStop(1, 'rgba(0, 12, 26, 0.24)')
  albedo.fillStyle = warmWash
  albedo.fillRect(0, 0, size, size)

  for (let column = 0; column < columns; column += 1) {
    const x = column * cellWidth
    const ribWidth = Math.max(1, cellWidth * (isTower ? 0.14 : 0.08))
    albedo.fillStyle = rib
    albedo.globalAlpha = isTower ? 0.72 : 0.42
    albedo.fillRect(x, 0, ribWidth, size)
    albedo.fillRect(x + cellWidth - ribWidth * 0.65, 0, ribWidth * 0.65, size)
  }

  albedo.globalAlpha = 1
  albedo.strokeStyle = seam
  albedo.lineWidth = 1

  for (let row = 0; row <= rows; row += 1) {
    const y = row * cellHeight
    albedo.beginPath()
    albedo.moveTo(0, y)
    albedo.lineTo(size, y)
    albedo.stroke()
  }

  for (let column = 0; column <= columns; column += 1) {
    const x = column * cellWidth
    albedo.beginPath()
    albedo.moveTo(x, 0)
    albedo.lineTo(x, size)
    albedo.stroke()
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cellWidth
      const y = row * cellHeight
      const windowWidth = cellWidth * (isTower ? 0.42 : isDense ? 0.5 : 0.58)
      const windowHeight = cellHeight * (isDense ? 0.5 : 0.44)
      const offsetX = cellWidth * (isTower ? 0.34 : 0.23) + (random() - 0.5) * cellWidth * 0.08
      const offsetY = cellHeight * 0.26 + (random() - 0.5) * cellHeight * 0.08
      const litChance =
        variant === 'far' ? 0.58 : variant === 'dense' ? 0.48 : isTower ? 0.42 : 0.34
      const stripChance = isTower ? 0.18 : 0.04
      const lit = random() < litChance
      const color = random() < 0.64 ? '#ffd49a' : random() < 0.86 ? '#e6f2ff' : '#9ff4ff'

      // Unlit panes read as cool sky-reflecting glass, not black holes: in
      // daylight (lifted albedo) they look glazed; at night the low light sinks
      // them dark while the lit/emissive panes carry the glow.
      albedo.fillStyle = lit ? 'rgba(255, 216, 166, 0.55)' : 'rgba(120, 144, 170, 0.6)'
      albedo.fillRect(x + offsetX, y + offsetY, windowWidth, windowHeight)
      albedo.fillStyle = 'rgba(255, 255, 255, 0.08)'
      albedo.fillRect(x + offsetX + windowWidth * 0.12, y + offsetY, windowWidth * 0.12, windowHeight)

      if (lit) {
        drawEmissiveRect(
          emissive,
          x + offsetX,
          y + offsetY,
          windowWidth,
          windowHeight,
          color,
          0.42 + random() * 0.36
        )
      }

      if (random() < stripChance) {
        const stripX = x + cellWidth * (0.46 + random() * 0.08)
        const stripWidth = Math.max(1.5, cellWidth * 0.12)
        albedo.fillStyle = 'rgba(185, 224, 255, 0.14)'
        albedo.fillRect(stripX, y + cellHeight * 0.08, stripWidth, cellHeight * 0.82)
        drawEmissiveRect(
          emissive,
          stripX,
          y + cellHeight * 0.08,
          stripWidth,
          cellHeight * 0.82,
          random() < 0.5 ? '#e8f6ff' : '#ffd38a',
          0.35
        )
      }

      if (isDense && random() < 0.04) {
        drawEmissiveRect(
          emissive,
          x + cellWidth * 0.78,
          y + cellHeight * 0.15,
          Math.max(1.5, cellWidth * 0.1),
          Math.max(1.5, cellHeight * 0.1),
          '#ff302b',
          0.75
        )
      }
    }
  }

  for (let index = 0; index < (variant === 'far' ? 900 : 140); index += 1) {
    const x = random() * size
    const y = random() * size
    const width = Math.max(1, size * (variant === 'far' ? 0.004 : 0.006))
    const height = Math.max(1, size * (variant === 'far' ? 0.012 : 0.018))
    albedo.fillStyle = random() < 0.5 ? 'rgba(255, 167, 112, 0.13)' : 'rgba(159, 244, 255, 0.1)'
    albedo.fillRect(x, y, width, height)

    if (variant === 'far' && random() < 0.45) {
      drawEmissiveRect(
        emissive,
        x,
        y,
        width,
        height,
        random() < 0.62 ? '#ffd8a2' : '#dff4ff',
        0.5
      )
    }
  }

  return {
    albedo: finishTexture(albedoCanvas),
    emissive: finishTexture(emissiveCanvas)
  }
}

const createRoofTextureSet = (): TextureSet => {
  const size = 256
  const { canvas: albedoCanvas, context: albedo } = createCanvas(size)
  const { canvas: emissiveCanvas, context: emissive } = createCanvas(size)
  const random = createSeededRandom(0x8e2c5f91)

  albedo.fillStyle = '#303943'
  albedo.fillRect(0, 0, size, size)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)

  for (let y = 0; y < size; y += 32) {
    for (let x = 0; x < size; x += 32) {
      albedo.fillStyle = random() < 0.5 ? '#26303b' : '#3a4350'
      albedo.fillRect(x + 1, y + 1, 30, 30)
      albedo.strokeStyle = 'rgba(255, 220, 180, 0.08)'
      albedo.strokeRect(x + 1.5, y + 1.5, 29, 29)

      if (random() < 0.42) {
        const unitX = x + 6 + random() * 12
        const unitY = y + 6 + random() * 12
        albedo.fillStyle = '#697582'
        albedo.fillRect(unitX, unitY, 8 + random() * 10, 5 + random() * 8)
        albedo.fillStyle = 'rgba(6, 12, 18, 0.45)'
        albedo.fillRect(unitX + 2, unitY + 2, 8, 2)
      }

      if (random() < 0.08) {
        drawEmissiveRect(
          emissive,
          x + 14 + random() * 6,
          y + 14 + random() * 6,
          3,
          3,
          '#ff302b',
          0.9
        )
      }
    }
  }

  for (let index = 0; index < 18; index += 1) {
    const y = random() * size
    albedo.fillStyle = 'rgba(225, 235, 245, 0.16)'
    albedo.fillRect(0, y, size, 1)
    drawEmissiveRect(emissive, 0, y, size, 1, random() < 0.5 ? '#9ff4ff' : '#ffd49a', 0.12)
  }

  return {
    albedo: finishTexture(albedoCanvas),
    emissive: finishTexture(emissiveCanvas)
  }
}

const disposeTextureSet = (textures: TextureSet) => {
  textures.albedo.dispose()
  textures.emissive.dispose()
}

export class Cityscape {
  readonly group = new THREE.Group()

  private readonly smallFacadeTextures = createFacadeTextureSet(
    GRID_WARM.columns,
    GRID_WARM.rows,
    'warm',
    0x2c1b3a5d
  )
  private readonly largeFacadeTextures = createFacadeTextureSet(
    GRID_DENSE.columns,
    GRID_DENSE.rows,
    'dense',
    0x7b42a8e3
  )
  private readonly towerFacadeTextures = createFacadeTextureSet(
    GRID_TOWER.columns,
    GRID_TOWER.rows,
    'tower',
    0x4d6b91f0
  )
  private readonly farFacadeTextures = createFacadeTextureSet(
    GRID_FAR.columns,
    GRID_FAR.rows,
    'far',
    0xd65128bf
  )
  private readonly houseFacadeTextures = createFacadeTextureSet(
    GRID_HOUSE.columns,
    GRID_HOUSE.rows,
    'warm',
    0x19a7c3e5
  )
  private readonly roofTextures = createRoofTextureSet()

  // Side faces carry the lit-window emissive map; roof and foundation stay
  // plain so towers do not glow from above.
  private readonly buildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.smallFacadeTextures.albedo,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.smallFacadeTextures.emissive
  })

  private readonly houseBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.houseFacadeTextures.albedo,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.houseFacadeTextures.emissive
  })

  private readonly largeBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.largeFacadeTextures.albedo,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.largeFacadeTextures.emissive
  })

  private readonly towerBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.towerFacadeTextures.albedo,
    roughness: 0.72,
    metalness: 0.22,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.75,
    emissiveMap: this.towerFacadeTextures.emissive
  })

  private readonly farBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.farFacadeTextures.albedo,
    roughness: 0.9,
    metalness: 0.08,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.85,
    emissiveMap: this.farFacadeTextures.emissive
  })

  private readonly buildingRoofMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.roofTextures.albedo,
    roughness: 0.9,
    metalness: 0.08,
    emissive: new THREE.Color(0xd8ecff),
    emissiveMap: this.roofTextures.emissive,
    emissiveIntensity: 0.22
  })

  // Faint glass tint: the cutout in the shell shows space and the mirrors,
  // this band just hints at the glazing.
  // The longitudinal windows: hexagonal structural glass. The hex cells are
  // near-transparent (the mirror sky shows through); the mullions read as the
  // O'Neill window frame. Tiled per strip size in buildWindowStrips.
  private readonly windowGlassTexture = createWindowGlassTexture()
  private readonly windowStripMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: this.windowGlassTexture,
    transparent: true,
    opacity: 0.6,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  })

  // The individual heliostat facets: small reflective tiles, tinted by the sky
  // grade in setDaylight and given a hinge→free-end warm/cool gradient per-facet
  // via instanceColor. Steerable as a group (see poseBeam), so the array re-aims
  // the sun rather than the whole panel folding shut. Two-sided, but only the
  // reflective FRONT (+Z, the face that catches the sun) shows the tint — the
  // back is painted black, like the dark backing of a real mirror.
  private readonly facetMaterial = (() => {
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false
    })
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( gl_FrontFacing ? diffuse : vec3( 0.0 ), opacity );'
      )
    }
    return material
  })()

  // The static space-frame the facets ride on: dark structural lattice.
  private readonly trussMaterial = new THREE.MeshBasicMaterial({
    color: 0x1b2026,
    toneMapped: false,
    fog: false
  })

  private readonly axisSpineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffeec4,
    transparent: true,
    opacity: 0.85,
    toneMapped: false
  })

  private readonly bridgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6dade,
    map: createRoadTexture('arterial'),
    roughness: 0.7,
    metalness: 0.2,
    side: THREE.DoubleSide
  })

  private readonly bridgeEdgeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    toneMapped: false,
    side: THREE.DoubleSide
  })

  // Roads light up at night as an emissive teal grid — the colony's signature
  // night signal. The asphalt texture doubles as the emissive mask so the lane
  // lines glow brightest; emissiveIntensity ramps from 0 (day) up at night
  // (setDaylight). The texture is shared between albedo and emissive map.
  private readonly arterialRoadTexture = createRoadTexture('arterial')
  private readonly localRoadTexture = createRoadTexture('local')

  private readonly localRoadMaterial = new THREE.MeshStandardMaterial({
    map: this.localRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.localRoadTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })

  private readonly roadMaterial = new THREE.MeshStandardMaterial({
    map: this.arterialRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.arterialRoadTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  })

  private readonly parkMaterial = new THREE.MeshStandardMaterial({
    color: 0x33563b,
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  })

  private readonly farmMaterial = new THREE.MeshStandardMaterial({
    map: createFarmTexture(),
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  })

  private readonly treeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0
  })

  private readonly lampMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe2b0,
    toneMapped: false
  })

  private readonly towerMaterial = new THREE.MeshStandardMaterial({
    color: 0x8ea2b6,
    roughness: 0.5,
    metalness: 0.35
  })

  // Painted rooftop hardware — darker than the roofs it sits on so the kits
  // read as clutter, not as another storey.
  private readonly roofClutterMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d5a68,
    roughness: 0.7,
    metalness: 0.3
  })

  // The plaza dome: glassy civic architecture with a faint self-glow so it
  // stays a landmark after dark without its own light.
  private readonly landmarkDomeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fbdd4,
    roughness: 0.22,
    metalness: 0.55,
    emissive: new THREE.Color(0x16323e),
    emissiveIntensity: 0.7
  })

  private readonly towerAccentMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    toneMapped: false
  })

  // Red aviation warning lights on the tallest rooftops. Each beacon strobes on
  // its own phase (per-instance aBlinkPhase), driven by a shared time uniform —
  // so the city overhead twinkles with independent red flashes rather than one
  // synchronized blink. Unlit/toneMapped:false so the flash clips into HDR and
  // haloes under desktop bloom; the steady-on floor keeps them readable between
  // flashes.
  private readonly beaconTime = { value: 0 }
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({
    color: BEACON_COLOR.clone(),
    toneMapped: false,
    // Beacons must read across the whole bore — the overhead islands are ~2
    // radii away, deep in the haze. Exempt them from fog so the far rooftops
    // keep blinking instead of dissolving into the sky colour.
    fog: false
  })

  private readonly cableMaterial = new THREE.MeshStandardMaterial({
    color: 0xaab8c8,
    roughness: 0.4,
    metalness: 0.6
  })

  private readonly spineRingMaterial = new THREE.MeshStandardMaterial({
    color: 0x55687c,
    roughness: 0.6,
    metalness: 0.4,
    emissive: new THREE.Color(0x131c28),
    emissiveIntensity: 0.8
  })

  // Distance fade for the dark linear infrastructure (roads + bridges). Thin,
  // near-black bands go sub-pixel on the far side of the cylinder and break
  // into a shimmering dashed pattern — that is geometry COVERAGE aliasing of a
  // ~1px silhouette, which anisotropic filtering cannot touch. Dissolving them
  // into the fog colour just before they get that small kills the shimmer,
  // while the (light, low-contrast) building skyline — the "city overhead"
  // reveal — stays crisp because it is left untouched. Shared uniform refs,
  // retargeted to the habitat size in setDimensions.
  private readonly fadeStart = { value: 1e9 }
  private readonly fadeEnd = { value: 2e9 }

  private buildings: THREE.InstancedMesh | null = null
  private largeBuildings: THREE.InstancedMesh | null = null
  private farBuildings: THREE.InstancedMesh | null = null
  private cityPlanBuildings: CityBuilding[] = []
  private cityFocusAzimuth = 0
  private archetypeBatches: THREE.InstancedMesh[] = []
  // Water tanks / AC units / masts on the near-arc flat roofs. Lives with the
  // building batches (same focus-driven rebuild + dispose cycle).
  private roofClutter: THREE.InstancedMesh | null = null
  private collisionBuildings: CityBuilding[] = []
  private collisionIndex: CityCollisionIndex = buildCityCollisionIndex([], 1, 1)
  private windowStrips: THREE.Mesh[] = []
  private bridges: THREE.Mesh | null = null
  private bridgeEdges: THREE.Mesh | null = null
  // The colony's real key light. Izma is mirror-lit (one steerable facet array
  // per window, posed from mirrorOptics each frame); the full-360 colonies
  // (Cooper/Playground/Elysium) are end-lit by a single axial sun. Built and
  // disposed alongside the geometry so a preset switch re-rigs the daylighting.
  private sunBeams: SunBeam[] = []
  private endSun: THREE.DirectionalLight | null = null
  private roads: THREE.Mesh | null = null
  private localRoads: THREE.Mesh | null = null
  private patchMeshes: THREE.Mesh[] = []
  private trees: THREE.InstancedMesh | null = null
  private lamps: THREE.InstancedMesh | null = null
  private beacons: THREE.InstancedMesh | null = null
  private towerGroup: THREE.Group | null = null
  private landmarkGroup: THREE.Group | null = null
  private cables: THREE.Mesh | null = null
  private spineRings: THREE.Mesh | null = null
  private axisSpine: THREE.Mesh | null = null
  private radius = 0
  private length = 0
  private topology: HabitatTopology = ISLAND_THREE_TOPOLOGY
  // Only an open ring (Elysium) keeps the central spine + cable trusses; the
  // cylinder colonies (Izma/Cooper/Playground) have no visible axis structure.
  private habitatType: HabitatType = 'cylinder'
  // The current sky-grade haze colour, fed from main so the window-strip mirrors
  // read as the same warm/violet dusk (or blue day) sky pouring in.
  private readonly skyColor = new THREE.Color(0xffffff)
  private readonly mirrorDayColor = new THREE.Color()

  private readonly maxBuildings: number | undefined

  constructor(dimensions: CityscapeDimensions, options?: { maxBuildings?: number }) {
    this.maxBuildings = options?.maxBuildings
    // Roads and bridges are the dark, thin, high-contrast surfaces that shimmer
    // on the far side; fade them out with distance. Buildings are deliberately
    // excluded so the overhead skyline survives.
    for (const material of [
      this.roadMaterial,
      this.localRoadMaterial,
      this.bridgeMaterial,
      this.bridgeEdgeMaterial
    ]) {
      this.installDistanceFade(material)
    }
    // Facades carry a per-instance UV repeat so windows keep a constant real
    // size; only the side materials get it (roofs share their own material).
    for (const material of [
      this.buildingSideMaterial,
      this.houseBuildingSideMaterial,
      this.largeBuildingSideMaterial,
      this.towerBuildingSideMaterial,
      this.farBuildingSideMaterial
    ]) {
      this.installFacadeUvScale(material)
    }
    this.installBeaconBlink(this.beaconMaterial)
    this.setDimensions(dimensions)
  }

  // Scale each instance's window texture by its own aUvScale attribute. The map
  // and emissive (lit-window) maps share the building's UV channel, so both
  // varyings are scaled in lockstep right after three computes them.
  private installFacadeUvScale(material: THREE.MeshStandardMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute vec2 aUvScale;\n' +
        shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n' +
            '#ifdef USE_MAP\n  vMapUv *= aUvScale;\n#endif\n' +
            '#ifdef USE_EMISSIVEMAP\n  vEmissiveMapUv *= aUvScale;\n#endif'
        )
    }
  }

  // Per-instance strobing for the aviation beacons: a short bright flash on each
  // beacon's own phase, over a dim steady-red floor. Pushed into HDR so it reads
  // day and night and blooms on desktop.
  private installBeaconBlink(material: THREE.MeshBasicMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.beaconTime
      shader.vertexShader =
        'attribute float aBlinkPhase;\nvarying float vBlinkPhase;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vBlinkPhase = aBlinkPhase;'
        )
      // A steady red ember (always lit, so distant beacons stay on the retina)
      // with a slower, fatter flash on top. The near side no longer machine-guns
      // the eye, and the overhead islands still pulse because the ember never
      // drops to zero.
      shader.fragmentShader =
        'uniform float uTime;\nvarying float vBlinkPhase;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          '#include <opaque_fragment>\n' +
            '  float beaconCycle = fract(uTime * 0.5 + vBlinkPhase);\n' +
            '  float beaconFlash = smoothstep(0.0, 0.08, beaconCycle) *\n' +
            '    (1.0 - smoothstep(0.12, 0.42, beaconCycle));\n' +
            '  gl_FragColor.rgb *= 0.5 + beaconFlash * 2.1;'
        )
    }
  }

  // Advance the beacon strobe. Called once per frame from the render loop.
  update(deltaSeconds: number) {
    this.beaconTime.value += deltaSeconds
  }

  // Mix the material's lit colour toward the scene fog colour over a distance
  // window, on top of the normal exponential fog. Reuses the fog varyings
  // (vFogDepth) and the fogColor uniform that three.js already injects, so it
  // only needs the two fade-window uniforms. No-op if the material is unfogged.
  private installDistanceFade(material: THREE.Material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeStart = this.fadeStart
      shader.uniforms.uFadeEnd = this.fadeEnd
      shader.fragmentShader =
        'uniform float uFadeStart;\nuniform float uFadeEnd;\n' +
        shader.fragmentShader.replace(
          '#include <fog_fragment>',
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ' +
            'smoothstep(uFadeStart, uFadeEnd, vFogDepth));\n#include <fog_fragment>'
        )
    }
  }

  setDimensions({ radius, length, topology, type }: CityscapeDimensions) {
    const nextTopology = topology ?? this.topology
    const nextType = type ?? this.habitatType

    if (
      radius === this.radius &&
      length === this.length &&
      nextTopology === this.topology &&
      nextType === this.habitatType
    ) {
      return
    }

    this.radius = radius
    this.length = length
    this.topology = nextTopology
    this.habitatType = nextType
    // With the air kept clear, the opposite side of the cylinder (~2 radii away)
    // should READ rather than dissolve, so the fade is pushed out to ~1.7..2.9
    // radii: the far wall stays visible and only the very-far rim — where road
    // silhouettes go sub-pixel and shimmer — dissolves. Floored so small
    // habitats never fade. vFogDepth is camera-relative, so it tracks the player.
    this.fadeStart.value = Math.max(radius * 1.7, 800)
    this.fadeEnd.value = Math.max(radius * 2.9, 1600)
    this.clear()

    if (radius <= 0 || length <= 0) {
      return
    }

    const plan = planCity({
      radius,
      length,
      maxBuildings: this.maxBuildings,
      topology: this.topology
    })
    this.collisionBuildings = [...plan.buildings]

    if (plan.tower !== null) {
      this.collisionBuildings.push(this.getTowerFootprint(plan.tower))
    }

    if (plan.landmark !== null) {
      this.collisionBuildings.push(getLandmarkFootprint(plan.landmark))
    }

    this.collisionIndex = buildCityCollisionIndex(this.collisionBuildings, radius, length)
    this.buildBuildings(plan.buildings)
    this.buildRoads(plan.roads, radius)
    this.buildPatches(plan.patches, radius, length)
    this.buildTrees(plan.trees, radius)
    this.buildLamps(plan.roads, radius, length)
    this.buildBeacons(plan.buildings, radius, length)
    this.buildWindowStrips(radius, length)
    this.buildWindowBridges(plan.roads, radius, length)
    this.buildMirrors(radius, length)
    // No window strips → no mirrors → the sun reaches the interior through the
    // +Y end instead. Rig the axial end-sun in that case.
    if (this.sunBeams.length === 0) {
      this.buildEndSun(length)
    }
    // Central axis spine + cable trusses only belong to an open ring (Elysium);
    // a cylinder colony's bore is clear.
    if (this.habitatType === 'ring') {
      this.buildCables(radius, length)
      this.buildSpineRings(radius, length)
      this.buildAxisSpine(radius, length)
    }

    if (plan.tower !== null) {
      this.buildTower(plan.tower, radius)
    }

    if (plan.landmark !== null) {
      this.buildLandmark(plan.landmark, radius)
    }
  }

  getBuildings(): readonly CityBuilding[] {
    return this.collisionBuildings
  }

  // True when the colony is lit by steerable window mirrors (Izma) rather than an
  // axial end-sun. The mirror beams are radial, so the ambient fill must NOT
  // carry an axial (spin-axis) gradient — that would read as light from the
  // occluded axial sun and fight the mirrors. Callers flatten the hemisphere
  // fill in this case. See buildMirrors / buildEndSun.
  isMirrorLit(): boolean {
    return this.sunBeams.length > 0
  }

  // O(1) spatial lookups for the per-frame collision queries.
  getCollisionIndex(): CityCollisionIndex {
    return this.collisionIndex
  }

  // Day/night dressing: the mirrors dim to night-side blue, facades and
  // street lamps take over as the light sources.
  // The window-strip mirrors are the colony's "sky": tint them with the current
  // grade so dusk pours warm/violet light through the strips, day pours blue.
  setSkyColor(color: THREE.Color) {
    this.skyColor.copy(color)
  }

  setDaylight(daylight: number) {
    const night = 1 - daylight
    // The facet array BLAZES when it catches the sun: the day tint (sky grade
    // lifted toward white) is pushed deep into HDR by the sun catch, so the
    // facets clip bright — glowing even in VR (bloom is desktop-only) and haloing
    // hard under desktop bloom — and fall to a dim mirror at night. Per-facet
    // instanceColor keeps the hinge→free-end warm/cool gradient, so the sun-
    // facing end goes white-hot while the free end stays space-blue. The dark
    // truss is left untouched so the lit facets pop against it.
    const sunCatch = THREE.MathUtils.clamp(daylight, 0, 1)
    this.mirrorDayColor.copy(this.skyColor).lerp(MIRROR_DAY, 0.5)
    this.facetMaterial.color
      .lerpColors(MIRROR_NIGHT, this.mirrorDayColor, THREE.MathUtils.clamp(daylight + 0.15, 0, 1))
      .multiplyScalar(0.4 + sunCatch * sunCatch * FACET_BLAZE_GAIN)
    // Enough opacity that the thin mullions read, but kept low so the glass is
    // mostly transparent and the mirror sky pours through (cells stay see-through
    // via the texture's own alpha regardless).
    this.windowStripMaterial.opacity = 0.28 + daylight * 0.2
    // Window glow is a night signal: ramp it on with night² so daylight facades
    // stay genuinely dark-windowed (no nocturnal glow at noon) and the lights
    // come up through dusk into night.
    const windowGlow = night * night
    this.buildingSideMaterial.emissiveIntensity = windowGlow * 1.2
    this.houseBuildingSideMaterial.emissiveIntensity = windowGlow * 1.1
    this.largeBuildingSideMaterial.emissiveIntensity = windowGlow * 1.75
    this.towerBuildingSideMaterial.emissiveIntensity = windowGlow * 1.6
    this.farBuildingSideMaterial.emissiveIntensity = windowGlow * 2.1
    this.buildingRoofMaterial.emissiveIntensity = windowGlow * 0.42
    // The facade albedo is authored dark (a night base + lit-window cut-outs);
    // lift it hard through the day so sunlit walls read as a daytime city rather
    // than the dim night skin. Roofs lift too, and dim below 1 at night so only
    // the emissive rooftop details carry.
    const facadeLift = 1 + daylight * 2.6
    this.buildingSideMaterial.color.setScalar(facadeLift)
    this.houseBuildingSideMaterial.color.setScalar(facadeLift)
    this.largeBuildingSideMaterial.color.setScalar(facadeLift)
    this.towerBuildingSideMaterial.color.setScalar(facadeLift)
    this.farBuildingSideMaterial.color.setScalar(facadeLift)
    this.buildingRoofMaterial.color.setScalar(0.55 + daylight * 1.35)
    // Windows cool from warm dusk amber toward white/cyan as night falls.
    this.buildingSideMaterial.emissive.lerpColors(WINDOW_COOL, WINDOW_WARM, daylight)
    this.houseBuildingSideMaterial.emissive.copy(this.buildingSideMaterial.emissive)
    this.largeBuildingSideMaterial.emissive.copy(this.buildingSideMaterial.emissive)
    this.towerBuildingSideMaterial.emissive.copy(this.buildingSideMaterial.emissive)
    this.farBuildingSideMaterial.emissive.copy(this.buildingSideMaterial.emissive)
    // Roads become pale light veins at night; arterials brighter than
    // residential locals so the far-side city reads like a dense network.
    this.roadMaterial.emissiveIntensity = night * 1.55
    this.localRoadMaterial.emissiveIntensity = night * 0.95
    this.lampMaterial.color.lerpColors(LAMP_NIGHT, LAMP_DAY, daylight)
    this.axisSpineMaterial.color.lerpColors(SPINE_NIGHT, SPINE_DAY, daylight)
    this.axisSpineMaterial.opacity = 0.35 + daylight * 0.5
    // Keep the far side readable through the clear air; the fade only dissolves
    // the very-far rim. Night pushes it out a touch further so the glowing grid
    // arches overhead and dims into haze rather than cutting off.
    if (this.radius > 0) {
      this.fadeStart.value = Math.max(this.radius * (1.7 + night * 0.5), 800)
      this.fadeEnd.value = Math.max(this.radius * (2.9 + night * 1.0), 1600)
    }
  }

  // The tower's walking/ball collision proxy: a slim box around the column.
  private getTowerFootprint(tower: CityTower): CityBuilding {
    const footprint = Math.max(1.2, tower.deckRadius * 0.35)
    return {
      azimuth: tower.azimuth,
      axial: tower.axial,
      width: footprint,
      depth: footprint,
      height: tower.height,
      tone: 0.5,
      kind: 'tower'
    }
  }

  private buildLandmark(landmark: CityLandmark, radius: number) {
    const group = new THREE.Group()
    const cos = Math.cos(landmark.azimuth)
    const sin = Math.sin(landmark.azimuth)
    tangent.set(-sin, 0, cos)
    inward.set(-cos, 0, -sin)
    binormal.copy(tangent).cross(inward)
    basis.makeBasis(tangent, inward, binormal)

    const domeRadius = landmark.domeRadius
    const drumHeight = domeRadius * 0.35

    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(domeRadius * 0.96, domeRadius, drumHeight, 24),
      this.towerMaterial
    )
    drum.position.set(0, drumHeight * 0.5, 0)

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius * 0.96, 24, 12, 0, fullTurn, 0, Math.PI * 0.5),
      this.landmarkDomeMaterial
    )
    dome.position.set(0, drumHeight, 0)

    // Cyan rim at the drum/dome joint — the same accent language as the
    // overlook tower's deck ring, so the two landmarks read as one family.
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(
        domeRadius * 0.97,
        Math.max(0.05, domeRadius * 0.02),
        6,
        28
      ),
      this.towerAccentMaterial
    )
    rim.rotation.x = Math.PI * 0.5
    rim.position.set(0, drumHeight, 0)

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(domeRadius * 0.015, domeRadius * 0.04, domeRadius * 0.5, 6),
      this.towerMaterial
    )
    spire.position.set(0, drumHeight + domeRadius * 1.1, 0)

    const spireTip = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.12, domeRadius * 0.045), 8, 6),
      this.lampMaterial
    )
    spireTip.position.set(0, drumHeight + domeRadius * 1.35, 0)

    group.add(drum, dome, rim, spire, spireTip)
    group.quaternion.setFromRotationMatrix(basis)
    group.position.set(cos, 0, sin).multiplyScalar(radius).setY(landmark.axial)
    this.landmarkGroup = group
    this.group.add(group)
  }

  dispose() {
    this.clear()
    this.buildingSideMaterial.dispose()
    this.houseBuildingSideMaterial.dispose()
    this.largeBuildingSideMaterial.dispose()
    this.towerBuildingSideMaterial.dispose()
    this.farBuildingSideMaterial.dispose()
    this.buildingRoofMaterial.dispose()
    disposeTextureSet(this.smallFacadeTextures)
    disposeTextureSet(this.largeFacadeTextures)
    disposeTextureSet(this.towerFacadeTextures)
    disposeTextureSet(this.farFacadeTextures)
    disposeTextureSet(this.houseFacadeTextures)
    disposeTextureSet(this.roofTextures)
    this.windowStripMaterial.map?.dispose()
    this.windowStripMaterial.dispose()
    this.facetMaterial.dispose()
    this.trussMaterial.dispose()
    this.axisSpineMaterial.dispose()
    this.roadMaterial.map?.dispose()
    this.roadMaterial.dispose()
    this.localRoadMaterial.map?.dispose()
    this.localRoadMaterial.dispose()
    this.bridgeMaterial.map?.dispose()
    this.bridgeMaterial.dispose()
    this.bridgeEdgeMaterial.dispose()
    this.parkMaterial.dispose()
    this.farmMaterial.map?.dispose()
    this.farmMaterial.dispose()
    this.treeMaterial.dispose()
    this.lampMaterial.dispose()
    this.beaconMaterial.dispose()
    this.towerMaterial.dispose()
    this.towerAccentMaterial.dispose()
    this.roofClutterMaterial.dispose()
    this.landmarkDomeMaterial.dispose()
    this.cableMaterial.dispose()
    this.spineRingMaterial.dispose()
  }

  // Near batches are small (~10% of the plan) and cheap to recreate on every
  // focus step; the far batch is the other ~90%, so it keeps a persistent
  // capacity-sized buffer and is rewritten in place (see updateFarBatch).
  private disposeNearBuildingBatches() {
    for (const batch of [
      this.buildings,
      this.largeBuildings,
      this.roofClutter,
      ...this.archetypeBatches
    ]) {
      if (batch !== null) {
        batch.geometry.dispose()
        this.group.remove(batch)
      }
    }

    this.buildings = null
    this.largeBuildings = null
    this.roofClutter = null
    this.archetypeBatches = []
  }

  private disposeBuildingBatches() {
    this.disposeNearBuildingBatches()

    if (this.farBuildings !== null) {
      this.farBuildings.geometry.dispose()
      this.group.remove(this.farBuildings)
      this.farBuildings = null
    }
  }

  private clear() {
    this.collisionBuildings = []
    this.collisionIndex = buildCityCollisionIndex([], 1, 1)
    this.cityPlanBuildings = []
    this.disposeBuildingBatches()

    for (const patch of this.patchMeshes) {
      patch.geometry.dispose()
      this.group.remove(patch)
    }

    this.patchMeshes = []

    for (const single of [
      this.trees,
      this.lamps,
      this.beacons,
      this.cables,
      this.spineRings,
      this.bridges,
      this.bridgeEdges,
      this.localRoads
    ]) {
      if (single !== null) {
        single.geometry.dispose()
        this.group.remove(single)
      }
    }

    this.trees = null
    this.lamps = null
    this.beacons = null
    this.cables = null
    this.spineRings = null
    this.bridges = null
    this.bridgeEdges = null
    this.localRoads = null

    if (this.towerGroup !== null) {
      for (const child of this.towerGroup.children) {
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(this.towerGroup)
      this.towerGroup = null
    }

    if (this.landmarkGroup !== null) {
      for (const child of this.landmarkGroup.children) {
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(this.landmarkGroup)
      this.landmarkGroup = null
    }

    for (const strip of this.windowStrips) {
      strip.geometry.dispose()
      this.group.remove(strip)
    }

    this.windowStrips = []

    // Tear down the daylighting rig so a preset switch rebuilds it for the new
    // topology. Facet/truss geometries are per-beam; the shared facet/truss
    // materials are class-owned and not disposed here.
    for (const beam of this.sunBeams) {
      beam.facets.dispose()
      // Disposes both the facet geometry and the truss geometry (panel children).
      for (const child of beam.panel.children) {
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(beam.panel)
      for (const light of beam.lights) {
        this.group.remove(light)
        this.group.remove(light.target)
      }
    }

    this.sunBeams = []

    if (this.endSun !== null) {
      this.group.remove(this.endSun)
      this.group.remove(this.endSun.target)
      this.endSun = null
    }

    if (this.roads !== null) {
      this.roads.geometry.dispose()
      this.group.remove(this.roads)
      this.roads = null
    }

    if (this.axisSpine !== null) {
      this.axisSpine.geometry.dispose()
      this.group.remove(this.axisSpine)
      this.axisSpine = null
    }
  }

  private buildBuildings(plan: CityBuilding[]) {
    this.cityPlanBuildings = plan
    this.rebuildBuildingBatches()
  }

  // Azimuth-bucketed LOD: everything in a cylinder is visible at once, so
  // detail is budgeted by arc distance from the player instead of frustum.
  // The near arc gets the shaped archetypes; everything beyond it becomes a
  // single instanced box batch (same windowed material, so the night-light
  // skyline survives). Rebucketed at quantized focus steps like the shell.
  setFocusAzimuth(azimuth: number) {
    const step = getCityNearDistance(this.radius) / Math.max(this.radius, 1e-6) / 3
    const quantized = Math.round(azimuth / step) * step
    const diff = Math.abs(wrapAngleToPi(quantized - this.cityFocusAzimuth))

    if (diff < step * 0.5 || this.cityPlanBuildings.length === 0) {
      return
    }

    this.cityFocusAzimuth = quantized
    this.rebuildBuildingBatches()
  }

  private rebuildBuildingBatches() {
    this.disposeNearBuildingBatches()

    const nearArc =
      getCityNearDistance(this.radius) / Math.max(this.radius, 1e-6)
    const near: CityBuilding[] = []
    const far: CityBuilding[] = []

    for (const building of this.cityPlanBuildings) {
      if (Math.abs(wrapAngleToPi(building.azimuth - this.cityFocusAzimuth)) < nearArc) {
        near.push(building)
      } else {
        far.push(building)
      }
    }

    // Near arc: plain blocks split by size so their windows stay
    // window-sized; the shaped archetypes each get their own batch.
    const blocks = near.filter((b) => b.kind === 'block')
    const small = blocks.filter((b) => Math.max(b.width, b.depth, b.height) <= 25)
    const large = blocks.filter((b) => Math.max(b.width, b.depth, b.height) > 25)

    this.buildings = this.buildBuildingBatch(small, this.buildingSideMaterial, GRID_WARM)
    this.largeBuildings = this.buildBuildingBatch(
      large,
      this.largeBuildingSideMaterial,
      GRID_DENSE
    )

    for (const kind of ['setback', 'tower', 'house', 'slab', 'lshape'] as const) {
      const batch = this.buildArchetypeBatch(
        near.filter((b) => b.kind === kind),
        kind
      )

      if (batch !== null) {
        this.archetypeBatches.push(batch)
      }
    }

    this.updateFarBatch(far)
    this.buildRoofClutter(near)
  }

  // The angular size below which a far building is dropped. ~0.004 rad is a
  // handful of pixels on every target device; anything smaller is shimmer
  // fuel and vertex cost, not skyline. The threshold scales with each
  // building's actual chord distance, so nothing pops at the near-arc
  // boundary (a 1 km neighbour only needs ~4 m to stay) while the far side
  // keeps just the silhouettes that read (~26 m at Izma's 2R).
  private static readonly FAR_MIN_ANGULAR_SIZE = 0.004

  // The far batch persists across focus steps: allocated once per plan at
  // full-plan capacity, then rewritten in place and truncated via .count.
  // The old dispose-and-rebuild allocated ~megabytes per step, a visible
  // hitch on Quest while driving.
  private ensureFarBatchCapacity(capacity: number) {
    if (this.farBuildings !== null && this.farBuildings.instanceMatrix.count >= capacity) {
      return
    }

    if (this.farBuildings !== null) {
      this.farBuildings.geometry.dispose()
      this.group.remove(this.farBuildings)
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const side = this.farBuildingSideMaterial
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z; local +y is the roof.
    const materials = [side, side, this.buildingRoofMaterial, this.buildingRoofMaterial, side, side]
    const mesh = new THREE.InstancedMesh(geometry, materials, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    geometry.setAttribute(
      'aUvScale',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
    )
    this.farBuildings = mesh
    this.group.add(mesh)
  }

  private updateFarBatch(far: CityBuilding[]) {
    this.ensureFarBatchCapacity(Math.max(1, this.cityPlanBuildings.length))
    const mesh = this.farBuildings

    if (mesh === null) {
      return
    }

    const uvScales = (mesh.geometry.getAttribute('aUvScale') as THREE.InstancedBufferAttribute)
      .array as Float32Array
    let count = 0

    for (const building of far) {
      const theta = Math.abs(wrapAngleToPi(building.azimuth - this.cityFocusAzimuth))
      const chord = 2 * this.radius * Math.sin(theta * 0.5)
      const maxDimension = Math.max(building.width, building.depth, building.height)

      if (maxDimension < chord * Cityscape.FAR_MIN_ANGULAR_SIZE) {
        continue
      }

      const cos = Math.cos(building.azimuth)
      const sin = Math.sin(building.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition
        .set(cos, 0, sin)
        .multiplyScalar(this.radius - building.height * 0.5)
        .setY(building.axial)
      instanceScale.set(building.width, building.height, building.depth)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(count, instanceMatrix)
      mesh.setColorAt(
        count,
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, instanceColor)
      )
      writeFacadeUvScale(
        (building.width + building.depth) * 0.5,
        building.height,
        GRID_FAR,
        uvScales,
        count * 2
      )
      count += 1
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    ;(mesh.geometry.getAttribute('aUvScale') as THREE.InstancedBufferAttribute).needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }
  }

  // One clutter kit (water tank + AC boxes + mast) per qualifying near-arc
  // flat roof. Near arc only: at far-side distances the kit is sub-pixel, so
  // it would be pure vertex cost. Deterministic without consuming plan RNG —
  // the per-building offsets derive from fields the building already carries.
  private buildRoofClutter(near: CityBuilding[]) {
    const flatRoofed = near
      .filter(
        (b) =>
          (b.kind === 'block' || b.kind === 'setback' || b.kind === 'slab') &&
          b.height >= 16 &&
          Math.min(b.width, b.depth) >= 8
      )
      .sort((a, b) => b.height - a.height)
      .slice(0, 800)

    if (flatRoofed.length === 0) {
      return
    }

    const geometry = buildRoofClutterKit()
    const mesh = new THREE.InstancedMesh(geometry, this.roofClutterMaterial, flatRoofed.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false

    for (let index = 0; index < flatRoofed.length; index += 1) {
      const building = flatRoofed[index]
      const cos = Math.cos(building.azimuth)
      const sin = Math.sin(building.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)

      // The setback/slab tops are inset from the footprint, so aim the kit at
      // the upper part's centre and keep the jitter inside it.
      const topCentreTangent = building.kind === 'slab' ? building.width * 0.14 : 0
      const jitterSeed = building.tone * 7.31 + building.azimuth * 13.7
      const jitterT = (jitterSeed - Math.floor(jitterSeed) - 0.5) * building.width * 0.16
      const jitterA =
        (jitterSeed * 3.7 - Math.floor(jitterSeed * 3.7) - 0.5) * building.depth * 0.16
      const kitScale = THREE.MathUtils.clamp(Math.min(building.width, building.depth) * 0.4, 2.5, 9)

      instancePosition
        .set(cos, 0, sin)
        .multiplyScalar(this.radius - building.height)
        .setY(building.axial + jitterA)
        .addScaledVector(tangent, topCentreTangent + jitterT)
      instanceScale.setScalar(kitScale)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    this.roofClutter = mesh
    this.group.add(mesh)
  }

  private buildArchetypeBatch(
    plan: CityBuilding[],
    kind: BuildingKind
  ): THREE.InstancedMesh | null {
    if (plan.length === 0) {
      return null
    }

    const geometry = buildArchetypeGeometry(kind)

    if (geometry === null) {
      return null
    }

    // Houses are small: the coarse window grid fits; the tall shapes use
    // the dense one.
    const sideMaterial =
      kind === 'house'
        ? this.houseBuildingSideMaterial
        : kind === 'tower'
          ? this.towerBuildingSideMaterial
          : this.largeBuildingSideMaterial
    const grid =
      kind === 'house' ? GRID_HOUSE : kind === 'tower' ? GRID_TOWER : GRID_DENSE
    // The windowed walls only span part of an archetype's local height (the
    // house body is 0.68 tall under its roof cone); scale the height fed to the
    // UV fit so floors land at FACADE_FLOOR size on the actual wall.
    const wallHeightFactor = kind === 'house' ? 0.68 : 1
    const mesh = new THREE.InstancedMesh(
      geometry,
      [sideMaterial, this.buildingRoofMaterial],
      plan.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    const uvScales = new Float32Array(plan.length * 2)

    for (let index = 0; index < plan.length; index += 1) {
      const building = plan[index]
      const cos = Math.cos(building.azimuth)
      const sin = Math.sin(building.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition
        .set(cos, 0, sin)
        .multiplyScalar(this.radius - building.height * 0.5)
        .setY(building.axial)
      instanceScale.set(building.width, building.height, building.depth)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      mesh.setColorAt(
        index,
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, instanceColor)
      )
      writeFacadeUvScale(
        (building.width + building.depth) * 0.5,
        building.height * wallHeightFactor,
        grid,
        uvScales,
        index * 2
      )
    }

    geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(uvScales, 2))
    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.group.add(mesh)
    return mesh
  }

  private buildBuildingBatch(
    plan: CityBuilding[],
    sideMaterial: THREE.MeshStandardMaterial,
    grid: FacadeGrid
  ): THREE.InstancedMesh | null {
    if (plan.length === 0) {
      return null
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z. Local +y is the roof
    // (toward the axis) in the instance basis below.
    const materials = [
      sideMaterial,
      sideMaterial,
      this.buildingRoofMaterial,
      this.buildingRoofMaterial,
      sideMaterial,
      sideMaterial
    ]
    const mesh = new THREE.InstancedMesh(geometry, materials, plan.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    const uvScales = new Float32Array(plan.length * 2)

    for (let index = 0; index < plan.length; index += 1) {
      const building = plan[index]
      const cos = Math.cos(building.azimuth)
      const sin = Math.sin(building.azimuth)

      // Local basis: X = tangent, Y = inward (toward the axis), Z completes
      // the right-handed frame (-cylinder axis).
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition
        .set(cos, 0, sin)
        .multiplyScalar(this.radius - building.height * 0.5)
        .setY(building.axial)
      instanceScale.set(building.width, building.height, building.depth)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      mesh.setColorAt(
        index,
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, instanceColor)
      )
      writeFacadeUvScale(
        (building.width + building.depth) * 0.5,
        building.height,
        grid,
        uvScales,
        index * 2
      )
    }

    geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(uvScales, 2))

    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.group.add(mesh)
    return mesh
  }

  private buildRoads(roads: CityRoad[], radius: number) {
    // Each road is a thin arc band hugging the inner wall; cross streets
    // curve with the cylinder, so flat planes would visibly chord. The
    // clearance is absolute meters: proportional offsets float at head
    // height on multi-kilometer habitats. Arterials and residential
    // streets get separate meshes so their surfaces read differently.
    for (const kind of ['arterial', 'local'] as const) {
      const geometries: THREE.BufferGeometry[] = []

      for (const road of roads) {
        if (road.kind !== kind) {
          continue
        }

        // Avenues run along the axis; cross streets run along the arc.
        const isAvenue = road.axialLength > road.tangentWidth
        // Physically lift the road off the ground (and above the fields); the
        // logarithmic depth buffer makes polygonOffset inert, so the coplanar
        // land layers are separated by REAL radius: ground at R, fields at R-0.1.
        // Crossing roads (avenue × street) share a radius and would z-fight at
        // every junction, so avenues ride a hair higher (R-0.23) and pass
        // cleanly OVER the cross streets (R-0.2) — no intersection z-fighting.
        const roadRadius = radius - (isAvenue ? 0.23 : 0.2)
        const arcRadians = road.tangentWidth / radius
        const segments = getArcSegments(arcRadians, radius)
        const geometry = new THREE.CylinderGeometry(
          roadRadius,
          roadRadius,
          road.axialLength,
          segments,
          1,
          true,
          getThetaStart(road.azimuth, arcRadians),
          arcRadians
        )
        geometry.translate(0, road.axial, 0)
        bakeRoadUvs(
          geometry,
          isAvenue ? road.axialLength : road.tangentWidth,
          !isAvenue
        )
        geometries.push(geometry)
      }

      const merged = mergeBufferGeometries(geometries)

      for (const geometry of geometries) {
        geometry.dispose()
      }

      if (merged === null) {
        continue
      }

      const mesh = new THREE.Mesh(
        merged,
        kind === 'arterial' ? this.roadMaterial : this.localRoadMaterial
      )
      mesh.renderOrder = 1

      if (kind === 'arterial') {
        this.roads = mesh
      } else {
        this.localRoads = mesh
      }

      this.group.add(mesh)
    }
  }

  // Curved arc band hugging the inner wall, used for patches.
  private buildArcBandGeometry(
    azimuth: number,
    axial: number,
    tangentExtent: number,
    axialExtent: number,
    radius: number,
    bandRadius: number
  ) {
    const arcRadians = tangentExtent / radius
    const segments = getArcSegments(arcRadians, radius)
    const geometry = new THREE.CylinderGeometry(
      bandRadius,
      bandRadius,
      axialExtent,
      segments,
      1,
      true,
      getThetaStart(azimuth, arcRadians),
      arcRadians
    )
    geometry.translate(0, axial, 0)
    return geometry
  }

  private buildPatches(patches: CityPatch[], radius: number, length: number) {
    // Lifted off the ground so log depth (which makes polygonOffset inert)
    // resolves the field-vs-ground and field-vs-road seams. See buildRoads.
    const bandRadius = radius - 0.1
    // Crop rows stay field-scale even on multi-km habitats.
    const stripeWorld = Math.min(getCityCellSize(radius, length) * 0.8, 30)

    for (const kind of ['park', 'farm'] as const) {
      const geometries: THREE.BufferGeometry[] = []

      for (const patch of patches) {
        if (patch.kind !== kind) {
          continue
        }

        const geometry = this.buildArcBandGeometry(
          patch.azimuth,
          patch.axial,
          patch.tangentExtent,
          patch.axialExtent,
          radius,
          bandRadius
        )

        if (kind === 'farm') {
          // Constant world-size crop rows regardless of patch size.
          const uv = geometry.getAttribute('uv') as THREE.BufferAttribute

          for (let i = 0; i < uv.count; i += 1) {
            uv.setXY(
              i,
              uv.getX(i) * (patch.tangentExtent / stripeWorld),
              uv.getY(i) * (patch.axialExtent / stripeWorld)
            )
          }
        }

        geometries.push(geometry)
      }

      const merged = mergeBufferGeometries(geometries)

      for (const geometry of geometries) {
        geometry.dispose()
      }

      if (merged === null) {
        continue
      }

      const mesh = new THREE.Mesh(
        merged,
        kind === 'park' ? this.parkMaterial : this.farmMaterial
      )
      this.patchMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  private buildTrees(treePlan: CityTree[], radius: number) {
    if (treePlan.length === 0) {
      return
    }

    const geometry = new THREE.ConeGeometry(0.5, 1, 6)
    geometry.translate(0, 0.5, 0)
    const mesh = new THREE.InstancedMesh(geometry, this.treeMaterial, treePlan.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false

    for (let index = 0; index < treePlan.length; index += 1) {
      const tree = treePlan[index]
      const cos = Math.cos(tree.azimuth)
      const sin = Math.sin(tree.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition.set(cos, 0, sin).multiplyScalar(radius - 0.02).setY(tree.axial)
      instanceScale.set(tree.height * 0.45, tree.height, tree.height * 0.45)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      mesh.setColorAt(
        index,
        instanceColor.setHSL(0.3 + tree.tone * 0.06, 0.42, 0.2 + tree.tone * 0.16)
      )
    }

    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.trees = mesh
    this.group.add(mesh)
  }

  // Warm dots floating above the avenues: enough to read as street lighting.
  private buildLamps(roads: CityRoad[], radius: number, length: number) {
    const cell = getCityCellSize(radius, length)
    const spacing = cell * 2.2
    const lampHeight = THREE.MathUtils.clamp(cell * 0.55, 3, 12)
    const lampRadius = THREE.MathUtils.clamp(cell * 0.02, 0.12, 0.5)
    const positions: Array<{ azimuth: number; axial: number }> = []

    for (const road of roads) {
      // Street lighting follows the arterial avenues (long axial roads).
      if (road.kind !== 'arterial' || road.axialLength <= road.tangentWidth) {
        continue
      }

      const count = Math.floor(road.axialLength / spacing)

      for (let index = 0; index < count; index += 1) {
        positions.push({
          azimuth: road.azimuth,
          axial: road.axial - road.axialLength * 0.5 + (index + 0.5) * spacing
        })
      }
    }

    const stride = Math.max(1, Math.ceil(positions.length / 1200))
    const kept = positions.filter((_, index) => index % stride === 0)

    if (kept.length === 0) {
      return
    }

    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      this.lampMaterial,
      kept.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    instanceQuaternion.identity()
    instanceScale.setScalar(lampRadius)

    for (let index = 0; index < kept.length; index += 1) {
      const lamp = kept[index]
      instancePosition
        .set(Math.cos(lamp.azimuth), 0, Math.sin(lamp.azimuth))
        .multiplyScalar(radius - lampHeight)
        .setY(lamp.axial)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    this.lamps = mesh
    this.group.add(mesh)
  }

  // Red rooftop aviation beacons on the tallest buildings: a sparse, instantly
  // legible night/dusk cue. Only buildings within ~55% of the tallest get one,
  // capped so a dense colony stays cheap. Small habitats get none.
  private buildBeacons(buildings: CityBuilding[], radius: number, length: number) {
    if (buildings.length === 0) {
      return
    }

    let maxHeight = 0
    for (const building of buildings) {
      if (building.height > maxHeight) {
        maxHeight = building.height
      }
    }

    const minHeight = Math.max(18, maxHeight * 0.55)
    const tall = buildings
      .filter((building) => building.height >= minHeight)
      .sort((a, b) => b.height - a.height)
      .slice(0, 700)

    if (tall.length === 0) {
      return
    }

    const cell = getCityCellSize(radius, length)
    // A touch larger than before so the overhead beacons clear a pixel across the
    // bore; near ones stay modest because the flash is now gentle.
    const beaconRadius = THREE.MathUtils.clamp(cell * 0.05, 0.6, 5)
    const geometry = new THREE.SphereGeometry(1, 6, 5)
    const mesh = new THREE.InstancedMesh(geometry, this.beaconMaterial, tall.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    instanceQuaternion.identity()
    instanceScale.setScalar(beaconRadius)
    // Spread each beacon's strobe across the cycle so the overhead city flashes
    // out of step (see installBeaconBlink). Seeded for a stable layout.
    const random = createSeededRandom(0x51c0bea0)
    const phases = new Float32Array(tall.length)

    for (let index = 0; index < tall.length; index += 1) {
      const building = tall[index]
      instancePosition
        .set(Math.cos(building.azimuth), 0, Math.sin(building.azimuth))
        .multiplyScalar(radius - building.height - beaconRadius)
        .setY(building.axial)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      phases[index] = random()
    }

    geometry.setAttribute('aBlinkPhase', new THREE.InstancedBufferAttribute(phases, 1))
    mesh.instanceMatrix.needsUpdate = true
    this.beacons = mesh
    this.group.add(mesh)
  }

  private buildTower(tower: CityTower, radius: number) {
    const group = new THREE.Group()
    const cos = Math.cos(tower.azimuth)
    const sin = Math.sin(tower.azimuth)
    tangent.set(-sin, 0, cos)
    inward.set(-cos, 0, -sin)
    binormal.copy(tangent).cross(inward)
    basis.makeBasis(tangent, inward, binormal)

    const columnRadius = Math.max(0.3, tower.deckRadius * 0.16)
    const deckThickness = Math.max(0.3, tower.height * 0.04)

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(columnRadius, columnRadius * 1.6, tower.height, 8),
      this.towerMaterial
    )
    column.position.set(0, tower.height * 0.5, 0)

    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(tower.deckRadius, tower.deckRadius * 0.72, deckThickness, 14),
      this.towerMaterial
    )
    deck.position.set(0, tower.height - deckThickness * 0.5, 0)

    const accent = new THREE.Mesh(
      new THREE.TorusGeometry(tower.deckRadius * 0.96, Math.max(0.06, deckThickness * 0.16), 6, 28),
      this.towerAccentMaterial
    )
    accent.rotation.x = Math.PI * 0.5
    accent.position.set(0, tower.height - deckThickness, 0)

    group.add(column, deck, accent)
    group.quaternion.setFromRotationMatrix(basis)
    group.position.set(cos, 0, sin).multiplyScalar(radius).setY(tower.axial)
    this.towerGroup = group
    this.group.add(group)
  }

  // Elevator cables from each land strip up to the axis spine: the cue that
  // ties the ground to the hub and sells the scale.
  private buildCables(radius: number, length: number) {
    const spineRadius = getSpineRadius(radius)
    // Clamped: proportional sizing made 120m-wide pillars on Elysium.
    const cableRadius = Math.min(12, Math.max(0.05, radius * 0.004))
    const cableLength = Math.max(0, radius - spineRadius)

    if (cableLength <= 0) {
      return
    }

    const geometries: THREE.BufferGeometry[] = []
    const transform = new THREE.Matrix4()

    for (const landArc of getLandArcs(this.topology)) {
      const stripCenter = landArc.centerAzimuth

      for (const axialFraction of [-0.28, 0.28]) {
        const cos = Math.cos(stripCenter)
        const sin = Math.sin(stripCenter)
        tangent.set(-sin, 0, cos)
        inward.set(-cos, 0, -sin)
        binormal.copy(tangent).cross(inward)
        basis.makeBasis(tangent, inward, binormal)
        const geometry = new THREE.CylinderGeometry(cableRadius, cableRadius, cableLength, 6)
        instancePosition
          .set(cos, 0, sin)
          .multiplyScalar(spineRadius + cableLength * 0.5)
          .setY(length * axialFraction)
        transform.copy(basis).setPosition(instancePosition)
        geometry.applyMatrix4(transform)
        geometries.push(geometry)
      }
    }

    const merged = mergeBufferGeometries(geometries)

    for (const geometry of geometries) {
      geometry.dispose()
    }

    if (merged === null) {
      return
    }

    const mesh = new THREE.Mesh(merged, this.cableMaterial)
    this.cables = mesh
    this.group.add(mesh)
  }

  private buildSpineRings(radius: number, length: number) {
    const spineRadius = getSpineRadius(radius)
    const ringCount = 7
    const geometries: THREE.BufferGeometry[] = []

    for (let index = 0; index < ringCount; index += 1) {
      const geometry = new THREE.TorusGeometry(spineRadius * 2.4, spineRadius * 0.45, 6, 18)
      geometry.rotateX(Math.PI * 0.5)
      geometry.translate(0, (index / (ringCount - 1) - 0.5) * length * 0.84, 0)
      geometries.push(geometry)
    }

    const merged = mergeBufferGeometries(geometries)

    for (const geometry of geometries) {
      geometry.dispose()
    }

    if (merged === null) {
      return
    }

    const mesh = new THREE.Mesh(merged, this.spineRingMaterial)
    this.spineRings = mesh
    this.group.add(mesh)
  }

  private buildWindowStrips(radius: number, length: number) {
    // Slightly inside the shell so the glow does not z-fight with it
    // (absolute clearance — there is no ground under the windows).
    const stripRadius = radius - 0.3

    // Tile the hex glass so the structural panels are a sensible real size that
    // scales with the colony (a handful of panels per ~0.22-radius tile).
    const windowArcs = getWindowArcs(this.topology)
    const firstArc = windowArcs[0]
    if (firstArc !== undefined) {
      const tileMeters = Math.max(radius * 0.09, 4)
      this.windowGlassTexture.repeat.set(
        Math.max(1, Math.round((firstArc.arcRadians * radius) / tileMeters)),
        Math.max(1, Math.round(length / tileMeters))
      )
    }

    for (const arc of windowArcs) {
      const geometry = new THREE.CylinderGeometry(
        stripRadius,
        stripRadius,
        length,
        24,
        1,
        true,
        getThetaStart(arc.centerAzimuth, arc.arcRadians),
        arc.arcRadians
      )
      const strip = new THREE.Mesh(geometry, this.windowStripMaterial)
      strip.renderOrder = 2
      this.windowStrips.push(strip)
      this.group.add(strip)
    }
  }

  // Bridges spanning the window strips at regular intervals, tying the
  // three land strips together — and giving the windows visible scale.
  private buildWindowBridges(roads: CityRoad[], radius: number, length: number) {
    // Bridges continue the arterial cross-streets over the windows: same
    // axial rows as the streets, spanning road-end to road-end so you can
    // drive straight onto the next island.
    // No windows (a full-circle land arc) means no gaps to bridge.
    if (getWindowArcs(this.topology).length === 0) {
      return
    }

    const arterialStreets = roads.filter(
      (road) => road.kind === 'arterial' && road.tangentWidth > road.axialLength
    )

    if (arterialStreets.length === 0) {
      return
    }

    const bridgeAxials: number[] = []

    for (const street of arterialStreets) {
      if (!bridgeAxials.some((axial) => Math.abs(axial - street.axial) < 0.5)) {
        bridgeAxials.push(street.axial)
      }
    }

    const streetHalfArc = (arterialStreets[0].tangentWidth * 0.5) / radius
    const stripCenters = getLandArcs(this.topology).map((arc) => arc.centerAzimuth)
    const deckWidth = THREE.MathUtils.clamp(getArterialRoadWidth(radius, length) * 1.15, 4, 28)
    const deckParts: THREE.BufferGeometry[] = []
    const edgeParts: THREE.BufferGeometry[] = []
    // Match the cross streets the bridges continue (R-0.2) so the road carries
    // onto the bridge without a step at the window edge.
    const deckRadius = radius - 0.2
    const edgeWidth = Math.max(0.25, deckWidth * 0.08)

    for (let index = 0; index < stripCenters.length; index += 1) {
      const gapStart = stripCenters[index] + streetHalfArc
      const nextCenter = stripCenters[(index + 1) % stripCenters.length]
      const gapSpan = THREE.MathUtils.euclideanModulo(
        nextCenter - streetHalfArc - gapStart,
        Math.PI * 2
      )

      if (gapSpan <= 1e-4) {
        continue
      }

      const segments = getArcSegments(gapSpan, radius)

      for (const axial of bridgeAxials) {
        const deck = new THREE.CylinderGeometry(
          deckRadius,
          deckRadius,
          deckWidth,
          segments,
          1,
          true,
          getThetaStart(gapStart + gapSpan * 0.5, gapSpan),
          gapSpan
        )
        deck.translate(0, axial, 0)
        bakeRoadUvs(deck, gapSpan * deckRadius, true)
        deckParts.push(deck)

        for (const side of [-1, 1]) {
          const edge = new THREE.CylinderGeometry(
            deckRadius - 0.05,
            deckRadius - 0.05,
            edgeWidth,
            segments,
            1,
            true,
            getThetaStart(gapStart + gapSpan * 0.5, gapSpan),
            gapSpan
          )
          edge.translate(0, axial + side * (deckWidth * 0.5 - edgeWidth * 0.5), 0)
          edgeParts.push(edge)
        }
      }
    }

    const deckMerged = mergeBufferGeometries(deckParts)
    const edgeMerged = mergeBufferGeometries(edgeParts)

    for (const part of [...deckParts, ...edgeParts]) {
      part.dispose()
    }

    if (deckMerged !== null) {
      this.bridges = new THREE.Mesh(deckMerged, this.bridgeMaterial)
      this.group.add(this.bridges)
    }

    if (edgeMerged !== null) {
      this.bridgeEdges = new THREE.Mesh(edgeMerged, this.bridgeEdgeMaterial)
      this.group.add(this.bridgeEdges)
    }
  }

  // The exterior sun mirrors, Island Three style: each spans a window strip in
  // width, runs the cylinder's length, and is tilted 45° off the axis so axial
  // sunlight bounces radially inward through the window. It is not a single panel
  // but a static truss carrying a grid of small heliostat facets (see the GQX
  // reference): the facets tilt as a group to re-aim the sun — day/night is the
  // array steering its reflection in and out of the window, not the whole panel
  // folding. The beam is sampled into SUN_BEAM_BANDS collimated DirectionalLights
  // down the panel so the tip→root fold cascade sweeps across the floor, not just
  // the mirror face. Full-360 colonies have no window strips; setDimensions rigs
  // an axial end-sun instead.
  private buildMirrors(radius: number, length: number) {
    const panelWidth = radius * 1.05
    // Covers the full cylinder length when projected along the axis.
    const panelLength = length * Math.SQRT2 * 1.02
    const halfWidth = panelWidth * 0.5
    const halfLen = panelLength * 0.5

    // Fit a facet grid to the panel aspect under the cap. The panel is far
    // longer than wide, so most facets run along its length.
    const aspect = panelLength / panelWidth
    const cols = Math.max(1, Math.round(Math.sqrt(MAX_FACETS / aspect)))
    const rows = Math.max(1, Math.min(Math.floor(MAX_FACETS / cols), Math.round(cols * aspect)))
    const count = cols * rows
    const cellW = panelWidth / cols
    const cellL = panelLength / rows
    const facetGeometry = new THREE.PlaneGeometry(cellW * FACET_FILL, cellL * FACET_FILL)

    // Coarse structural lattice behind the facets; far fewer beams than facets.
    const trussCols = Math.min(cols + 1, 25)
    const trussRows = Math.min(rows + 1, 60)
    const beamThick = Math.min(cellW, cellL) * 0.1
    const beamDepth = Math.min(cellW, cellL) * 0.5

    for (const arc of getWindowArcs(this.topology)) {
      const frame = computeMirrorFrame(arc.centerAzimuth)
      // The panel's rest frame: localX = tangent (the facet tilt axis), localY =
      // along0 (up the panel), localZ = normal0 (faces the sun when open). Hinged
      // at the -Y rim, leaning out over its window.
      const panel = new THREE.Group()
      panel.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(frame.tangent, frame.along0, frame.normal0)
      )
      panel.position
        .copy(frame.outward)
        .multiplyScalar(radius)
        .setY(-length * 0.5)
        .addScaledVector(frame.along0, halfLen)

      const facets = new THREE.InstancedMesh(facetGeometry, this.facetMaterial, count)
      facets.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      // The instance bounds span the whole panel, but InstancedMesh derives its
      // bounding sphere from the single facet geometry — disable culling so the
      // array never wrongly vanishes when the panel center leaves the frustum.
      facets.frustumCulled = false
      const facetPositions: THREE.Vector3[] = []
      const facetPhases = new Float32Array(count)
      const tint = new THREE.Color()
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = (col + 0.5) * cellW - halfWidth
          const y = (row + 0.5) * cellL - halfLen
          const index = row * cols + col
          facetPositions.push(new THREE.Vector3(x, y, 0))
          // 0 at the hinge/root (-Y), 1 at the free tip — shared by the tint and
          // the fold-cascade phase.
          const phase = (y + halfLen) / panelLength
          facetPhases[index] = phase
          // Warm near the hinge (-Y end), cooling toward the free end.
          tint.copy(FACET_WARM).lerp(FACET_COOL, phase)
          facets.setColorAt(index, tint)
        }
      }
      if (facets.instanceColor !== null) {
        facets.instanceColor.needsUpdate = true
      }
      panel.add(facets)
      panel.add(this.buildTruss(panelWidth, panelLength, trussCols, trussRows, beamThick, beamDepth))

      // One panel → SUN_BEAM_BANDS lights, each standing for a root→tip band of
      // facets and carrying 1/N of the panel, so the noon sum matches a single
      // full-strength beam while dusk lets the bands fan apart.
      const lights: THREE.DirectionalLight[] = []
      const bandPhases = new Float32Array(SUN_BEAM_BANDS)
      for (let band = 0; band < SUN_BEAM_BANDS; band += 1) {
        bandPhases[band] = (band + 0.5) / SUN_BEAM_BANDS
        const light = new THREE.DirectionalLight(0xffffff, DAY_SUN_INTENSITY / SUN_BEAM_BANDS)
        this.group.add(light)
        this.group.add(light.target)
        lights.push(light)
      }
      this.group.add(panel)

      const beam: SunBeam = {
        lights,
        panel,
        facets,
        facetPositions,
        facetPhases,
        bandPhases,
        frame,
        radius,
        lastDaylight: Number.NaN
      }
      this.sunBeams.push(beam)
      // Pose once at the open (noon) state so the rig reads before the first
      // setSunlight call.
      this.poseBeam(beam, 1)
    }
  }

  // A flat lattice of crossing beams in the panel-local XY plane, sunk just
  // behind the facets (negative local Z), merged into one mesh.
  private buildTruss(
    width: number,
    length: number,
    cols: number,
    rows: number,
    thick: number,
    depth: number
  ): THREE.Mesh {
    const parts: THREE.BufferGeometry[] = []
    const z = -depth * 0.5
    for (let col = 0; col < cols; col += 1) {
      const x = cols > 1 ? (col / (cols - 1) - 0.5) * width : 0
      parts.push(new THREE.BoxGeometry(thick, length, depth).translate(x, 0, z))
    }
    for (let row = 0; row < rows; row += 1) {
      const y = rows > 1 ? (row / (rows - 1) - 0.5) * length : 0
      parts.push(new THREE.BoxGeometry(width, thick, depth).translate(0, y, z))
    }
    const merged = mergeBufferGeometries(parts)
    for (const part of parts) {
      part.dispose()
    }
    return new THREE.Mesh(merged ?? new THREE.BufferGeometry(), this.trussMaterial)
  }

  // Steer one facet array for the given daylight: write the per-facet fold
  // cascade into the instance matrices (epsilon-gated), then aim and dim each of
  // the panel's band lights on its own cascade-lagged angle. The truss stays put;
  // only the facets pivot, so the array re-aims rather than folding shut.
  private poseBeam(beam: SunBeam, daylight: number): void {
    // Tip leads the fold at dusk, root leads the unfold at dawn; the 4·d·(1−d)
    // bump gates the cascade so it vanishes at the steady noon/midnight extremes
    // — a full day or night sits perfectly uniform. Shared by the facets below
    // and the band lights.
    const bump = 4 * daylight * (1 - daylight)

    if (
      Number.isNaN(beam.lastDaylight) ||
      Math.abs(daylight - beam.lastDaylight) >= DAYLIGHT_SWEEP_EPSILON
    ) {
      // Per-facet fold cascade written into the instance matrices (mirror look).
      for (let index = 0; index < beam.facetPositions.length; index += 1) {
        const localDaylight = daylight - FACET_SWEEP_SPREAD * beam.facetPhases[index] * bump
        facetTilt.setFromAxisAngle(LOCAL_TANGENT, openFactorToPhi(localDaylight))
        facetMatrix.compose(beam.facetPositions[index], facetTilt, UNIT_SCALE)
        beam.facets.setMatrixAt(index, facetMatrix)
      }
      beam.facets.instanceMatrix.needsUpdate = true
      beam.lastDaylight = daylight
    }

    // The band lights carry that SAME cascade onto the floor: each band aims on
    // its own localDaylight, so at dusk the tip bands swing their beam off the
    // floor and dim first, sweeping the lit patch root-ward — a real moving
    // sweep, not a uniform fade. Aim + intensity refresh every frame (O(bands),
    // not O(facets), so no epsilon gate). Each band carries 1/N of the panel.
    const root = scratchBeamRoot.copy(beam.frame.outward).multiplyScalar(beam.radius)
    for (let band = 0; band < beam.lights.length; band += 1) {
      const localDaylight = daylight - FACET_SWEEP_SPREAD * beam.bandPhases[band] * bump
      const { normal } = swingPetal(beam.frame, openFactorToPhi(localDaylight))
      const reflected = reflectSun(normal)
      const light = beam.lights[band]
      light.position.copy(root)
      light.target.position.copy(root).addScaledVector(reflected, beam.radius)
      light.intensity =
        (DAY_SUN_INTENSITY / beam.lights.length) * THREE.MathUtils.clamp(localDaylight, 0, 1)
    }
  }

  // The full-360 colonies have no side windows: the sun reaches them through the
  // +Y end. A single DirectionalLight on the axis, shining -Y (the sun sits on
  // +Y), stands in for that aperture.
  private buildEndSun(length: number) {
    const sun = new THREE.DirectionalLight(0xffffff, DAY_SUN_INTENSITY)
    sun.position.copy(SUN_DIRECTION).multiplyScalar(length * 0.5)
    sun.target.position.set(0, 0, 0)
    this.endSun = sun
    this.group.add(sun)
    this.group.add(sun.target)
  }

  // Drive the daylighting from the day/night clock. `daylight` (0 midnight, 1
  // noon) sweeps the mirror facets (open at noon, facing the sun at midnight) and
  // sets each band light's aim and intensity (in poseBeam); `color` is the Sun's
  // true colour, carried unchanged onto every beam.
  // Intensity tracks daylight directly: with the night pose now facing the sun,
  // a catch-based throughput would read full at midnight, so the day/night curve
  // comes from the clock instead (it matches the old open-pose-normalized catch
  // closely, ~cosφ−sinφ ≈ daylight).
  setSunlight(daylight: number, color: THREE.Color) {
    for (const beam of this.sunBeams) {
      this.poseBeam(beam, daylight)
      for (const light of beam.lights) {
        light.color.copy(color)
      }
    }

    if (this.endSun !== null) {
      this.endSun.intensity = DAY_SUN_INTENSITY * THREE.MathUtils.clamp(daylight, 0, 1)
      this.endSun.color.copy(color)
    }
  }

  private buildAxisSpine(radius: number, length: number) {
    const spineRadius = getSpineRadius(radius)
    const spine = new THREE.Mesh(
      new THREE.CylinderGeometry(spineRadius, spineRadius, length * 0.92, 12, 1),
      this.axisSpineMaterial
    )
    this.axisSpine = spine
    this.group.add(spine)
  }
}
