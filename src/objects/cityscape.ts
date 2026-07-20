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
  getCityGroundHeight,
  isAzimuthOnLandArc,
  type BuildingKind,
  type CityBuilding,
  type CityCollisionIndex,
  type CityExpressway,
  type CityLandmark,
  type CityPatch,
  type CityRoad,
  type CityTower,
  type CityTree
} from './cityLayout'
import { mergeBufferGeometries } from './cylinder'
import { createWindowGlassTexture } from './cylinderSurface'
import {
  disposeDetailedBuildingGeometryPack,
  loadDetailedBuildingGeometryPack,
  type DetailedBuildingArchetype,
  type DetailedBuildingGeometryPack,
  type StreetDetailArchetype
} from './buildingAssets'
import {
  disposeRoadTileGeometryPack,
  getRoadTileLiftMeters,
  loadRoadTileGeometryPack,
  planRoadTilePlacements,
  ROAD_TILE_HEIGHT_SCALE,
  type RoadTileGeometryPack,
  type RoadTileKind
} from './roadTiles'
import {
  getBuildingChordDistance,
  getBuildingSurfaceDistance,
  getDetailedBuildingLodBlend
} from './buildingLod'

type CityscapeDimensions = {
  radius: number
  length: number
  topology?: HabitatTopology
  type?: HabitatType
}

type CityscapeOptions = {
  maxBuildings?: number
  farMinAngularSize?: number
  maxTraffic?: number
  detailedLod0Distance?: number
  detailedLod1Distance?: number
  maxDetailedLod0?: number
  maxDetailedLod1?: number
  // Kenney road-tile overlay range around the player; 0 disables the layer.
  roadTileDistance?: number
}

// mode +1 keeps pixels below threshold (incoming LOD), -1 keeps pixels above
// it (outgoing LOD), and 0 draws the instance normally. Paired layers use the
// same screen-space noise, so every pixel belongs to exactly one LOD.
type BuildingRenderPlacement = {
  building: CityBuilding
  ditherThreshold: number
  ditherMode: -1 | 0 | 1
}

const stableBuildingPlacement = (
  building: CityBuilding
): BuildingRenderPlacement => ({
  building,
  ditherThreshold: 0,
  ditherMode: 0
})

const attachBuildingLodDither = (
  geometry: THREE.BufferGeometry,
  placements: readonly BuildingRenderPlacement[]
) => {
  const values = new Float32Array(placements.length * 2)
  for (let index = 0; index < placements.length; index += 1) {
    values[index * 2] = placements[index].ditherThreshold
    values[index * 2 + 1] = placements[index].ditherMode
  }
  geometry.setAttribute(
    'aLodDither',
    new THREE.InstancedBufferAttribute(values, 2)
  )
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

// Rooftop clutter kits: merged one-piece geometries, instanced across the
// near-arc flat roofs. Unit space: the kit sits on y = 0 and fits inside a
// half-unit footprint, scaled per instance. In the reference skyline almost
// every roof carries SOMETHING and no two neighbours carry the same thing,
// so four kit variants are dealt by building hash.
const ROOF_CLUTTER_VARIANTS = 4

const buildRoofClutterKit = (variant: number) => {
  const parts: THREE.BufferGeometry[] = []

  if (variant === 0) {
    // Utility roof: water tank, AC pair, comms mast.
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
  } else if (variant === 1) {
    // Penthouse roof: stair/elevator house with a vestibule and one AC.
    const penthouse = new THREE.BoxGeometry(0.42, 0.3, 0.34)
    penthouse.translate(-0.1, 0.15, 0.05)
    parts.push(penthouse)

    const penthouseCap = new THREE.BoxGeometry(0.46, 0.04, 0.38)
    penthouseCap.translate(-0.1, 0.32, 0.05)
    parts.push(penthouseCap)

    const vestibule = new THREE.BoxGeometry(0.16, 0.2, 0.14)
    vestibule.translate(0.16, 0.1, 0.12)
    parts.push(vestibule)

    const ac = new THREE.BoxGeometry(0.22, 0.14, 0.18)
    ac.translate(0.2, 0.07, -0.22)
    parts.push(ac)
  } else if (variant === 2) {
    // Comms roof: antenna cluster, tilted dish, equipment cabinets.
    const mastTall = new THREE.CylinderGeometry(0.014, 0.024, 1.1, 5)
    mastTall.translate(-0.18, 0.55, -0.12)
    parts.push(mastTall)

    const mastShort = new THREE.CylinderGeometry(0.012, 0.02, 0.7, 5)
    mastShort.translate(0.05, 0.35, 0.2)
    parts.push(mastShort)

    const dish = new THREE.ConeGeometry(0.14, 0.08, 10, 1, true)
    dish.rotateX(Math.PI * 0.62)
    dish.translate(0.24, 0.16, -0.05)
    parts.push(dish)

    const cabinetA = new THREE.BoxGeometry(0.24, 0.18, 0.16)
    cabinetA.translate(-0.14, 0.09, 0.22)
    parts.push(cabinetA)

    const cabinetB = new THREE.BoxGeometry(0.16, 0.12, 0.14)
    cabinetB.translate(0.22, 0.06, 0.24)
    parts.push(cabinetB)
  } else {
    // Dense Japanese rooftop HVAC yard: repeated outdoor units, round top
    // fans and short duct risers. Kept as one instanced kit so the busy
    // silhouette from the references costs a single draw call.
    for (const [x, z, scale] of [
      [-0.2, -0.18, 1],
      [0.08, -0.16, 0.88],
      [-0.12, 0.14, 0.82],
      [0.2, 0.16, 0.94]
    ] as const) {
      const unit = new THREE.BoxGeometry(0.2 * scale, 0.24 * scale, 0.17 * scale)
      unit.translate(x, 0.12 * scale, z)
      parts.push(unit)

      const fan = new THREE.CylinderGeometry(0.068 * scale, 0.068 * scale, 0.012, 8)
      fan.translate(x, 0.246 * scale, z)
      parts.push(fan)
    }

    const ductA = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6)
    ductA.translate(-0.32, 0.21, 0.25)
    parts.push(ductA)

    const ductB = new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6)
    ductB.translate(0.33, 0.16, -0.28)
    parts.push(ductB)
  }

  const merged = mergeBufferGeometries(parts)

  for (const part of parts) {
    part.dispose()
  }

  // mergeBufferGeometries only returns null for an empty/mismatched list;
  // these lists are fixed, so assert rather than thread null onward.
  if (merged === null) {
    throw new Error('roof clutter kit failed to merge')
  }

  return merged
}

// Ambient traffic: one low-poly car kit shared by every instance. Painted
// body/cabin take instanceColor (material 0); head- and taillight boxes are
// separate material groups so they can glow at night. Local frame: +Z is the
// direction of travel, +Y is up (toward the axis), wheels sit on y = 0.
const buildTrafficCarGeometry = () => {
  const parts: Array<{ geometry: THREE.BufferGeometry; materialIndex: number }> = []

  const body = new THREE.BoxGeometry(1.8, 0.65, 4.3)
  body.translate(0, 0.325, 0)
  parts.push({ geometry: body, materialIndex: 0 })

  const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.1)
  cabin.translate(0, 0.9, -0.25)
  parts.push({ geometry: cabin, materialIndex: 0 })

  const headlights = new THREE.BoxGeometry(1.5, 0.18, 0.08)
  headlights.translate(0, 0.5, 2.16)
  parts.push({ geometry: headlights, materialIndex: 1 })

  const taillights = new THREE.BoxGeometry(1.5, 0.15, 0.08)
  taillights.translate(0, 0.55, -2.16)
  parts.push({ geometry: taillights, materialIndex: 2 })

  const merged = mergeWithMaterialGroups(parts)

  for (const part of parts) {
    part.geometry.dispose()
  }

  if (merged === null) {
    throw new Error('traffic car kit failed to merge')
  }

  return merged
}

// One real-metre utility pole kit for the fixed spawn-side hero district.
// Unlike the normalized buildings it is not stretched by lot dimensions, so
// transformer boxes and crossarms stay human-scale.
const buildUtilityPoleGeometry = () => {
  const parts: THREE.BufferGeometry[] = []

  const pole = new THREE.CylinderGeometry(0.11, 0.14, 8, 7)
  parts.push(pole)

  const crossarm = new THREE.BoxGeometry(2.2, 0.12, 0.13)
  crossarm.translate(0, 3.35, 0)
  parts.push(crossarm)

  const transformer = new THREE.BoxGeometry(0.48, 0.72, 0.38)
  transformer.translate(0, 2.35, 0)
  parts.push(transformer)

  for (const x of [-0.72, 0, 0.72]) {
    const insulator = new THREE.CylinderGeometry(0.055, 0.075, 0.28, 6)
    insulator.translate(x, 3.55, 0)
    parts.push(insulator)
  }

  const merged = mergeBufferGeometries(parts)
  for (const part of parts) {
    part.dispose()
  }
  if (merged === null) {
    throw new Error('utility pole kit failed to merge')
  }
  return merged
}

// Everything update() needs to place one car, precomputed at assignment time.
type TrafficRoute = {
  // 'avenue' runs along the axis at a fixed azimuth; 'street' runs along the
  // arc at a fixed axial position.
  kind: 'avenue' | 'street'
  // Lane centre: azimuth (radians) for avenues, axial metres for streets.
  laneAzimuth: number
  laneAxial: number
  // Travel span: start coordinate (axial metres for avenues, arc metres for
  // streets) and length, plus the road-surface radius the wheels sit on.
  spanStart: number
  spanLength: number
  surfaceRadius: number
  direction: 1 | -1
  speedMetersPerSecond: number
  phaseMeters: number
  scale: number
}

const trafficForward = new THREE.Vector3()
const trafficRight = new THREE.Vector3()

const tangent = new THREE.Vector3()
const inward = new THREE.Vector3()
const binormal = new THREE.Vector3()
const basis = new THREE.Matrix4()
const instanceMatrix = new THREE.Matrix4()
const roadTileYawQuaternion = new THREE.Quaternion()
const localYAxis = new THREE.Vector3(0, 1, 0)
const instanceQuaternion = new THREE.Quaternion()
const instancePosition = new THREE.Vector3()
const instanceScale = new THREE.Vector3()
const instanceColor = new THREE.Color()
const streetFront = new THREE.Vector3()
const streetAlong = new THREE.Vector3()
const axialForward = new THREE.Vector3(0, 1, 0)

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

const HERO_STREET_RADIUS = 180
const MAX_HERO_STREET_DETAILS = 96
const STREET_DETAIL_ARCHETYPES = [
  'shopShutter',
  'shopGlass',
  'vendingPair',
  'serviceCluster',
  'bicycleRack',
  'planterAlley'
] as const satisfies readonly StreetDetailArchetype[]
const COMMERCIAL_STREET_DETAILS = [
  'shopShutter',
  'shopGlass',
  'shopShutter',
  'vendingPair',
  'serviceCluster',
  'bicycleRack',
  'planterAlley'
] as const satisfies readonly StreetDetailArchetype[]
const RESIDENTIAL_STREET_DETAILS = [
  'serviceCluster',
  'bicycleRack',
  'planterAlley',
  'vendingPair'
] as const satisfies readonly StreetDetailArchetype[]

const wrapAngleToPi = (angle: number) => {
  const wrapped = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped
}

const MIRROR_DAY = new THREE.Color(0xffffff)
const MIRROR_NIGHT = new THREE.Color(0x55657a)
const LAMP_DAY = new THREE.Color(0x6b5a40)
const LAMP_NIGHT = new THREE.Color(0xffe2b0)
const HEADLIGHT_DAY = new THREE.Color(0x9aa0a8)
const HEADLIGHT_NIGHT = new THREE.Color(0xfff3cf)
const TAILLIGHT_DAY = new THREE.Color(0x7a2622)
const TAILLIGHT_NIGHT = new THREE.Color(0xff2d1f)
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

const hashUnit = (value: number) => {
  const hashed = Math.sin(value) * 43758.5453123
  return hashed - Math.floor(hashed)
}

// One field-scale albedo: narrow crop rows, exposed earth, wheel tracks and
// drainage seams are baked together so farms gain depth without another map,
// sampler or draw call. The tile is generated locally and mipmapped, so the
// extra resolution costs only about 0.3 MiB of GPU memory.
const createFarmTexture = () => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the farm texture')
  }

  const pixels = context.createImageData(size, size)
  const palettes = [
    [91, 113, 57],
    [137, 128, 67],
    [68, 98, 53],
    [158, 139, 76]
  ] as const
  const rowPixels = 8

  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / rowPixels)
    const palette = palettes[row % palettes.length]
    const acrossRow = (y % rowPixels) / rowPixels
    const ridge = Math.sin(acrossRow * Math.PI) * 10 - 4

    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const grain = hashUnit(x * 12.9898 + y * 78.233) - 0.5
      const broadVariation =
        Math.sin((x / size) * Math.PI * 4 + row * 0.73) * 3 +
        Math.sin((y / size) * Math.PI * 2) * 2
      // A darker trough at each row edge reads as soil between plants; sparse
      // bright flecks break the computer-perfect stripe without becoming noise.
      const trough = acrossRow < 0.16 || acrossRow > 0.84 ? -13 : 0
      const fleck = grain > 0.43 ? 9 : 0
      const shade = ridge + broadVariation + grain * 10 + trough + fleck

      pixels.data[index] = THREE.MathUtils.clamp(palette[0] + shade, 0, 255)
      pixels.data[index + 1] = THREE.MathUtils.clamp(palette[1] + shade, 0, 255)
      pixels.data[index + 2] = THREE.MathUtils.clamp(
        palette[2] + shade * 0.55,
        0,
        255
      )
      pixels.data[index + 3] = 255
    }
  }

  context.putImageData(pixels, 0, 0)

  // Seamless field boundaries and paired tractor tracks. These are deliberately
  // broad enough to survive mipmapping instead of dissolving into shimmer.
  context.fillStyle = 'rgba(68, 61, 39, 0.72)'
  context.fillRect(0, 0, 4, size)
  context.fillRect(size - 4, 0, 4, size)
  context.fillStyle = 'rgba(91, 76, 43, 0.42)'
  for (const trackX of [64, 70, 184, 190]) {
    context.fillRect(trackX, 0, 3, size)
  }
  context.fillStyle = 'rgba(190, 173, 105, 0.22)'
  context.fillRect(6, 0, 2, size)
  context.fillRect(size - 8, 0, 2, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
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

const buildingTone = (
  tone: number,
  urban: number,
  oldTown: number,
  target: THREE.Color
) => {
  // Districts read through the palette: downtown skews glassy blue (higher
  // saturation, fewer warm facades), the countryside keeps plastered warmth.
  // `urban` comes from the same zoning field that drives height/archetype mix,
  // so the colour gradient lines up with the skyline gradient for free. The
  // old town overrides the density cue: it is as dense as downtown but wears
  // the warm plaster/brick of the first construction era, so the axial
  // timeline reads in colour as well as in massing.
  const warmCut = 0.85 - (1 - urban) * 0.25 - 0.5 * oldTown
  const isWarm = tone > warmCut
  const hue = isWarm ? 0.07 : 0.58
  const saturation = isWarm ? 0.2 + 0.05 * oldTown : 0.12 + urban * 0.12
  const lightness = 0.38 + tone * 0.34 - 0.05 * oldTown
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
  context.globalAlpha = alpha * 0.08
  context.fillStyle = color
  context.fillRect(x - width * 0.35, y - height * 0.35, width * 1.7, height * 1.7)
  context.globalAlpha = alpha * 0.68
  context.fillRect(x, y, width, height)
  context.globalAlpha = 1
}

// Optional palette override for a facade texture — the lever behind the
// per-building material variety. Same window grid, different skin: pale tile,
// warm masonry, muted curtain glass, and so on.
type FacadePalette = {
  base: string
  rib: string
  seam?: string
  litChance?: number
  // Unlit pane colour (defaults to cool sky-reflecting glass).
  coolGlass?: string
}

const createFacadeTextureSet = (
  columns: number,
  rows: number,
  variant: FacadeTextureVariant,
  seed: number,
  palette?: FacadePalette
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
  const base =
    palette?.base ?? (isTower ? '#2b3340' : variant === 'warm' ? '#5b6470' : '#414b58')
  const rib =
    palette?.rib ?? (isTower ? '#161d27' : variant === 'warm' ? '#6f6770' : '#2a323d')
  const seam =
    palette?.seam ??
    (isTower ? 'rgba(177, 198, 216, 0.08)' : 'rgba(255, 218, 183, 0.08)')

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
        palette?.litChance ??
        (variant === 'far' ? 0.3 : variant === 'dense' ? 0.22 : isTower ? 0.24 : 0.18)
      const stripChance = isTower ? 0.04 : 0.01
      const lit = random() < litChance
      const color = random() < 0.64 ? '#ffd49a' : random() < 0.86 ? '#e6f2ff' : '#9ff4ff'

      // Unlit panes read as cool sky-reflecting glass, not black holes: in
      // daylight (lifted albedo) they look glazed; at night the low light sinks
      // them dark while the lit/emissive panes carry the glow.
      albedo.fillStyle = lit
        ? 'rgba(232, 216, 190, 0.38)'
        : palette?.coolGlass ?? 'rgba(105, 127, 151, 0.42)'
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

      if (isDense && random() < 0.008) {
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

  // A little large-scale variation prevents sterile repetition, but the former
  // dense sprinkle read as television static once mipmapped across thousands
  // of buildings. Near facades now rely on the modeled ledges for detail.
  for (let index = 0; index < (variant === 'far' ? 220 : 18); index += 1) {
    const x = random() * size
    const y = random() * size
    const width = Math.max(1, size * (variant === 'far' ? 0.004 : 0.006))
    const height = Math.max(1, size * (variant === 'far' ? 0.012 : 0.018))
    albedo.fillStyle = random() < 0.5 ? 'rgba(255, 184, 136, 0.06)' : 'rgba(159, 218, 238, 0.05)'
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

// Fictional, deliberately low-contrast Japanese signboards. They are not
// photo textures: the references inform their proportions and placement,
// while the copy stays inside Spinward's world and avoids real shops/addresses.
const createSignTextureSet = (
  label: string,
  background: string,
  accent: string
): TextureSet => {
  const size = 256
  const { canvas: albedoCanvas, context: albedo } = createCanvas(size)
  const { canvas: emissiveCanvas, context: emissive } = createCanvas(size)

  albedo.fillStyle = background
  albedo.fillRect(0, 0, size, size)
  albedo.strokeStyle = accent
  albedo.lineWidth = 12
  albedo.strokeRect(8, 8, size - 16, size - 16)
  albedo.fillStyle = '#e6e0cf'
  albedo.font = '600 68px sans-serif'
  albedo.textAlign = 'center'
  albedo.textBaseline = 'middle'

  const glyphs = [...label].slice(0, 3)
  glyphs.forEach((glyph, index) => {
    albedo.fillText(glyph, size * 0.5, 52 + index * 76)
  })

  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)
  emissive.strokeStyle = '#66583c'
  emissive.lineWidth = 8
  emissive.strokeRect(10, 10, size - 20, size - 20)
  emissive.fillStyle = '#b7a981'
  emissive.font = '600 68px sans-serif'
  emissive.textAlign = 'center'
  emissive.textBaseline = 'middle'
  glyphs.forEach((glyph, index) => {
    emissive.fillText(glyph, size * 0.5, 52 + index * 76)
  })

  return {
    albedo: finishTexture(albedoCanvas),
    emissive: finishTexture(emissiveCanvas)
  }
}

const disposeTextureSet = (textures: TextureSet) => {
  textures.albedo.dispose()
  textures.emissive.dispose()
}

// Facade wardrobes. Block batches split by a per-building hash across these
// palettes so neighbouring buildings stop wearing the same skin.
const BLOCK_PALETTES: Array<FacadePalette | undefined> = [
  undefined, // the original slate
  {
    base: '#878e94',
    rib: '#5c636b',
    seam: 'rgba(40, 48, 58, 0.12)',
    coolGlass: 'rgba(96, 116, 136, 0.4)'
  }, // pale tile
  {
    base: '#4d423c',
    rib: '#2f2823',
    seam: 'rgba(255, 200, 150, 0.1)',
    litChance: 0.22
  } // warm masonry
]

// Authored towers share one material per instanced batch, so every option must
// remain calm when repeated. The third slot keeps a warmer metal/concrete cast.
const TOWER_PALETTES: Array<FacadePalette | undefined> = [
  undefined,
  undefined,
  {
    base: '#343b42',
    rib: '#20262c',
    seam: 'rgba(208, 190, 170, 0.06)',
    coolGlass: 'rgba(103, 122, 137, 0.38)',
    litChance: 0.2
  }
]

// Deterministic palette pick from fields the building already carries — no
// plan RNG consumed, stable across focus rebuilds.
const facadePaletteIndex = (building: CityBuilding, buckets: number) => {
  const hash = Math.abs(
    Math.sin(building.azimuth * 53.13 + building.axial * 0.271 + building.tone * 17.3)
  )
  return Math.floor(hash * buckets) % buckets
}

const detailedArchetypeForBuilding = (
  building: CityBuilding
): DetailedBuildingArchetype => {
  if (building.kind === 'house') {
    return 'house'
  }
  if (building.kind === 'tower') {
    return 'tower'
  }
  if (building.kind === 'setback') {
    return 'setback'
  }
  if (building.kind === 'slab') {
    return 'slab'
  }
  if (building.kind === 'lshape') {
    return 'lshape'
  }
  return 'residential'
}

export class Cityscape {
  readonly group = new THREE.Group()

  private readonly smallFacadeTextureSets = BLOCK_PALETTES.map((palette, index) =>
    createFacadeTextureSet(
      GRID_WARM.columns,
      GRID_WARM.rows,
      'warm',
      (0x2c1b3a5d ^ (index * 0x9e3779b9)) >>> 0,
      palette
    )
  )
  private readonly largeFacadeTextureSets = BLOCK_PALETTES.map((palette, index) =>
    createFacadeTextureSet(
      GRID_DENSE.columns,
      GRID_DENSE.rows,
      'dense',
      (0x7b42a8e3 ^ (index * 0x9e3779b9)) >>> 0,
      palette
    )
  )
  private readonly towerFacadeTextureSets = TOWER_PALETTES.map((palette, index) =>
    createFacadeTextureSet(
      GRID_TOWER.columns,
      GRID_TOWER.rows,
      'tower',
      (0x4d6b91f0 ^ (index * 0x9e3779b9)) >>> 0,
      palette
    )
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
  private readonly signTextureSets = [
    createSignTextureSet('環街', '#224956', '#b48a4b'),
    createSignTextureSet('星環', '#5b2f2d', '#d2a45d'),
    createSignTextureSet('雨月', '#303d55', '#9db1c7')
  ]

  // Side faces carry the lit-window emissive map; roof and foundation stay
  // plain so towers do not glow from above.
  private readonly buildingSideMaterials = this.smallFacadeTextureSets.map(
    (set) =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.albedo,
        roughness: 0.85,
        metalness: 0.1,
        emissive: new THREE.Color(0xffe2b8),
        emissiveIntensity: 0.65,
        emissiveMap: set.emissive
      })
  )

  private readonly houseBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.houseFacadeTextures.albedo,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.houseFacadeTextures.emissive
  })

  private readonly largeBuildingSideMaterials = this.largeFacadeTextureSets.map(
    (set) =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.albedo,
        roughness: 0.85,
        metalness: 0.1,
        emissive: new THREE.Color(0xffe2b8),
        emissiveIntensity: 0.65,
        emissiveMap: set.emissive
      })
  )

  private readonly towerBuildingSideMaterials = this.towerFacadeTextureSets.map(
    (set) =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.albedo,
        roughness: 0.72,
        metalness: 0.22,
        emissive: new THREE.Color(0xffe2b8),
        emissiveIntensity: 0.75,
        emissiveMap: set.emissive
      })
  )

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

  private readonly buildingSignMaterials = this.signTextureSets.map(
    (set) =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.albedo,
        roughness: 0.65,
        metalness: 0.08,
        emissive: new THREE.Color(0xffdfab),
        emissiveMap: set.emissive,
        emissiveIntensity: 0.35
      })
  )

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

  // No polygonOffset on any land-layer material: the logarithmic depth buffer
  // writes gl_FragDepth, which discards the rasterizer's polygon offset
  // entirely. Layer separation is done with REAL radial gaps instead (see
  // buildRoads / buildPatches).
  private readonly localRoadMaterial = new THREE.MeshStandardMaterial({
    map: this.localRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.localRoadTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide
  })

  private readonly roadMaterial = new THREE.MeshStandardMaterial({
    map: this.arterialRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.arterialRoadTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide
  })

  private readonly parkMaterial = new THREE.MeshStandardMaterial({
    color: 0x33563b,
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide
  })

  private readonly farmMaterial = new THREE.MeshStandardMaterial({
    map: createFarmTexture(),
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide
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

  private readonly utilityPoleMaterial = new THREE.MeshStandardMaterial({
    color: 0x555c60,
    roughness: 0.82,
    metalness: 0.12
  })

  private readonly utilityWireMaterial = new THREE.LineBasicMaterial({
    color: 0x161b1e,
    transparent: true,
    opacity: 0.78
  })

  private readonly streetDetailPaintMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7b2a6,
    roughness: 0.82,
    metalness: 0.04
  })

  private readonly streetDetailMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0x3c464a,
    roughness: 0.58,
    metalness: 0.34
  })

  // Ambient traffic. The body takes per-instance paint; the light strips are
  // unlit and swing between "off plastic" (day) and HDR glow (night) in
  // setDaylight, like the street lamps.
  private readonly trafficBodyMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.55
  })

  private readonly headlightMaterial = new THREE.MeshBasicMaterial({
    color: 0x9aa0a8,
    toneMapped: false
  })

  private readonly taillightMaterial = new THREE.MeshBasicMaterial({
    color: 0x7a2622,
    toneMapped: false
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

  // The expressway girder's side plates. Double-sided because one flat ring
  // geometry serves both faces of the box.
  private readonly expresswayFasciaMaterial = new THREE.MeshStandardMaterial({
    color: 0x77828e,
    roughness: 0.6,
    metalness: 0.25,
    side: THREE.DoubleSide
  })

  // On-ramp ribbons. Double-sided so the spiral needs no winding care, with
  // the residential asphalt skin so the lane reads as road, not structure.
  private readonly expresswayRampMaterial = new THREE.MeshStandardMaterial({
    map: this.localRoadTexture,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide
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

  private farBuildings: THREE.InstancedMesh | null = null
  private cityPlanBuildings: CityBuilding[] = []
  private cityNearBuildings: CityBuilding[] = []
  private cityFocusAzimuth = 0
  private cityFocusAxial = 0
  private cityBatchFocusAzimuth = 0
  private cityBatchFocusAxial = 0
  private archetypeBatches: THREE.InstancedMesh[] = []
  private detailedBuildingBatches: THREE.InstancedMesh[] = []
  private detailedBuildingGeometries: DetailedBuildingGeometryPack | null = null
  private roadTilePack: RoadTileGeometryPack | null = null
  private roadTileMeshes: THREE.InstancedMesh[] = []
  private readonly roadTileDistance: number
  private disposed = false
  // Water tanks / AC units / masts on the near-arc flat roofs. Lives with the
  // building batches (same focus-driven rebuild + dispose cycle).
  private roofClutter: THREE.InstancedMesh[] = []
  // Storefronts and alley props in the spawn-side hero district. Rebuilt with
  // LOD0 buildings and never emitted for the distant city.
  private heroStreetBatches: THREE.InstancedMesh[] = []
  // Ambient traffic: a persistent capacity-sized batch; focus changes only
  // reassign routes, update() moves the cars every frame.
  private traffic: THREE.InstancedMesh | null = null
  private trafficRoutes: TrafficRoute[] = []
  private trafficTime = 0
  private cityPlanRoads: CityRoad[] = []
  private cityExpressway: CityExpressway | null = null
  private expresswayGroup: THREE.Group | null = null
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
  private utilityPoles: THREE.InstancedMesh | null = null
  private utilityWires: THREE.LineSegments | null = null
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
  private readonly farMinAngularSize: number
  private readonly maxTraffic: number
  private readonly detailedLod0Distance: number
  private readonly detailedLod1Distance: number
  private readonly maxDetailedLod0: number
  private readonly maxDetailedLod1: number

  constructor(
    dimensions: CityscapeDimensions,
    options?: CityscapeOptions
  ) {
    this.maxBuildings = options?.maxBuildings
    this.farMinAngularSize = options?.farMinAngularSize ?? 0.004
    this.maxTraffic = options?.maxTraffic ?? 160
    this.detailedLod0Distance = options?.detailedLod0Distance ?? 100
    this.detailedLod1Distance = Math.max(
      this.detailedLod0Distance,
      options?.detailedLod1Distance ?? 350
    )
    this.maxDetailedLod0 = options?.maxDetailedLod0 ?? 180
    this.maxDetailedLod1 = options?.maxDetailedLod1 ?? 700
    this.roadTileDistance = options?.roadTileDistance ?? 0
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
      ...this.buildingSideMaterials,
      this.houseBuildingSideMaterial,
      ...this.largeBuildingSideMaterials,
      ...this.towerBuildingSideMaterials,
      this.farBuildingSideMaterial
    ]) {
      this.installFacadeUvScale(material)
    }
    // Ordered screen-door transitions preserve depth writes and opaque draw
    // order on phones/Quest while making the two authored LOD boundaries blend.
    for (const material of [
      ...this.buildingSideMaterials,
      this.houseBuildingSideMaterial,
      ...this.largeBuildingSideMaterials,
      ...this.towerBuildingSideMaterials,
      this.farBuildingSideMaterial,
      this.buildingRoofMaterial,
      ...this.buildingSignMaterials,
      this.roofClutterMaterial
    ]) {
      this.installBuildingLodDither(material)
    }
    this.installBeaconBlink(this.beaconMaterial)
    this.setDimensions(dimensions)
    void this.loadDetailedBuildingAssets()
    if (this.roadTileDistance > 0) {
      void this.loadRoadTileAssets()
    }
  }

  private async loadRoadTileAssets() {
    try {
      const pack = await loadRoadTileGeometryPack()
      if (this.disposed) {
        disposeRoadTileGeometryPack(pack)
        return
      }

      this.roadTilePack = pack
      this.rebuildRoadTiles()
    } catch (error) {
      // Same contract as the building pack: the painted roads are a complete
      // fallback, so a missing cosmetic GLB never blocks boot.
      console.warn('Road tile pack unavailable; keeping painted roads', error)
    }
  }

  private clearRoadTiles() {
    for (const mesh of this.roadTileMeshes) {
      this.group.remove(mesh)
      mesh.dispose()
    }
    this.roadTileMeshes = []
  }

  // Re-instance the near-player road overlay. Cheap enough to run on every
  // detail-focus step: a full rebuild is a few hundred matrix composes.
  private rebuildRoadTiles() {
    this.clearRoadTiles()

    if (
      this.roadTilePack === null ||
      this.roadTileDistance <= 0 ||
      this.cityPlanRoads.length === 0 ||
      this.radius <= 0
    ) {
      return
    }

    const placements = planRoadTilePlacements({
      roads: this.cityPlanRoads,
      radius: this.radius,
      focusAzimuth: this.cityFocusAzimuth,
      focusAxial: this.cityFocusAxial,
      rangeMeters: this.roadTileDistance
    })

    const byKind = new Map<RoadTileKind, typeof placements>()
    for (const placement of placements) {
      const list = byKind.get(placement.kind) ?? []
      list.push(placement)
      byKind.set(placement.kind, list)
    }

    for (const [kind, list] of byKind) {
      const mesh = new THREE.InstancedMesh(
        this.roadTilePack.geometries[kind],
        this.roadTilePack.material,
        list.length
      )
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      mesh.frustumCulled = false

      for (let index = 0; index < list.length; index += 1) {
        const placement = list[index]
        const cos = Math.cos(placement.azimuth)
        const sin = Math.sin(placement.azimuth)
        tangent.set(-sin, 0, cos)
        inward.set(-cos, 0, -sin)
        binormal.copy(tangent).cross(inward)
        basis.makeBasis(tangent, inward, binormal)
        instanceQuaternion.setFromRotationMatrix(basis)
        roadTileYawQuaternion.setFromAxisAngle(
          localYAxis,
          placement.quarterTurns * (Math.PI / 2)
        )
        instanceQuaternion.multiply(roadTileYawQuaternion)
        instancePosition
          .set(cos, 0, sin)
          .multiplyScalar(this.radius - getRoadTileLiftMeters(this.radius))
          .setY(placement.axial)
        instanceScale.set(
          placement.alongMeters,
          ROAD_TILE_HEIGHT_SCALE,
          placement.crossMeters
        )
        instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
        mesh.setMatrixAt(index, instanceMatrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      this.roadTileMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  private async loadDetailedBuildingAssets() {
    try {
      const pack = await loadDetailedBuildingGeometryPack()
      if (this.disposed) {
        disposeDetailedBuildingGeometryPack(pack)
        return
      }

      this.detailedBuildingGeometries = pack
      if (this.cityNearBuildings.length > 0) {
        this.rebuildNearBuildingBatches()
      }
    } catch (error) {
      // The procedural city is deliberately a complete fallback: a missing or
      // corrupt cosmetic GLB must never keep WebXR from starting.
      console.warn('Detailed building pack unavailable; using procedural city', error)
    }
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

  private installBuildingLodDither(material: THREE.MeshStandardMaterial) {
    const previousCompile = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile(shader, renderer)
      shader.vertexShader =
        'attribute vec2 aLodDither;\nvarying vec2 vLodDither;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vLodDither = aLodDither;'
        )
      shader.fragmentShader =
        'varying vec2 vLodDither;\n' +
        shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' +
            '  float lodNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));\n' +
            '  if (vLodDither.y > 0.5 && lodNoise >= vLodDither.x) discard;\n' +
            '  if (vLodDither.y < -0.5 && lodNoise < vLodDither.x) discard;'
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
    this.updateTraffic(deltaSeconds)
  }

  private updateTraffic(deltaSeconds: number) {
    const mesh = this.traffic

    if (mesh === null || this.trafficRoutes.length === 0) {
      return
    }

    this.trafficTime += deltaSeconds

    for (let index = 0; index < this.trafficRoutes.length; index += 1) {
      const route = this.trafficRoutes[index]
      const progress = THREE.MathUtils.euclideanModulo(
        route.phaseMeters + route.speedMetersPerSecond * this.trafficTime,
        route.spanLength
      )
      // Direction -1 runs the same span backwards, so both lanes wrap without
      // ever reversing mid-road.
      const along =
        route.direction === 1
          ? route.spanStart + progress
          : route.spanStart + route.spanLength - progress

      let azimuth: number
      let axial: number

      if (route.kind === 'avenue') {
        azimuth = route.laneAzimuth
        axial = along
      } else {
        azimuth = route.laneAzimuth + along / Math.max(this.radius, 1e-6)
        axial = route.laneAxial
      }

      const cos = Math.cos(azimuth)
      const sin = Math.sin(azimuth)
      inward.set(-cos, 0, -sin)

      if (route.kind === 'avenue') {
        trafficForward.set(0, route.direction, 0)
      } else {
        trafficForward.set(-sin, 0, cos).multiplyScalar(route.direction)
      }

      // Right-handed car frame: X = up × forward, Y = up (toward the axis),
      // Z = travel direction (the kit's nose).
      trafficRight.copy(inward).cross(trafficForward)
      basis.makeBasis(trafficRight, inward, trafficForward)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition.set(cos, 0, sin).multiplyScalar(route.surfaceRadius).setY(axial)
      instanceScale.setScalar(route.scale)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
    }

    mesh.instanceMatrix.needsUpdate = true
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
    // Only the dark LINEAR infrastructure fades (roads/bridges); the building
    // skyline — the "city overhead" reveal — is untouched, so the far wall
    // still reads. The straight-overhead far side sits at exactly 2R, and a
    // road there is a sub-pixel silhouette that shimmers as the colony spins,
    // so the fade must FINISH by 2R (the old 1.7R..2.9R window left far-side
    // roads at ~75% opacity — visibly crawling). Floored so small habitats
    // never fade. vFogDepth is camera-relative, so it tracks the player.
    this.fadeStart.value = Math.max(radius * 1.2, 800)
    this.fadeEnd.value = Math.max(radius * 1.9, 1600)
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
    this.cityPlanRoads = plan.roads
    this.buildBuildings(plan.buildings)
    this.rebuildRoadTiles()
    this.buildRoads(plan.roads, radius)
    this.buildPatches(plan.patches, radius, length)
    this.buildTrees(plan.trees, radius)
    this.buildLamps(plan.roads, radius, length)
    this.buildHeroUtilities(plan.roads, radius)
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

    this.cityExpressway = plan.expressway

    if (plan.expressway !== null) {
      this.buildExpressway(plan.expressway, radius)
      // Ring routes exist now; deal the fleet again so the viaduct opens
      // with traffic instead of waiting for the next focus step.
      this.rebuildTraffic()
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
    for (const material of this.buildingSideMaterials) {
      material.emissiveIntensity = windowGlow * 1.2
    }
    this.houseBuildingSideMaterial.emissiveIntensity = windowGlow * 1.1
    for (const material of this.largeBuildingSideMaterials) {
      material.emissiveIntensity = windowGlow * 1.75
    }
    for (const material of this.towerBuildingSideMaterials) {
      material.emissiveIntensity = windowGlow * 1.6
    }
    this.farBuildingSideMaterial.emissiveIntensity = windowGlow * 2.1
    this.buildingRoofMaterial.emissiveIntensity = windowGlow * 0.42
    // The facade albedo is authored dark (a night base + lit-window cut-outs);
    // lift it hard through the day so sunlit walls read as a daytime city rather
    // than the dim night skin. Roofs lift too, and dim below 1 at night so only
    // the emissive rooftop details carry.
    const facadeLift = 1 + daylight * 2.6
    for (const material of [
      ...this.buildingSideMaterials,
      this.houseBuildingSideMaterial,
      ...this.largeBuildingSideMaterials,
      ...this.towerBuildingSideMaterials,
      this.farBuildingSideMaterial
    ]) {
      material.color.setScalar(facadeLift)
    }
    this.buildingRoofMaterial.color.setScalar(0.55 + daylight * 1.35)
    for (const material of this.buildingSignMaterials) {
      material.color.setScalar(0.78 + daylight * 0.55)
      material.emissiveIntensity = night * night * 0.75
    }
    this.streetDetailPaintMaterial.color.setScalar(0.58 + daylight * 0.42)
    this.streetDetailMetalMaterial.color.setScalar(0.28 + daylight * 0.34)
    // Windows cool from warm dusk amber toward white/cyan as night falls.
    this.buildingSideMaterials[0].emissive.lerpColors(WINDOW_COOL, WINDOW_WARM, daylight)

    for (const material of [
      ...this.buildingSideMaterials.slice(1),
      this.houseBuildingSideMaterial,
      ...this.largeBuildingSideMaterials,
      ...this.towerBuildingSideMaterials,
      this.farBuildingSideMaterial
    ]) {
      material.emissive.copy(this.buildingSideMaterials[0].emissive)
    }
    // Roads become pale light veins at night; arterials brighter than
    // residential locals so the far-side city reads like a dense network.
    this.roadMaterial.emissiveIntensity = night * 1.55
    this.localRoadMaterial.emissiveIntensity = night * 0.95
    this.lampMaterial.color.lerpColors(LAMP_NIGHT, LAMP_DAY, daylight)
    this.headlightMaterial.color.lerpColors(HEADLIGHT_NIGHT, HEADLIGHT_DAY, daylight)
    this.taillightMaterial.color.lerpColors(TAILLIGHT_NIGHT, TAILLIGHT_DAY, daylight)
    this.axisSpineMaterial.color.lerpColors(SPINE_NIGHT, SPINE_DAY, daylight)
    this.axisSpineMaterial.opacity = 0.35 + daylight * 0.5
    // This runs every daylight tick, so it OWNS the fade values — keep it in
    // lockstep with setDimensions. The fade must finish by the straight-
    // overhead far side (2R) or sub-pixel road silhouettes shimmer there as
    // the colony spins; night lets the glowing grid start dissolving a bit
    // later, but the end never crosses 1.9R.
    if (this.radius > 0) {
      this.fadeStart.value = Math.max(this.radius * (1.2 + night * 0.2), 800)
      this.fadeEnd.value = Math.max(this.radius * 1.9, 1600)
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
    this.disposed = true
    this.clear()
    if (this.detailedBuildingGeometries !== null) {
      disposeDetailedBuildingGeometryPack(this.detailedBuildingGeometries)
      this.detailedBuildingGeometries = null
    }
    if (this.roadTilePack !== null) {
      disposeRoadTileGeometryPack(this.roadTilePack)
      this.roadTilePack = null
    }
    for (const material of [
      ...this.buildingSideMaterials,
      this.houseBuildingSideMaterial,
      ...this.largeBuildingSideMaterials,
      ...this.towerBuildingSideMaterials,
      this.farBuildingSideMaterial,
      ...this.buildingSignMaterials
    ]) {
      material.dispose()
    }
    this.buildingRoofMaterial.dispose()

    for (const set of [
      ...this.smallFacadeTextureSets,
      ...this.largeFacadeTextureSets,
      ...this.towerFacadeTextureSets
    ]) {
      disposeTextureSet(set)
    }
    disposeTextureSet(this.farFacadeTextures)
    disposeTextureSet(this.houseFacadeTextures)
    disposeTextureSet(this.roofTextures)
    for (const set of this.signTextureSets) {
      disposeTextureSet(set)
    }
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
    this.expresswayFasciaMaterial.dispose()
    this.expresswayRampMaterial.dispose()
    this.roofClutterMaterial.dispose()
    this.utilityPoleMaterial.dispose()
    this.utilityWireMaterial.dispose()
    this.streetDetailPaintMaterial.dispose()
    this.streetDetailMetalMaterial.dispose()
    this.landmarkDomeMaterial.dispose()
    this.trafficBodyMaterial.dispose()
    this.headlightMaterial.dispose()
    this.taillightMaterial.dispose()
    this.cableMaterial.dispose()
    this.spineRingMaterial.dispose()
  }

  // Surface-near batches are small and cheap to recreate on fine focus steps;
  // the far batch keeps a persistent capacity-sized buffer and is rewritten
  // only when the coarser focus grid changes (see updateFarBatch).
  private disposeNearBuildingBatches() {
    for (const batch of [
      ...this.roofClutter,
      ...this.heroStreetBatches,
      ...this.archetypeBatches
    ]) {
      if (batch !== null) {
        batch.geometry.dispose()
        this.group.remove(batch)
      }
    }

    // Each detailed batch clones a tiny class-owned GLB source geometry so its
    // per-instance UV buffer can be replaced safely on every focus rebuild.
    for (const batch of this.detailedBuildingBatches) {
      batch.geometry.dispose()
      this.group.remove(batch)
    }

    this.roofClutter = []
    this.heroStreetBatches = []
    this.archetypeBatches = []
    this.detailedBuildingBatches = []
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
    this.clearRoadTiles()
    this.collisionBuildings = []
    this.collisionIndex = buildCityCollisionIndex([], 1, 1)
    this.cityPlanBuildings = []
    this.cityNearBuildings = []
    this.cityPlanRoads = []
    this.trafficRoutes = []
    this.cityExpressway = null

    if (this.expresswayGroup !== null) {
      for (const child of this.expresswayGroup.children) {
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(this.expresswayGroup)
      this.expresswayGroup = null
    }

    if (this.traffic !== null) {
      this.traffic.geometry.dispose()
      this.group.remove(this.traffic)
      this.traffic = null
    }

    this.disposeBuildingBatches()

    for (const patch of this.patchMeshes) {
      patch.geometry.dispose()
      this.group.remove(patch)
    }

    this.patchMeshes = []

    for (const single of [
      this.trees,
      this.lamps,
      this.utilityPoles,
      this.utilityWires,
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
    this.utilityPoles = null
    this.utilityWires = null
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

  // Compatibility for callers that only know the azimuth. Runtime movement
  // uses setFocusSurface so axial travel participates in authored-detail LOD.
  setFocusAzimuth(azimuth: number) {
    this.setFocusSurface(azimuth, this.cityFocusAxial)
  }

  // Two focus grids keep movement smooth without rewriting the 48k-capacity
  // far buffer every few metres. The fine grid rebuilds only nearby GLB and
  // procedural batches; the coarse grid rebuckets near/far buildings.
  setFocusSurface(azimuth: number, axial: number) {
    if (this.cityPlanBuildings.length === 0 || this.radius <= 0) {
      return
    }

    const coarseStepMeters = getCityNearDistance(this.radius) / 3
    const coarseStepRadians = coarseStepMeters / this.radius
    const detailStepMeters = Math.max(
      16,
      Math.min(this.detailedLod0Distance * 0.2, 32)
    )
    const detailStepRadians = detailStepMeters / this.radius
    const detailAzimuth =
      Math.round(azimuth / detailStepRadians) * detailStepRadians
    const detailAxial = Math.round(axial / detailStepMeters) * detailStepMeters
    const batchAzimuth =
      Math.round(azimuth / coarseStepRadians) * coarseStepRadians
    const batchAxial = Math.round(axial / coarseStepMeters) * coarseStepMeters
    const detailChanged =
      Math.abs(wrapAngleToPi(detailAzimuth - this.cityFocusAzimuth)) > 1e-7 ||
      Math.abs(detailAxial - this.cityFocusAxial) > 1e-5
    const batchChanged =
      Math.abs(wrapAngleToPi(batchAzimuth - this.cityBatchFocusAzimuth)) > 1e-7 ||
      Math.abs(batchAxial - this.cityBatchFocusAxial) > 1e-5

    if (!detailChanged && !batchChanged) {
      return
    }

    this.cityFocusAzimuth = detailAzimuth
    this.cityFocusAxial = detailAxial

    if (batchChanged) {
      this.cityBatchFocusAzimuth = batchAzimuth
      this.cityBatchFocusAxial = batchAxial
      this.rebuildBuildingBatches()
    } else {
      this.rebuildNearBuildingBatches()
      this.rebuildTraffic()
    }

    if (detailChanged || batchChanged) {
      this.rebuildRoadTiles()
    }
  }

  private rebuildBuildingBatches() {
    const nearDistance = getCityNearDistance(this.radius)
    const near: CityBuilding[] = []
    const far: CityBuilding[] = []

    for (const building of this.cityPlanBuildings) {
      const distance = getBuildingSurfaceDistance(
        this.radius,
        this.cityBatchFocusAzimuth,
        this.cityBatchFocusAxial,
        building.azimuth,
        building.axial
      )
      if (distance < nearDistance) {
        near.push(building)
      } else {
        far.push(building)
      }
    }

    this.cityNearBuildings = near
    this.updateFarBatch(far)
    this.rebuildNearBuildingBatches()
    this.rebuildTraffic()
  }

  private rebuildNearBuildingBatches() {
    this.disposeNearBuildingBatches()

    let procedural = this.cityNearBuildings.map(stableBuildingPlacement)
    const pack = this.detailedBuildingGeometries

    if (pack !== null) {
      type Candidate = {
        building: CityBuilding
        distance: number
        blend: ReturnType<typeof getDetailedBuildingLodBlend>
      }
      const candidates: Candidate[] = []
      const lod0Candidates: Candidate[] = []
      const lod1Candidates: Candidate[] = []
      const thresholds = {
        lod0Distance: this.detailedLod0Distance,
        lod1Distance: this.detailedLod1Distance,
        lod0TransitionDistance: Math.max(
          24,
          this.detailedLod0Distance * 0.25
        ),
        lod1TransitionDistance: Math.max(
          36,
          this.detailedLod1Distance * 0.12
        )
      }

      for (const building of this.cityNearBuildings) {
        const distance = getBuildingSurfaceDistance(
          this.radius,
          this.cityFocusAzimuth,
          this.cityFocusAxial,
          building.azimuth,
          building.axial
        )
        const candidate = {
          building,
          distance,
          blend: getDetailedBuildingLodBlend(distance, thresholds)
        }
        candidates.push(candidate)

        if (candidate.blend.lod0 > 0) {
          lod0Candidates.push(candidate)
        }
        if (candidate.blend.lod1 > 0) {
          lod1Candidates.push(candidate)
        }
      }

      const byDistance = (a: Candidate, b: Candidate) => a.distance - b.distance
      const selectedLod0 = new Set(
        lod0Candidates
          .sort(byDistance)
          .slice(0, this.maxDetailedLod0)
          .map((candidate) => candidate.building)
      )
      const selectedLod1 = new Set(
        lod1Candidates
          .sort(byDistance)
          .slice(0, this.maxDetailedLod1)
          .map((candidate) => candidate.building)
      )

      const lod0: BuildingRenderPlacement[] = []
      const lod1: BuildingRenderPlacement[] = []
      procedural = []

      for (const candidate of candidates) {
        const { building, blend } = candidate
        const useLod0 = blend.lod0 > 0 && selectedLod0.has(building)
        const useLod1 = blend.lod1 > 0 && selectedLod1.has(building)

        if (useLod0 && useLod1) {
          // LOD0 is outgoing while LOD1 fills the complementary pixels.
          lod0.push({
            building,
            ditherThreshold: blend.lod1,
            ditherMode: -1
          })
          lod1.push({
            building,
            ditherThreshold: blend.lod1,
            ditherMode: 1
          })
        } else if (useLod0) {
          // If a budget cap drops the partner, retain full coverage instead of
          // leaving a screen-door hole in the building.
          lod0.push(stableBuildingPlacement(building))
        } else if (useLod1 && blend.procedural > 0) {
          lod1.push({
            building,
            ditherThreshold: blend.procedural,
            ditherMode: -1
          })
          procedural.push({
            building,
            ditherThreshold: blend.procedural,
            ditherMode: 1
          })
        } else if (useLod1) {
          lod1.push(stableBuildingPlacement(building))
        } else {
          procedural.push(stableBuildingPlacement(building))
        }
      }

      this.buildDetailedBuildingBatches(lod0, 0)
      this.buildDetailedBuildingBatches(lod1, 1)
      this.buildHeroStreetDetails([
        ...new Set([...selectedLod0, ...selectedLod1])
      ])
    }

    this.buildProceduralNearBatches(procedural)
    this.buildRoofClutter(procedural)
  }

  private buildHeroStreetDetails(plan: CityBuilding[]) {
    const pack = this.detailedBuildingGeometries
    if (pack === null || this.radius <= 0) {
      return
    }

    type Placement = {
      building: CityBuilding
      archetype: StreetDetailArchetype
      isAvenue: boolean
      direction: 1 | -1
      frontage: number
      distance: number
    }
    const placements: Placement[] = []

    for (const building of plan) {
      const urban = building.urban ?? DEFAULT_URBAN
      const centerDistance = Math.hypot(
        wrapAngleToPi(building.azimuth) * this.radius,
        building.axial
      )
      if (centerDistance > HERO_STREET_RADIUS || urban < 0.55) {
        continue
      }

      let nearest:
        | {
            isAvenue: boolean
            direction: 1 | -1
            frontage: number
            gap: number
          }
        | null = null

      for (const road of this.cityPlanRoads) {
        const isAvenue = road.axialLength > road.tangentWidth
        const tangentDelta =
          wrapAngleToPi(road.azimuth - building.azimuth) * this.radius
        const axialDelta = road.axial - building.axial
        let gap: number
        let direction: 1 | -1
        let frontage: number

        if (isAvenue) {
          if (
            Math.abs(axialDelta) >
            (road.axialLength + building.depth) * 0.5
          ) {
            continue
          }
          gap =
            Math.abs(tangentDelta) -
            (road.tangentWidth + building.width) * 0.5
          direction = tangentDelta >= 0 ? 1 : -1
          frontage = building.depth
        } else {
          if (
            Math.abs(tangentDelta) >
            (road.tangentWidth + building.width) * 0.5
          ) {
            continue
          }
          gap =
            Math.abs(axialDelta) -
            (road.axialLength + building.depth) * 0.5
          direction = axialDelta >= 0 ? 1 : -1
          frontage = building.width
        }

        // Inner perimeter rows face alleys rather than a generated road. Keep
        // the authored modules on real public frontages and off back gardens.
        if (gap < -0.25 || gap > 14 || (nearest !== null && gap >= nearest.gap)) {
          continue
        }
        nearest = { isAvenue, direction, frontage, gap }
      }

      if (nearest === null) {
        continue
      }

      const hash =
        Math.abs(
          Math.sin(
            building.azimuth * 71.3 +
              building.axial * 0.193 +
              building.tone * 17.1
          )
        ) % 1
      const choices =
        building.kind === 'house' || urban < 0.7
          ? RESIDENTIAL_STREET_DETAILS
          : COMMERCIAL_STREET_DETAILS
      const archetype =
        choices[Math.min(choices.length - 1, Math.floor(hash * choices.length))]

      placements.push({
        building,
        archetype,
        isAvenue: nearest.isAvenue,
        direction: nearest.direction,
        frontage: nearest.frontage,
        distance: centerDistance
      })
    }

    placements.sort((a, b) => a.distance - b.distance)
    placements.length = Math.min(placements.length, MAX_HERO_STREET_DETAILS)

    for (
      let archetypeIndex = 0;
      archetypeIndex < STREET_DETAIL_ARCHETYPES.length;
      archetypeIndex += 1
    ) {
      const archetype = STREET_DETAIL_ARCHETYPES[archetypeIndex]
      const matches = placements.filter(
        (placement) => placement.archetype === archetype
      )
      if (matches.length === 0) {
        continue
      }

      const geometry = pack.street[archetype].clone()
      geometry.computeBoundingBox()
      const bounds = geometry.boundingBox
      if (bounds === null) {
        geometry.dispose()
        continue
      }
      const size = bounds.getSize(new THREE.Vector3())
      const mesh = new THREE.InstancedMesh(
        geometry,
        [
          this.streetDetailPaintMaterial,
          this.streetDetailMetalMaterial,
          this.buildingSignMaterials[archetypeIndex % this.buildingSignMaterials.length]
        ],
        matches.length
      )
      // Sign materials also serve authored buildings and therefore compile the
      // dither shader; zeroed values keep street props fully opaque.
      geometry.setAttribute(
        'aLodDither',
        new THREE.InstancedBufferAttribute(new Float32Array(matches.length * 2), 2)
      )
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      mesh.frustumCulled = false

      for (let index = 0; index < matches.length; index += 1) {
        const placement = matches[index]
        const building = placement.building
        const halfBuildingDepth = placement.isAvenue
          ? building.width * 0.5
          : building.depth * 0.5
        const detailOffset = halfBuildingDepth + size.z * 0.5 + 0.08
        const azimuth = placement.isAvenue
          ? building.azimuth + (placement.direction * detailOffset) / this.radius
          : building.azimuth
        const axial = placement.isAvenue
          ? building.axial
          : building.axial + placement.direction * detailOffset
        const cos = Math.cos(azimuth)
        const sin = Math.sin(azimuth)

        tangent.set(-sin, 0, cos)
        inward.set(-cos, 0, -sin)
        streetFront
          .copy(placement.isAvenue ? tangent : axialForward)
          .multiplyScalar(placement.direction)
        streetAlong.copy(inward).cross(streetFront).normalize()
        basis.makeBasis(streetAlong, inward, streetFront)
        instanceQuaternion.setFromRotationMatrix(basis)
        instancePosition
          .set(cos, 0, sin)
          .multiplyScalar(this.radius - 0.03)
          .setY(axial)

        const stretchFacade =
          archetype === 'shopShutter' ||
          archetype === 'shopGlass' ||
          archetype === 'serviceCluster'
        const frontageScale = stretchFacade
          ? THREE.MathUtils.clamp((placement.frontage * 0.72) / size.x, 0.78, 1.35)
          : 1
        instanceScale.set(frontageScale, 1, 1)
        instanceMatrix.compose(
          instancePosition,
          instanceQuaternion,
          instanceScale
        )
        mesh.setMatrixAt(index, instanceMatrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      this.heroStreetBatches.push(mesh)
      this.group.add(mesh)
    }
  }

  private buildDetailedBuildingBatches(
    plan: BuildingRenderPlacement[],
    lod: 0 | 1
  ) {
    const pack = this.detailedBuildingGeometries
    if (pack === null) {
      return
    }

    for (const archetype of [
      'house',
      'residential',
      'setback',
      'slab',
      'lshape',
      'tower'
    ] as const satisfies readonly DetailedBuildingArchetype[]) {
      const buildings = plan.filter(
        (placement) =>
          detailedArchetypeForBuilding(placement.building) === archetype
      )
      if (buildings.length === 0) {
        continue
      }

      const sideMaterial =
        archetype === 'house'
          ? this.houseBuildingSideMaterial
          : archetype === 'tower'
            ? this.towerBuildingSideMaterials[2]
            : archetype === 'lshape'
              ? this.largeBuildingSideMaterials[2]
              : archetype === 'slab'
                ? this.largeBuildingSideMaterials[1]
                : archetype === 'setback'
                  ? this.largeBuildingSideMaterials[0]
                  : this.buildingSideMaterials[0]
      const grid =
        archetype === 'house'
          ? GRID_HOUSE
          : archetype === 'tower'
            ? GRID_TOWER
            : archetype === 'slab' ||
                archetype === 'setback' ||
                archetype === 'lshape'
              ? GRID_DENSE
              : GRID_WARM
      const signMaterial =
        this.buildingSignMaterials[
          archetype === 'house'
            ? 0
            : archetype === 'residential'
              ? 1
              : archetype === 'setback'
                ? 0
                : 2
        ]
      const batch = this.buildDetailedBuildingBatch(
        buildings,
        pack[archetype][lod],
        sideMaterial,
        signMaterial,
        grid
      )
      this.detailedBuildingBatches.push(batch)
    }
  }

  private buildProceduralNearBatches(near: BuildingRenderPlacement[]) {
    // Near disk: plain blocks split by size so their windows stay
    // window-sized; the shaped archetypes each get their own batch.
    const blocks = near.filter((placement) => placement.building.kind === 'block')
    const small = blocks.filter(
      ({ building }) =>
        Math.max(building.width, building.depth, building.height) <= 25
    )
    const large = blocks.filter(
      ({ building }) =>
        Math.max(building.width, building.depth, building.height) > 25
    )

    // Each size class fans out across the facade palettes, hashed per
    // building, so a street mixes slate, pale-tile and masonry neighbours.
    for (let palette = 0; palette < BLOCK_PALETTES.length; palette += 1) {
      const smallBatch = this.buildBuildingBatch(
        small.filter(
          ({ building }) =>
            facadePaletteIndex(building, BLOCK_PALETTES.length) === palette
        ),
        this.buildingSideMaterials[palette],
        GRID_WARM
      )

      if (smallBatch !== null) {
        this.archetypeBatches.push(smallBatch)
      }

      const largeBatch = this.buildBuildingBatch(
        large.filter(
          ({ building }) =>
            facadePaletteIndex(building, BLOCK_PALETTES.length) === palette
        ),
        this.largeBuildingSideMaterials[palette],
        GRID_DENSE
      )

      if (largeBatch !== null) {
        this.archetypeBatches.push(largeBatch)
      }
    }

    for (const kind of ['setback', 'house', 'slab', 'lshape'] as const) {
      const batch = this.buildArchetypeBatch(
        near.filter((placement) => placement.building.kind === kind),
        kind
      )

      if (batch !== null) {
        this.archetypeBatches.push(batch)
      }
    }

    // Towers split across three restrained skins so the skyline varies without
    // turning into a high-contrast checkerboard in motion.
    const towers = near.filter(
      (placement) => placement.building.kind === 'tower'
    )

    for (let palette = 0; palette < TOWER_PALETTES.length; palette += 1) {
      const batch = this.buildArchetypeBatch(
        towers.filter(
          ({ building }) =>
            facadePaletteIndex(building, TOWER_PALETTES.length) === palette
        ),
        'tower',
        this.towerBuildingSideMaterials[palette]
      )

      if (batch !== null) {
        this.archetypeBatches.push(batch)
      }
    }
  }

  private ensureTrafficMesh() {
    if (this.traffic !== null || this.maxTraffic <= 0) {
      return
    }

    const mesh = new THREE.InstancedMesh(
      buildTrafficCarGeometry(),
      [this.trafficBodyMaterial, this.headlightMaterial, this.taillightMaterial],
      this.maxTraffic
    )
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    this.traffic = mesh
    this.group.add(mesh)
  }

  // Deal the car fleet onto the arterial roads around the focus arc and the
  // plaza's axial band — beyond that a car is sub-pixel, so the whole budget
  // stays where it can be seen. Seeded per focus step: deterministic, and a
  // re-focus reshuffles routes without reallocating the mesh.
  private rebuildTraffic() {
    this.trafficRoutes = []

    if (this.maxTraffic <= 0 || this.radius <= 0 || this.cityPlanRoads.length === 0) {
      if (this.traffic !== null) {
        this.traffic.count = 0
      }
      return
    }

    this.ensureTrafficMesh()
    const mesh = this.traffic

    if (mesh === null) {
      return
    }

    const junctionGap = Math.max(0.03, this.radius * 1.5e-5)
    const laneOffset = getArterialRoadWidth(this.radius, this.length) * 0.22
    // Tight windows on purpose: the fleet size is fixed, so every metre of
    // candidate road dilutes cars-per-metre. Sized for ~one car per 60 m so a
    // street view always has several in sight, like a living city.
    const arcWindow = getCityNearDistance(this.radius) / Math.max(this.radius, 1e-6)
    const axialWindow = Math.max(1200, getCityNearDistance(this.radius) * 1.2)

    type Candidate = {
      road: CityRoad
      isAvenue: boolean
      spanStart: number
      spanLength: number
    }
    const candidates: Candidate[] = []
    let totalSpan = 0

    for (const road of this.cityPlanRoads) {
      if (road.kind !== 'arterial') {
        continue
      }

      const isAvenue = road.axialLength > road.tangentWidth
      const arcDistance = Math.abs(wrapAngleToPi(road.azimuth - this.cityFocusAzimuth))

      if (isAvenue) {
        if (arcDistance > arcWindow) {
          continue
        }

        // Only the stretch of the avenue inside the axial window carries cars.
        const halfLength = road.axialLength * 0.5
        const spanStart = Math.max(
          road.axial - halfLength,
          this.cityFocusAxial - axialWindow
        )
        const spanEnd = Math.min(
          road.axial + halfLength,
          this.cityFocusAxial + axialWindow
        )

        if (spanEnd - spanStart < 60) {
          continue
        }

        candidates.push({ road, isAvenue, spanStart, spanLength: spanEnd - spanStart })
      } else {
        const halfArc = road.tangentWidth * 0.5 / this.radius

        if (
          arcDistance > arcWindow + halfArc ||
          Math.abs(road.axial - this.cityFocusAxial) > axialWindow
        ) {
          continue
        }

        // Arc metres relative to the road's centre azimuth.
        candidates.push({
          road,
          isAvenue,
          spanStart: -road.tangentWidth * 0.5,
          spanLength: road.tangentWidth
        })
      }

      totalSpan += candidates[candidates.length - 1].spanLength
    }

    if (candidates.length === 0 || totalSpan <= 0) {
      mesh.count = 0
      return
    }

    const random = createSeededRandom(0x7a55c0de ^ Math.round(this.cityFocusAzimuth * 1024))
    let count = 0

    // The viaduct gets a dedicated slice of the fleet. Its span is the whole
    // circumference (a seamless 2\u03c0 loop \u2014 the modulo wrap IS the lap), so it
    // would swallow the entire budget if it competed by length.
    const ring = this.cityExpressway

    if (ring !== null) {
      const ringBudget = Math.floor(this.maxTraffic * 0.3)
      const ringCircumference = fullTurn * this.radius

      for (let i = 0; i < ringBudget && count < this.maxTraffic; i += 1) {
        const direction = random() < 0.5 ? 1 : -1

        this.trafficRoutes.push({
          kind: 'street',
          laneAzimuth: 0,
          laneAxial: ring.axial + direction * Math.min(laneOffset, ring.deckWidth * 0.24),
          spanStart: -ringCircumference * 0.5,
          spanLength: ringCircumference,
          surfaceRadius: this.radius - ring.deckHeight,
          direction,
          speedMetersPerSecond: 16 + random() * 8,
          phaseMeters: random() * ringCircumference,
          scale: 0.85 + random() * 0.45
        })

        const paintRoll = random()
        instanceColor.setHSL(
          paintRoll > 0.9 ? random() : 0.6,
          paintRoll > 0.9 ? 0.55 : 0.04 + random() * 0.08,
          0.25 + random() * 0.55
        )
        mesh.setColorAt(count, instanceColor)
        count += 1
      }
    }

    for (const candidate of candidates) {
      if (count >= this.maxTraffic) {
        break
      }

      const share = Math.max(
        1,
        Math.round((this.maxTraffic * candidate.spanLength) / totalSpan)
      )

      for (let i = 0; i < share && count < this.maxTraffic; i += 1) {
        const direction = random() < 0.5 ? 1 : -1
        const surfaceRadius =
          this.radius - 0.2 - (candidate.isAvenue ? junctionGap : 0)

        this.trafficRoutes.push({
          kind: candidate.isAvenue ? 'avenue' : 'street',
          laneAzimuth:
            candidate.road.azimuth +
            (candidate.isAvenue ? (direction * laneOffset) / this.radius : 0),
          laneAxial: candidate.isAvenue
            ? 0
            : candidate.road.axial + direction * laneOffset,
          spanStart: candidate.spanStart,
          spanLength: candidate.spanLength,
          surfaceRadius,
          direction,
          speedMetersPerSecond: 7 + random() * 9,
          phaseMeters: random() * candidate.spanLength,
          scale: 0.85 + random() * 0.45,
          })

        // Mostly white/silver/graphite paint, with the occasional loud one.
        const paintRoll = random()
        instanceColor.setHSL(
          paintRoll > 0.9 ? random() : 0.6,
          paintRoll > 0.9 ? 0.55 : 0.04 + random() * 0.08,
          0.25 + random() * 0.55
        )
        mesh.setColorAt(count, instanceColor)
        count += 1
      }
    }

    mesh.count = count

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    // Place everyone immediately so a focus change never shows a frame of
    // stale cars parked on the old roads.
    this.updateTraffic(0)
  }

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
    geometry.setAttribute(
      'aLodDither',
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
      const chord = getBuildingChordDistance(
        this.radius,
        this.cityBatchFocusAzimuth,
        this.cityBatchFocusAxial,
        building.azimuth,
        building.axial
      )
      const maxDimension = Math.max(building.width, building.depth, building.height)

      // Constant-screen-size cull: below farMinAngularSize radians a building
      // is a few pixels of shimmer fuel, not skyline. The threshold scales
      // with each building's own chord distance, so nothing pops at the
      // near-arc boundary (a 1 km neighbour only needs metres to stay) while
      // the far side keeps just the silhouettes that read.
      if (maxDimension < chord * this.farMinAngularSize) {
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
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, building.oldTown ?? 0, instanceColor)
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

  // One clutter kit (water tank + AC boxes + mast) per qualifying near-disk
  // flat roof. Near only: at far-side distances the kit is sub-pixel, so
  // it would be pure vertex cost. Deterministic without consuming plan RNG —
  // the per-building offsets derive from fields the building already carries.
  private buildRoofClutter(near: BuildingRenderPlacement[]) {
    // Nearly every flat roof qualifies now (10 m+ tall, 6 m+ across); the
    // tallest keep priority under the cap, and roomy roofs (18 m+ across)
    // get a second kit so towers read as busy as the reference skyline.
    const flatRoofed = near
      .filter(
        ({ building }) =>
          (building.kind === 'block' ||
            building.kind === 'setback' ||
            building.kind === 'slab') &&
          building.height >= 10 &&
          Math.min(building.width, building.depth) >= 6
      )
      .sort((a, b) => b.building.height - a.building.height)
      .slice(0, 2000)

    if (flatRoofed.length === 0) {
      return
    }

    type Placement = {
      render: BuildingRenderPlacement
      jitterPhase: number
    }
    const placementsByVariant: Placement[][] = Array.from(
      { length: ROOF_CLUTTER_VARIANTS },
      () => []
    )

    for (const render of flatRoofed) {
      const { building } = render
      // Deterministic variant + jitter from fields the building already
      // carries — no plan RNG consumed.
      const hash = Math.abs(
        Math.sin(building.azimuth * 91.17 + building.axial * 0.173 + building.tone * 37.7)
      )
      const variant = Math.floor(hash * ROOF_CLUTTER_VARIANTS) % ROOF_CLUTTER_VARIANTS
      placementsByVariant[variant].push({ render, jitterPhase: 0 })

      if (Math.min(building.width, building.depth) >= 18) {
        placementsByVariant[(variant + 1) % ROOF_CLUTTER_VARIANTS].push({
          render,
          jitterPhase: 1
        })
      }
    }

    for (let variant = 0; variant < ROOF_CLUTTER_VARIANTS; variant += 1) {
      const placements = placementsByVariant[variant]

      if (placements.length === 0) {
        continue
      }

      const geometry = buildRoofClutterKit(variant)
      attachBuildingLodDither(
        geometry,
        placements.map((placement) => placement.render)
      )
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.roofClutterMaterial,
        placements.length
      )
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      mesh.frustumCulled = false

      for (let index = 0; index < placements.length; index += 1) {
        const { render, jitterPhase } = placements[index]
        const { building } = render
        const cos = Math.cos(building.azimuth)
        const sin = Math.sin(building.azimuth)
        tangent.set(-sin, 0, cos)
        inward.set(-cos, 0, -sin)
        binormal.copy(tangent).cross(inward)
        basis.makeBasis(tangent, inward, binormal)
        instanceQuaternion.setFromRotationMatrix(basis)

        // The setback/slab tops are inset from the footprint, so aim the kit
        // at the upper part's centre and keep the jitter inside it. A second
        // kit (jitterPhase 1) lands on the opposite side of the roof.
        const topCentreTangent = building.kind === 'slab' ? building.width * 0.14 : 0
        const jitterSeed =
          building.tone * 7.31 + building.azimuth * 13.7 + jitterPhase * 2.618
        const jitterSign = jitterPhase === 0 ? 1 : -1
        const jitterT =
          (jitterSeed - Math.floor(jitterSeed) - 0.5) * building.width * 0.16 +
          jitterSign * (jitterPhase === 0 ? 0 : building.width * 0.18)
        const jitterA =
          (jitterSeed * 3.7 - Math.floor(jitterSeed * 3.7) - 0.5) * building.depth * 0.16 +
          jitterSign * (jitterPhase === 0 ? 0 : building.depth * 0.18)
        const kitScale = THREE.MathUtils.clamp(
          Math.min(building.width, building.depth) * 0.4,
          2,
          9
        )

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
      this.roofClutter.push(mesh)
      this.group.add(mesh)
    }
  }

  private buildDetailedBuildingBatch(
    plan: BuildingRenderPlacement[],
    sourceGeometry: THREE.BufferGeometry,
    sideMaterial: THREE.MeshStandardMaterial,
    signMaterial: THREE.MeshStandardMaterial,
    grid: FacadeGrid
  ) {
    const geometry = sourceGeometry.clone()
    const mesh = new THREE.InstancedMesh(
      geometry,
      [sideMaterial, this.buildingRoofMaterial, signMaterial],
      plan.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    const uvScales = new Float32Array(plan.length * 2)

    for (let index = 0; index < plan.length; index += 1) {
      const building = plan[index].building
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
        buildingTone(
          building.tone,
          building.urban ?? DEFAULT_URBAN,
          building.oldTown ?? 0,
          instanceColor
        )
      )
      writeFacadeUvScale(
        (building.width + building.depth) * 0.5,
        building.height,
        grid,
        uvScales,
        index * 2
      )
    }

    geometry.setAttribute(
      'aUvScale',
      new THREE.InstancedBufferAttribute(uvScales, 2)
    )
    attachBuildingLodDither(geometry, plan)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }
    this.group.add(mesh)
    return mesh
  }

  private buildArchetypeBatch(
    plan: BuildingRenderPlacement[],
    kind: BuildingKind,
    sideMaterialOverride?: THREE.MeshStandardMaterial
  ): THREE.InstancedMesh | null {
    if (plan.length === 0) {
      return null
    }

    const geometry = buildArchetypeGeometry(kind)

    if (geometry === null) {
      return null
    }

    // Houses are small: the coarse window grid fits; the tall shapes use
    // the dense one. Slab/lshape borrow distinct block palettes so the shaped
    // archetypes join the wardrobe variety for free.
    const sideMaterial =
      sideMaterialOverride ??
      (kind === 'house'
        ? this.houseBuildingSideMaterial
        : kind === 'slab'
          ? this.largeBuildingSideMaterials[1]
          : kind === 'lshape'
            ? this.largeBuildingSideMaterials[2]
            : this.largeBuildingSideMaterials[0])
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
      const building = plan[index].building
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
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, building.oldTown ?? 0, instanceColor)
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
    attachBuildingLodDither(geometry, plan)
    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.group.add(mesh)
    return mesh
  }

  private buildBuildingBatch(
    plan: BuildingRenderPlacement[],
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
      const building = plan[index].building
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
        buildingTone(building.tone, building.urban ?? DEFAULT_URBAN, building.oldTown ?? 0, instanceColor)
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
    attachBuildingLodDither(geometry, plan)

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
        // every junction, so avenues ride higher and pass cleanly OVER the
        // cross streets. The gap must outrun the log depth buffer's quantum,
        // which grows with distance: at the far side of the cylinder (2R) one
        // depth step is ~R·1.7e-6 m, so a fixed 3 cm gap thins to ~6 steps on
        // Izma and LOSES on Elysium — scale it with the habitat instead.
        const junctionGap = Math.max(0.03, radius * 1.5e-5)
        const roadRadius = radius - 0.2 - (isAvenue ? junctionGap : 0)
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
    // One full texture tile stays field-scale even on multi-km habitats. Its
    // 32 narrow rows land around 0.6–0.9 m apart at this world size.
    const textureWorld = Math.min(getCityCellSize(radius, length) * 0.65, 24)

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
          // Constant world-size crop rows regardless of patch size. Rotate and
          // phase each field from its position so adjacent blocks do not repeat
          // in lockstep. All variation remains in one merged mesh/material.
          const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
          const seed = patch.azimuth * 1729.31 + patch.axial * 0.173
          const rotated = hashUnit(seed + 11.7) > 0.58
          const offsetU = hashUnit(seed + 37.1)
          const offsetV = hashUnit(seed + 83.9)
          const tangentTiles = patch.tangentExtent / textureWorld
          const axialTiles = patch.axialExtent / textureWorld

          for (let i = 0; i < uv.count; i += 1) {
            const u = uv.getX(i)
            const v = uv.getY(i)
            uv.setXY(
              i,
              (rotated ? v * axialTiles : u * tangentTiles) + offsetU,
              (rotated ? u * tangentTiles : v * axialTiles) + offsetV
            )
          }

          // Mild per-field tint multiplies the shared albedo in the existing
          // material, making neighbouring crops/fallow plots distinct at no
          // fragment-sampling cost.
          const tintChoices = [0xe4efd0, 0xf1ddb7, 0xd2e5bd, 0xe5cfaa]
          const tint = new THREE.Color(
            tintChoices[Math.floor(hashUnit(seed + 149.3) * tintChoices.length)]
          )
          const colors = new Float32Array(
            geometry.getAttribute('position').count * 3
          )
          for (let i = 0; i < colors.length; i += 3) {
            colors[i] = tint.r
            colors[i + 1] = tint.g
            colors[i + 2] = tint.b
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
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

  // A compact Japanese utility network around the spawn crossroads. Full-city
  // wires would alias badly and waste Quest budget, so this is intentionally a
  // 260 m hero district: enough for the first drive and the expressway ramp
  // approach, absent from the far skyline.
  private buildHeroUtilities(roads: CityRoad[], radius: number) {
    const heroRadius = 260
    const spacing = 32
    const poleHeight = 8
    const roadCandidates = roads
      .filter((road) => road.kind === 'local')
      .map((road) => {
        const isAvenue = road.axialLength > road.tangentWidth
        const centerTangent = wrapAngleToPi(road.azimuth) * radius
        const distance = isAvenue
          ? Math.abs(centerTangent)
          : Math.hypot(
              Math.max(0, Math.abs(centerTangent) - road.tangentWidth * 0.5),
              road.axial
            )
        return { road, isAvenue, centerTangent, distance }
      })
      .filter((candidate) => candidate.distance < heroRadius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)

    type PolePoint = { azimuth: number; axial: number; isAvenue: boolean }
    const runs: PolePoint[][] = []
    const points: PolePoint[] = []

    for (let runIndex = 0; runIndex < roadCandidates.length; runIndex += 1) {
      const { road, isAvenue, centerTangent } = roadCandidates[runIndex]
      const halfSpan = (isAvenue ? road.axialLength : road.tangentWidth) * 0.5
      const center = isAvenue ? road.axial : centerTangent
      const start = Math.max(center - halfSpan, -heroRadius)
      const end = Math.min(center + halfSpan, heroRadius)
      const count = Math.floor((end - start) / spacing)

      if (count < 2) {
        continue
      }

      const side = runIndex % 2 === 0 ? 1 : -1
      const edgeOffset =
        (isAvenue ? road.tangentWidth : road.axialLength) * 0.5 + 1.2
      const run: PolePoint[] = []

      for (let index = 0; index <= count; index += 1) {
        const coordinate = start + (index / count) * (end - start)
        const point = isAvenue
          ? {
              azimuth: road.azimuth + (side * edgeOffset) / radius,
              axial: coordinate,
              isAvenue
            }
          : {
              azimuth: coordinate / radius,
              axial: road.axial + side * edgeOffset,
              isAvenue
            }
        run.push(point)
        points.push(point)
      }

      runs.push(run)
    }

    if (points.length === 0) {
      return
    }

    const poleGeometry = buildUtilityPoleGeometry()
    const poles = new THREE.InstancedMesh(
      poleGeometry,
      this.utilityPoleMaterial,
      points.length
    )
    poles.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    poles.frustumCulled = false
    const quarterTurn = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI * 0.5
    )
    instanceScale.set(1, 1, 1)

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const cos = Math.cos(point.azimuth)
      const sin = Math.sin(point.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      if (!point.isAvenue) {
        instanceQuaternion.multiply(quarterTurn)
      }
      instancePosition
        .set(cos, 0, sin)
        .multiplyScalar(radius - poleHeight * 0.5)
        .setY(point.axial)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      poles.setMatrixAt(index, instanceMatrix)
    }

    poles.instanceMatrix.needsUpdate = true
    this.utilityPoles = poles
    this.group.add(poles)

    const wirePositions: number[] = []
    const writeWirePoint = (
      point: PolePoint,
      crossarmOffset: number,
      wireRadius: number
    ) => {
      const azimuth = point.isAvenue
        ? point.azimuth + crossarmOffset / radius
        : point.azimuth
      const axial = point.isAvenue
        ? point.axial
        : point.axial + crossarmOffset
      wirePositions.push(
        Math.cos(azimuth) * wireRadius,
        axial,
        Math.sin(azimuth) * wireRadius
      )
    }

    for (const run of runs) {
      for (let index = 0; index < run.length - 1; index += 1) {
        const start = run[index]
        const end = run[index + 1]
        const middle: PolePoint = {
          azimuth: (start.azimuth + end.azimuth) * 0.5,
          axial: (start.axial + end.axial) * 0.5,
          isAvenue: start.isAvenue
        }

        for (const offset of [-0.72, 0, 0.72]) {
          writeWirePoint(start, offset, radius - poleHeight + 0.25)
          writeWirePoint(middle, offset, radius - poleHeight + 0.9)
          writeWirePoint(middle, offset, radius - poleHeight + 0.9)
          writeWirePoint(end, offset, radius - poleHeight + 0.25)
        }
      }
    }

    const wireGeometry = new THREE.BufferGeometry()
    wireGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(wirePositions, 3)
    )
    wireGeometry.computeBoundingSphere()
    const wires = new THREE.LineSegments(wireGeometry, this.utilityWireMaterial)
    this.utilityWires = wires
    this.group.add(wires)
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
  // The elevated expressway: one full-circumference deck riding 18 m over the
  // corridor the plan kept clear, on pylons that dodge windows and roofs. The
  // deck reuses the arterial road material (lane markings, night glow,
  // distance fade) and the window-bridge edge material, so it reads as the
  // same road network lifted into the air.
  private buildExpressway(expressway: CityExpressway, radius: number) {
    const group = new THREE.Group()
    const deckRadius = radius - expressway.deckHeight
    const fullTurnSegments = getArcSegments(fullTurn, radius)

    const deck = new THREE.CylinderGeometry(
      deckRadius,
      deckRadius,
      expressway.deckWidth,
      fullTurnSegments,
      1,
      true,
      0,
      fullTurn
    )
    deck.translate(0, expressway.axial, 0)
    bakeRoadUvs(deck, fullTurn * deckRadius, true)
    const deckMesh = new THREE.Mesh(deck, this.roadMaterial)
    deckMesh.renderOrder = 1
    group.add(deckMesh)

    // Box girder under the roadway: a soffit band 2 m below the deck plus a
    // flat ring fascia closing each side, so the structure has real depth —
    // a bare single-sided band reads as paper and the traffic on it as
    // flying. The soffit faces the ground (default front side, normals away
    // from the axis), unlike the road surfaces above it.
    const girderDepth = 2
    const soffit = new THREE.CylinderGeometry(
      deckRadius + girderDepth,
      deckRadius + girderDepth,
      expressway.deckWidth,
      fullTurnSegments,
      1,
      true
    )
    soffit.translate(0, expressway.axial, 0)
    group.add(new THREE.Mesh(soffit, this.towerMaterial))

    for (const side of [-1, 1]) {
      const fascia = new THREE.RingGeometry(
        deckRadius,
        deckRadius + girderDepth,
        fullTurnSegments,
        1
      )
      // RingGeometry lives in the XY plane; stand it perpendicular to the
      // cylinder axis so it closes the girder's side, visible from ±Y.
      fascia.rotateX(Math.PI * 0.5)
      fascia.translate(0, expressway.axial + side * (expressway.deckWidth * 0.5), 0)
      group.add(new THREE.Mesh(fascia, this.expresswayFasciaMaterial))
    }

    // Parallel service pipes under the box girder. Five continuous low-poly
    // rings capture the photographed Japanese viaduct underside without
    // scattering thousands of fittings around the full habitat.
    const pipeGeometries: THREE.BufferGeometry[] = []
    const pipeSegments = Math.min(fullTurnSegments, 360)
    for (const offset of [-0.34, -0.17, 0, 0.17, 0.34]) {
      const pipe = new THREE.TorusGeometry(
        deckRadius + girderDepth + 0.32,
        0.075,
        5,
        pipeSegments
      )
      pipe.rotateX(Math.PI * 0.5)
      pipe.translate(0, expressway.axial + offset * expressway.deckWidth, 0)
      pipeGeometries.push(pipe)
    }
    const pipeBundle = mergeBufferGeometries(pipeGeometries)
    for (const geometry of pipeGeometries) {
      geometry.dispose()
    }
    if (pipeBundle !== null) {
      group.add(new THREE.Mesh(pipeBundle, this.utilityPoleMaterial))
    }

    // Guard rails: thin bright bands standing proud of the deck edges.
    for (const side of [-1, 1]) {
      const rail = new THREE.CylinderGeometry(
        deckRadius - 0.9,
        deckRadius - 0.9,
        0.3,
        fullTurnSegments,
        1,
        true
      )
      rail.translate(0, expressway.axial + side * (expressway.deckWidth * 0.5 - 0.15), 0)
      group.add(new THREE.Mesh(rail, this.bridgeEdgeMaterial))
    }

    // On-ramps: spiral ribbons following the exact linear climb the physics
    // treads and getExpresswayElevation use, one per land strip. Past the top
    // the collector wedge (below) carries the lane onto the deck.
    const rampInner = expressway.axial + expressway.deckWidth * 0.5
    const rampOuter = rampInner + expressway.rampWidth

    for (const ramp of expressway.ramps) {
      const steps = 48
      // The lane runs past both ends of the climb: a flat street-level apron
      // (~15% of the span) leading in, and a short merge shelf at deck height
      // — without them the ramp poked out of the grass with no road to it.
      const tStart = -0.15
      const tEnd = 1.06
      const positions = new Float32Array((steps + 1) * 2 * 3)
      const uvs = new Float32Array((steps + 1) * 2 * 2)
      const indices: number[] = []
      // Visually the lane sits at the road surface (R - 0.22, matching the
      // lifted street bands), climbing to the deck surface exactly.
      const baseLift = 0.22

      for (let index = 0; index <= steps; index += 1) {
        const t = tStart + (index / steps) * (tEnd - tStart)
        const climb = Math.max(0, Math.min(1, t))
        const angle = ramp.azimuthStart + t * ramp.azimuthSpan
        const surfaceRadius =
          radius - baseLift - (expressway.deckHeight - baseLift) * climb
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        for (const [edge, axial] of [
          [0, rampInner],
          [1, rampOuter]
        ] as const) {
          const vertex = (index * 2 + edge) * 3
          positions[vertex] = cos * surfaceRadius
          positions[vertex + 1] = axial
          positions[vertex + 2] = sin * surfaceRadius
          const uv = (index * 2 + edge) * 2
          uvs[uv] = edge
          uvs[uv + 1] = (t * ramp.azimuthSpan * radius) / 12
        }

        if (index < steps) {
          const a = index * 2
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }

      const ribbon = new THREE.BufferGeometry()
      ribbon.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      ribbon.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      ribbon.setIndex(indices)
      ribbon.computeVertexNormals()
      group.add(new THREE.Mesh(ribbon, this.expresswayRampMaterial))

      // Lit edge lines along the whole climbing lane — the entrance must be
      // unmissable on the tarmac, day or night (the apron itself only reads
      // as \"a slightly different road\" from a car seat).
      for (const edgeAxial of [rampInner + 0.35, rampOuter - 0.35]) {
        const edgePositions = new Float32Array((steps + 1) * 2 * 3)
        const edgeIndices: number[] = []

        for (let index = 0; index <= steps; index += 1) {
          const t = tStart + (index / steps) * (tEnd - tStart)
          const climb = Math.max(0, Math.min(1, t))
          const angle = ramp.azimuthStart + t * ramp.azimuthSpan
          const lineRadius =
            radius - baseLift - (expressway.deckHeight - baseLift) * climb - 0.06
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)

          for (const [edge, offset] of [
            [0, -0.3],
            [1, 0.3]
          ] as const) {
            const vertex = (index * 2 + edge) * 3
            edgePositions[vertex] = cos * lineRadius
            edgePositions[vertex + 1] = edgeAxial + offset
            edgePositions[vertex + 2] = sin * lineRadius
          }

          if (index < steps) {
            const a = index * 2
            edgeIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
          }
        }

        const edgeGeometry = new THREE.BufferGeometry()
        edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3))
        edgeGeometry.setIndex(edgeIndices)
        edgeGeometry.computeVertexNormals()
        group.add(new THREE.Mesh(edgeGeometry, this.bridgeEdgeMaterial))
      }

      // One-way chevrons down the lane centre: the ramp only lifts traffic
      // travelling +azimuth, and from a car seat the climb looks identical
      // from either end — drivers coming the other way used to sail under
      // the visual ramp at street level, reading it as \"fell through\".
      const chevronCount = 14
      const chevronPositions = new Float32Array(chevronCount * 3 * 3)
      const laneCentreAxial = rampInner + expressway.rampWidth * 0.5

      for (let index = 0; index < chevronCount; index += 1) {
        const t = 0.02 + (index / chevronCount) * 0.95
        const angle = ramp.azimuthStart + t * ramp.azimuthSpan
        const climb = Math.max(0, Math.min(1, t))
        const chevronRadius =
          radius - baseLift - (expressway.deckHeight - baseLift) * climb - 0.08
        const tipAngle = angle + 4 / radius

        const write = (slot: number, pointAngle: number, axial: number) => {
          const base = (index * 3 + slot) * 3
          chevronPositions[base] = Math.cos(pointAngle) * chevronRadius
          chevronPositions[base + 1] = axial
          chevronPositions[base + 2] = Math.sin(pointAngle) * chevronRadius
        }

        write(0, angle, laneCentreAxial - 2.2)
        write(1, angle, laneCentreAxial + 2.2)
        write(2, tipAngle, laneCentreAxial)
      }

      const chevrons = new THREE.BufferGeometry()
      chevrons.setAttribute('position', new THREE.BufferAttribute(chevronPositions, 3))
      chevrons.computeVertexNormals()
      group.add(new THREE.Mesh(chevrons, this.bridgeEdgeMaterial))
    }

    // Collector wedges: past each ramp top the deck widens to under the lane
    // and a lit barrier runs diagonally back to the main carriageway, so the
    // merge reads on the tarmac exactly where the physics funnels you.
    for (const ramp of expressway.ramps) {
      const collectorStart = ramp.azimuthStart + ramp.azimuthSpan
      const collectorArc = expressway.collectorSpan
      const segments = getArcSegments(collectorArc, radius)

      const band = new THREE.CylinderGeometry(
        deckRadius,
        deckRadius,
        expressway.rampWidth,
        segments,
        1,
        true,
        getThetaStart(collectorStart + collectorArc * 0.5, collectorArc),
        collectorArc
      )
      band.translate(0, rampInner + expressway.rampWidth * 0.5, 0)
      bakeRoadUvs(band, collectorArc * deckRadius, true)
      const bandMesh = new THREE.Mesh(band, this.roadMaterial)
      bandMesh.renderOrder = 1
      group.add(bandMesh)

      // The funnel barrier: a thin bright wall from the lane's outer edge at
      // the collector mouth, tapering to the deck edge at its end.
      const barrierSteps = 24
      const barrierPositions = new Float32Array((barrierSteps + 1) * 2 * 3)
      const barrierIndices: number[] = []

      for (let index = 0; index <= barrierSteps; index += 1) {
        const t = index / barrierSteps
        const angle = collectorStart + t * collectorArc
        const axial = rampOuter + (rampInner - rampOuter) * t
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        for (const [edge, barrierRadius] of [
          [0, deckRadius],
          [1, deckRadius - 1.1]
        ] as const) {
          const vertex = (index * 2 + edge) * 3
          barrierPositions[vertex] = cos * barrierRadius
          barrierPositions[vertex + 1] = axial
          barrierPositions[vertex + 2] = sin * barrierRadius
        }

        if (index < barrierSteps) {
          const a = index * 2
          barrierIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }

      const barrier = new THREE.BufferGeometry()
      barrier.setAttribute('position', new THREE.BufferAttribute(barrierPositions, 3))
      barrier.setIndex(barrierIndices)
      barrier.computeVertexNormals()
      group.add(new THREE.Mesh(barrier, this.bridgeEdgeMaterial))
    }

    // Pylons every ~75 m of arc, skipped over the window strips (the deck
    // spans them like the existing bridges) and over any roof tall enough to
    // reach it — the corridor keeps buildings out, but block edges lean in.
    const pylonCount = Math.max(8, Math.floor((fullTurn * radius) / 75))
    const pylonSpots: number[] = []

    for (let index = 0; index < pylonCount; index += 1) {
      const azimuth = (index / pylonCount) * fullTurn

      if (!isAzimuthOnLandArc(azimuth, this.topology)) {
        continue
      }

      if (
        getCityGroundHeight(
          this.collisionIndex,
          radius,
          azimuth,
          expressway.axial,
          expressway.deckHeight - 1
        ) > 0.5
      ) {
        continue
      }

      pylonSpots.push(azimuth)
    }

    if (pylonSpots.length > 0) {
      const pylonGeometry = new THREE.BoxGeometry(1, 1, 1)
      const pylons = new THREE.InstancedMesh(
        pylonGeometry,
        this.towerMaterial,
        pylonSpots.length
      )
      pylons.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      pylons.frustumCulled = false

      for (let index = 0; index < pylonSpots.length; index += 1) {
        const azimuth = pylonSpots[index]
        const cos = Math.cos(azimuth)
        const sin = Math.sin(azimuth)
        tangent.set(-sin, 0, cos)
        inward.set(-cos, 0, -sin)
        binormal.copy(tangent).cross(inward)
        basis.makeBasis(tangent, inward, binormal)
        instanceQuaternion.setFromRotationMatrix(basis)
        instancePosition
          .set(cos, 0, sin)
          .multiplyScalar(radius - expressway.deckHeight * 0.5)
          .setY(expressway.axial)
        instanceScale.set(2.4, expressway.deckHeight, 3.4)
        instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
        pylons.setMatrixAt(index, instanceMatrix)
      }

      pylons.instanceMatrix.needsUpdate = true
      group.add(pylons)
    }

    this.expresswayGroup = group
    this.group.add(group)
  }

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
