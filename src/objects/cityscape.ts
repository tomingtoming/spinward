import { planExpresswayRainRoofs, sampleRainShelter, type RainArcRoof, type RainRoof } from './rainShelter'
import { RiverDistrictLayer } from './riverDistrict'
import {planRiverTraffic, sampleRiverTraffic, trafficFollowingGap, riverTrafficYieldGap, type RiverTrafficLoop} from './riverTraffic'
import { planRiverDistrict, sampleRiverRoad, type RiverDistrict } from './riverDistrictPlan'
import {buildingRoofAttachment} from './buildingRoofAttachment'
import {ColonyBuildings} from './colonyBuildings'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {AuthoredCityBlock} from './authoredCityBlock'
import {cityBlockSpec,cityBlockCollision} from './authoredCityBlockPlan'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {createLandscapeCrown,createMeadowTexture} from './landscapeVegetation'
import { sampleNeighborhoodTurn, junctionMajorBusy, turnYieldGap, TURN_APPROACH, TURN_LENGTH, type NeighborhoodTurn } from './neighborhoodTurn'
import { advanceTraffic, canSpawnTrafficAt, crossingGap, fillLaneLeaderGaps, type CrossingGate } from './trafficMotion'
import { planTrafficRoadSpans, remapTrafficMotion, trafficRoadKey, trafficRoadSeed, type TrafficRoadSpan } from './trafficRoadSpans'
import { createTrafficSignalIndex, routeTrafficSignals, trafficSignalGap, type TrafficSignalStop } from './intersectionSignals'
import { planNyaanApartment } from './nyaanApartment'
import { planCoffeeStation, type CoffeeStation } from '../app/coffeeService'
import { NeighborhoodFronts, neighborhoodPoint, matchNeighborhoodLot } from './neighborhoodFronts'
import { planRoomSeats, type RoomSeat } from '../app/roomSeating'
import { BuildingInteriorLayer } from './buildingInteriorLayer'
import { LOBBY_PILOT, matchesAuthoredPilot } from './cafePilot'
import { planBuildingInteriors, interiorCollisionBuildings, type BuildingInterior } from './buildingInteriors'
import * as THREE from 'three'
import { OldTownBlock } from './oldTownBlock'
import { planCarShareBay, type CarShareBay } from './carShare'
import { CivicDetails } from './civicDetails'
import { planPublicUnderpass } from './publicUnderpass'
import { planPublicPark } from './publicPark'
import { StreetAccessLayer } from './streetAccessLayer'
import { STREET_PROFILES, streetLaneCenters, streetLaneDividers } from './streetProfile'
import { buildRoadTileSurface } from './roadTileSurface'
import { compileRoadNetwork } from './roadNetwork'
import { buildRoadSurfaceGeometry } from './roadSurfaceGeometry'

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
  type CityBuilding,
  type CityCollisionIndex,
  type CityExpressway,
  type CityPlan,
  type CityPatch,
  type CityRoad,
  type CityTower,
  type CityTree
} from './cityLayout'
import { mergeBufferGeometries } from './cylinder'
import { createWindowGlassTexture } from './cylinderSurface'
import {
  kenneyPickForBuilding,
  disposeKenneyCarGeometryPack,
  loadKenneyCarGeometryPack,
  type KenneyCarGeometryPack
} from './buildingAssets'
import {
  getRoadTileLiftMeters,
  planRoadTilePlacements,
  ROAD_TILE_HEIGHT_SCALE
} from './roadTiles'
import { getBuildingSurfaceDistance } from './buildingLod'

type CityscapeDimensions = {
  radius: number
  length: number
  topology?: HabitatTopology
  type?: HabitatType
}

type CityscapeOptions = {
  maxBuildings?: number
  maxTraffic?: number
  focusStepMeters?: number
  // Kenney road-tile overlay range around the player; 0 disables the layer.
  roadTileDistance?: number
}

const fullTurn = Math.PI * 2

// Same azimuth -> CylinderGeometry theta conversion used by CylinderHabitat.
export const getThetaStart = (centerAzimuth: number, arcRadians: number) =>
  THREE.MathUtils.euclideanModulo(
    Math.PI * 0.5 - centerAzimuth - arcRadians * 0.5,
    fullTurn
  )

// Merge the procedural fallback car body and its lights into one mesh.
// Each part retains its own material group.
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
  path?: RiverTrafficLoop
  id: string
  variant: number
  color: number
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
  motion?: { progress: number; speed: number }
  signals?: readonly TrafficSignalStop[]
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
const treeYawScratch = new THREE.Quaternion()
const unitY = new THREE.Vector3(0, 1, 0)
const instanceColor = new THREE.Color()

const getSpineRadius = (radius: number) => Math.max(0.35, radius * 0.012)

// Arc tessellation by sagitta budget: a fixed angular step chords meters on
// kilometer-radius habitats (4 deg at izma sagged road bands ~2m above the
// ground every 223m). 2cm keeps surface bands flush at every scale.

export const getArcSegments = (arcRadians: number, radius: number, tolerance = 0.02) => {
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
const HEADLIGHT_DAY = new THREE.Color(0x9aa0a8)
const HEADLIGHT_NIGHT = new THREE.Color(0xfff3cf)
const TAILLIGHT_DAY = new THREE.Color(0x7a2622)
const TAILLIGHT_NIGHT = new THREE.Color(0xff2d1f)
const SPINE_DAY = new THREE.Color(0xffeec4)
const SPINE_NIGHT = new THREE.Color(0x8a7f63)
// Night city signature: luminous road veins, red rooftop beacons, and windows
// that cool from warm dusk amber toward white/cyan at deep night.
export const ROAD_GLOW = new THREE.Color(0xbff7ff)
const BEACON_COLOR = new THREE.Color(0xff2e2a)
// An obstruction light fixture is about half a metre across. Up close that is
// what you should see; far away the vertex shader grows the sphere so it never
// drops below a pixel or so (setBeaconScreenScale), the way a real point light
// stays visible long after its housing is sub-pixel.
const BEACON_PHYSICAL_RADIUS = 0.12
const BEACON_MAX_GROW = 60
export const WINDOW_WARM = new THREE.Color(0xffe2b8)
export const WINDOW_COOL = new THREE.Color(0xdfeaff)

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

// The painted roads are the far LOD of the Kenney tile overlay, so the day
// albedo speaks the tile colormap's language: the same asphalt grey, the same
// muted blue-grey lane paint, the same orange centre line. Markings that used
// to be near-white on near-black read as a fluorescent grid from a distance —
// exactly the seam the overlay was supposed to hide.
const drawRoadSurface = (
  context: CanvasRenderingContext2D,
  size: number,
  kind: 'arterial' | 'collector' | 'local',
  style: 'albedo' | 'glow'
) => {
  // The glow variant keeps the legacy near-black base and bright markings:
  // it feeds the emissiveMap, so the night city keeps its teal-grid signature
  // even though the daytime albedo is now muted.
  context.fillStyle =
    style === 'glow' ? '#000000' : kind === 'arterial' ? '#36383f' : '#3d4046'
  context.fillRect(0, 0, size, size)

  // Edge lines on both sides (symmetric, so the BackSide mirror is free).
  context.fillStyle =
    style === 'glow' ? 'rgba(218, 224, 230, 0.5)' : 'rgba(142, 149, 179, 0.55)'
  const profile = STREET_PROFILES[kind]
  const linePixels = 0.12 / profile.carriageway * size
  const edgePixels = 0.16 / profile.carriageway * size
  context.fillRect(edgePixels - linePixels / 2, 0, linePixels, size)
  context.fillRect(size - edgePixels - linePixels / 2, 0, linePixels, size)
  if (profile.lanesPerDirection > 1) {
    // Solid warm center line plus dashed lane separators (4 lanes).
    context.fillStyle =
      style === 'glow' ? 'rgba(226, 196, 116, 0.85)' : 'rgba(255, 126, 68, 0.8)'
    context.fillRect(size / 2 - linePixels / 2, 0, linePixels, size)
    context.fillStyle =
      style === 'glow' ? 'rgba(220, 226, 232, 0.7)' : 'rgba(160, 168, 201, 0.6)'
    for (const divider of streetLaneDividers(kind)) for (const side of [-1, 1]) {
      const x = size * (0.5 + side * divider / profile.carriageway)
      context.fillRect(x - linePixels / 2, 16, linePixels, 120)
    }
  } else {
    // Faint short center dash for residential streets.
    context.fillStyle =
      style === 'glow' ? 'rgba(210, 216, 222, 0.22)' : 'rgba(160, 168, 201, 0.25)'
    context.fillRect(size / 2 - linePixels / 2, 40, linePixels, 88)
  }
}

const createRoadTexture = (kind: 'arterial' | 'collector' | 'local', style: 'albedo' | 'glow' = 'albedo') => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the road texture')
  }

  drawRoadSurface(context, size, kind, style)

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

// The near disk speaks Kenney, so the mid procedural boxes and the far
// skyline take their per-instance colour from the same building category.
// Towers use pale metal/concrete tints; a dark tint multiplied by a facade
// texture would double-darken their walls. Mild jitter keeps rows varied.
const KENNEY_COMMERCIAL_WALL_TONES = [
  0xefece6, 0xe6d9c4, 0x979db8, 0xc8745e, 0xb6bac2, 0x767b8c
]
const KENNEY_SUBURBAN_WALL_TONES = [0xf2f2f0, 0xe9e4d8]
const KENNEY_SKYSCRAPER_WALL_TONES = [0xa2afbd, 0x91a2b5, 0xb4b8bd]
const KENNEY_INDUSTRIAL_WALL_TONE = 0xd4d6d9

export const buildingTone = (building: CityBuilding, target: THREE.Color) => {
  const pick = kenneyPickForBuilding(building)
  if (pick.set === 'suburban') {
    target.setHex(KENNEY_SUBURBAN_WALL_TONES[pick.variant % 2])
  } else if (pick.set === 'skyscraper') {
    target.setHex(KENNEY_SKYSCRAPER_WALL_TONES[pick.variant % 3])
  } else if (pick.set === 'industrial') {
    target.setHex(KENNEY_INDUSTRIAL_WALL_TONE)
  } else {
    target.setHex(
      KENNEY_COMMERCIAL_WALL_TONES[pick.variant % KENNEY_COMMERCIAL_WALL_TONES.length]
    )
  }
  return target.multiplyScalar(0.9 + building.tone * 0.2)
}

// Roof colours per kit set for the box LODs: the suburb reads green from
// the air at every distance, downtown stays dark decked.
export const KENNEY_ROOF_TONES = {
  suburban: new THREE.Color(0x55b17c),
  // Daylight roof decks stay darker than the walls but light enough for
  // rooftop equipment to read from 60–200 m. Shared with the shell bake.
  commercial: new THREE.Color(0x737a80),
  skyscraper: new THREE.Color(0x68737e),
  industrial: new THREE.Color(0x7c828c)
} as const

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }
}

// 60% of windows lit at night — toming's call on the facade study swatches
// (2026-07-22): the colony reads inhabited, not asleep.
export const FACADE_LIT_CHANCE = 0.6

export class Cityscape {
  readonly group = new THREE.Group()
  private readonly civicDetails = new CivicDetails(this.group)
  private readonly riverLayer = new RiverDistrictLayer(this.group)
  private readonly riverBuildings = new ColonyBuildings(this.group)
  private riverDistrict: RiverDistrict | null = null
  private riverTraffic: RiverTrafficLoop | null = null
  private interiorRainSource: readonly RainRoof[] | null = null
  private combinedRainRoofs: readonly RainRoof[] = []
  private rainArcs: RainArcRoof[] = []
  private readonly interiorLayer = new BuildingInteriorLayer(this.group)
  private readonly neighborhoodFronts = new NeighborhoodFronts(this.group)
  private coffeeStation: CoffeeStation | null = null
  private roomSeats: RoomSeat[] = []
  private seats: RoomSeat[] = []
  private interiors = new Map<CityBuilding, BuildingInterior>()
  private interiorFocus = { azimuth: 0, axial: 0, altitude: 1.8 }
  private readonly streetAccessLayer = new StreetAccessLayer(this.group,
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('access'))

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
  private readonly bridgeSidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xa4a39a, roughness: 0.95, side: THREE.DoubleSide })

  // Roads light up at night as an emissive teal grid — the colony's signature
  // night signal. The asphalt texture doubles as the emissive mask so the lane
  // lines glow brightest; emissiveIntensity ramps from 0 (day) up at night
  // (setDaylight). The texture is shared between albedo and emissive map.
  private readonly arterialRoadTexture = createRoadTexture('arterial')
  private readonly localRoadTexture = createRoadTexture('local')
  private readonly collectorRoadMaterial = new THREE.MeshStandardMaterial({ map: createRoadTexture('collector'), roughness: 0.95, side: THREE.BackSide })
  private readonly arterialRoadGlowTexture = createRoadTexture('arterial', 'glow')
  private readonly localRoadGlowTexture = createRoadTexture('local', 'glow')

  // No polygonOffset on any land-layer material: the logarithmic depth buffer
  // writes gl_FragDepth, which discards the rasterizer's polygon offset
  // entirely. Layer separation is done with REAL radial gaps instead (see
  // buildRoads / buildPatches).
  private readonly localRoadMaterial = new THREE.MeshStandardMaterial({
    map: this.localRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.localRoadGlowTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide
  })

  // Back lanes: bare concrete, deliberately WITHOUT the night glow — the
  // teal grid stays the arterial/local signature while the alleys read as
  // the unlit service capillaries between the rings. Painted at full range
  // so block interiors show their lanes from any altitude (the near tile
  // overlay only reaches a couple hundred meters).
  private readonly alleyMaterial = new THREE.MeshStandardMaterial({
    color: 0x43464e,
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide
  })

  private readonly roadMaterial = new THREE.MeshStandardMaterial({
    map: this.arterialRoadTexture,
    emissive: ROAD_GLOW.clone(),
    emissiveMap: this.arterialRoadGlowTexture,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    side: THREE.BackSide
  })

  readonly colonyBuildings=new ColonyBuildings(this.group)
  readonly oldTownBlock = new OldTownBlock(this.group)
  readonly authoredBlock=new AuthoredCityBlock(this.group)
  setBuildingProjection(pixelsPerRadian:number){this.authoredBlock.setProjection(pixelsPerRadian);this.colonyBuildings.setProjection(pixelsPerRadian);this.riverBuildings.setProjection(pixelsPerRadian)}

  private readonly parkMaterial = new THREE.MeshStandardMaterial({
    color: 0x59764b,
    map: createMeadowTexture(),
    vertexColors: true,
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

  private readonly trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a4432,
    roughness: 0.95,
    metalness: 0
  })


  private readonly towerMaterial = new THREE.MeshStandardMaterial({
    color: 0x8ea2b6,
    roughness: 0.5,
    metalness: 0.35
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
  // Radians of view per minimum beacon radius on screen; main.ts sets it from
  // the camera fov and viewport height each frame (see setBeaconScreenScale).
  private readonly beaconMinAngular = { value: 0.0025 }
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({
    color: BEACON_COLOR.clone(),
    toneMapped: false,
    // fog: true only to receive the haze uniforms; installBeaconBlink swaps
    // the fog chunk for pure extinction (the light dims through the haze but
    // stays red, instead of dissolving into the sky colour). Before
    // 2026-09-05 beacons were exempt from fog entirely, which with the
    // screen-size floor turned the far land strip into a field of red.
    fog: true
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
  private cityPlanBuildings: CityBuilding[] = []
  private cityNearBuildings: CityBuilding[] = []
  private cityFocusAzimuth = 0
  private cityFocusAxial = 0
  private cityBatchFocusAzimuth = 0
  private cityBatchFocusAxial = 0
  private roadTileMeshes: THREE.Mesh[] = []
  private readonly roadSurfaceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  private readonly roadTileDistance: number
  private disposed = false
  // Ambient traffic: a persistent capacity-sized batch; focus changes only
  // reassign routes, update() moves the cars every frame.
  // Traffic fleet: one InstancedMesh per car model once the Car Kit pack
  // arrives; a single procedural box-car mesh before that. Each route keeps
  // a stable model variant across visibility updates.
  private trafficMeshes: THREE.InstancedMesh[] = []
  private trafficKitBacked = false
  private kenneyCarGeometries: KenneyCarGeometryPack | null = null
  private trafficRoutes: TrafficRoute[] = []
  private trafficTime = 0
  private trafficSignals = createTrafficSignalIndex([])
  getTrafficClock() { return this.trafficTime }
  private neighborhoodTurn:NeighborhoodTurn|null=null
  private turnMotion={progress:0,speed:0}
  setNeighborhoodTurn(j:NeighborhoodTurn|null){
    if(j?.azimuth!==this.neighborhoodTurn?.azimuth||j?.axial!==this.neighborhoodTurn?.axial)this.turnMotion={progress:0,speed:0}
    this.neighborhoodTurn=j
  }
  private crossingGate: CrossingGate | null = null
  setCrossingGate(gate: CrossingGate | null) { this.crossingGate = gate }
  getTrafficPositions() {
    return this.trafficRoutes.map((route,index) => {
      if(this.neighborhoodTurn&&index===this.trafficRoutes.length-1)return {...sampleNeighborhoodTurn(this.neighborhoodTurn,this.turnMotion.progress),speed:this.turnMotion.speed}
      if(route.path)return {...sampleRiverTraffic(route.path,route.motion?.progress??route.phaseMeters),speed:route.motion?.speed??0}
      const progress = THREE.MathUtils.euclideanModulo(route.motion?.progress ?? route.phaseMeters, route.spanLength)
      const along = route.direction === 1 ? route.spanStart + progress : route.spanStart + route.spanLength - progress
      return { azimuth: route.kind === 'avenue' ? route.laneAzimuth : route.laneAzimuth + along / this.radius,
        axial: route.kind === 'avenue' ? along : route.laneAxial, heading:route.kind==='avenue'?(route.direction===1?0:Math.PI):route.direction*Math.PI/2,
        height: this.radius-route.surfaceRadius, speed: route.motion?.speed ?? 0 }
    })
  }
  private cityPlanRoads: CityRoad[] = []
  private trafficRoadSpans: TrafficRoadSpan[] = []
  // The full plan of the current build, for read-only consumers outside the
  // cityscape (the far-field city shell bake). Null until the first build.
  private cityPlan: CityPlan | null = null
  private carShareBay: CarShareBay | null = null
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
  private alleyRoads: THREE.Mesh | null = null
  private patchMeshes: THREE.Mesh[] = []
  private trees: THREE.InstancedMesh | null = null
  private treeTrunks: THREE.InstancedMesh | null = null
  private utilityPoles: THREE.InstancedMesh | null = null
  private utilityWires: THREE.LineSegments | null = null
  private beaconStems: THREE.InstancedMesh | null = null
  private beacons: THREE.InstancedMesh | null = null
  private towerGroup: THREE.Group | null = null
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
  private readonly maxTraffic: number
  private readonly focusStepMeters: number

  constructor(
    dimensions: CityscapeDimensions,
    options?: CityscapeOptions
  ) {
    // The structural pattern is readable nearby but recedes into the large
    // window band across the bore, leaving the opposite city as the subject.
    this.windowStripMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWindowDistance;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWindowDistance = length(mvPosition.xyz);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWindowDistance;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= mix(1.0, 0.12, smoothstep(250.0, 2200.0, vWindowDistance));')
    }
    this.maxBuildings = options?.maxBuildings
    this.maxTraffic = options?.maxTraffic ?? 160
    this.focusStepMeters = options?.focusStepMeters ?? 20
    this.roadTileDistance = options?.roadTileDistance ?? 0
    // Roads and bridges are the dark, thin, high-contrast surfaces that shimmer
    // on the far side; fade them out with distance. Buildings are deliberately
    // excluded so the overhead skyline survives.
    for (const material of [
      this.roadMaterial,
      this.localRoadMaterial,
      this.collectorRoadMaterial,
      this.alleyMaterial,
      this.bridgeMaterial,
      this.bridgeEdgeMaterial
    ]) {
      this.installDistanceFade(material)
    }
    this.installBeaconBlink(this.beaconMaterial)
    this.setDimensions(dimensions)
    // Retired building packs are no longer requested; the colony module kit owns all exteriors.
    // Vehicle assets are independent of the retired building packs.
    void this.loadKenneyCarAssets()
  }

  private async loadKenneyCarAssets() {
    try {
      const pack = await loadKenneyCarGeometryPack()
      if (this.disposed) {
        disposeKenneyCarGeometryPack(pack)
        return
      }
      this.kenneyCarGeometries = pack
      // Swap the fleet in place: rebuild allocates the per-model meshes and
      // re-deals the routes.
      this.rebuildTraffic()
    } catch (error) {
      console.warn('Kenney car pack unavailable; using procedural traffic', error)
    }
  }

  private clearRoadTiles() {
    for (const mesh of this.roadTileMeshes) {
      mesh.geometry.dispose()
      this.group.remove(mesh)
    }
    this.roadTileMeshes = []
  }

  // Re-instance the near-player road overlay. Cheap enough to run on every
  // detail-focus step: a full rebuild is a few hundred matrix composes.
  private rebuildRoadTiles() {
    this.clearRoadTiles()

    if (
      this.roadTileDistance <= 0 ||
      this.cityPlanRoads.length === 0 ||
      this.radius <= 0
    ) {
      return
    }

    // Arterial cross-streets continue over the windows as bridges (see
    // buildWindowBridges), so for the overlay each arterial street row is ONE
    // full ring: the tiles run onto the bridge decks and the strip-edge
    // junctions become crossroads instead of dead-end Ts. The pseudo-ring is
    // sized to the same carriageway and sidewalks as the bridge deck.
    // One ring per axial row — the three per-strip street rects would
    // otherwise triple-tile the same ring.
    let plannerRoads = this.cityPlanRoads
    if (getWindowArcs(this.topology).length > 0) {
      const seenRingAxials: number[] = []
      plannerRoads = []
      for (const road of this.cityPlanRoads) {
        const isArterialStreet =
          road.kind === 'arterial' && road.tangentWidth > road.axialLength
        if (!isArterialStreet) {
          plannerRoads.push(road)
          continue
        }
        if (seenRingAxials.some((axial) => Math.abs(axial - road.axial) < 0.5)) {
          continue
        }
        seenRingAxials.push(road.axial)
        plannerRoads.push({
          ...road,
          tangentWidth: Math.PI * 2 * this.radius,
          axialLength: getArterialRoadWidth(this.radius, this.length)
        })
      }
    }

    const placements = planRoadTilePlacements({
      roads: plannerRoads,
      radius: this.radius,
      focusAzimuth: this.cityFocusAzimuth,
      focusAxial: this.cityFocusAxial,
      rangeMeters: this.roadTileDistance
    })

    const geometries: THREE.BufferGeometry[] = []
    for (const placement of placements) {
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
      const geometry = buildRoadTileSurface(placement)
      geometry.applyMatrix4(instanceMatrix)
      geometries.push(geometry)
    }
    const merged = mergeBufferGeometries(geometries)
    for (const geometry of geometries) geometry.dispose()
    if (merged) {
      const mesh = new THREE.Mesh(merged, this.roadSurfaceMaterial)
      mesh.receiveShadow = true
      this.roadTileMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  // Per-instance strobing for the aviation beacons: a short bright flash on each
  // beacon's own phase, over a dim steady-red floor. Pushed into HDR so it reads
  // day and night and blooms on desktop.
  private installBeaconBlink(material: THREE.MeshBasicMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.beaconTime
      shader.uniforms.uBeaconMinAngular = this.beaconMinAngular
      // Screen-size floor: the instance matrix scales the unit sphere to the
      // physical radius; grow the local vertex so the world radius becomes
      // max(physical, distance * minAngular), capped so a 400 px window does
      // not turn the far-side lights into balloons.
      shader.vertexShader =
        'attribute float aBlinkPhase;\nvarying float vBlinkPhase;\n' +
        'uniform float uBeaconMinAngular;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vBlinkPhase = aBlinkPhase;\n' +
            '  {\n' +
            '    vec4 beaconCentre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);\n' +
            '    float beaconNeed = length(beaconCentre.xyz) * uBeaconMinAngular;\n' +
            `    float beaconGrow = clamp(beaconNeed / ${BEACON_PHYSICAL_RADIUS.toFixed(3)}, 1.0, ${BEACON_MAX_GROW.toFixed(1)});\n` +
            '    transformed *= beaconGrow;\n' +
            '  }'
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
            // Brighter than before (peak 2.6 -> 4.0): the disc is now a
            // fraction of its old size, so the bloom halo has to carry it.
            '  gl_FragColor.rgb *= 0.8 + beaconFlash * 3.2;'
        )
        .replace(
          '#include <fog_fragment>',
          // Transmittance only: the same layered-haze optical depth every
          // other material uses (objects/layeredHaze.ts), without the mix
          // toward the sky colour. A 6 km beacon keeps ~20% at 16 km
          // visibility, which the strobe peak still lifts over the bloom
          // threshold.
          '#ifdef USE_FOG\n' +
            '  gl_FragColor.rgb *= exp(-layeredHazeOpticalDepth(cameraPosition, vFogWorldOffset, fogDensity, fogHabitat));\n' +
            '#endif'
        )
    }
  }

  // Minimum on-screen beacon radius, as radians of view: pixels * (2 tan(fov/2)
  // / viewport height). Called by main.ts when the viewport or fov changes.
  setBeaconScreenScale(minAngularRadius: number) {
    this.beaconMinAngular.value = minAngularRadius
  }

  // Advance the beacon strobe. Called once per frame from the render loop.
  update(deltaSeconds: number) {
    this.riverLayer.update(deltaSeconds)
    this.beaconTime.value += deltaSeconds
    this.trafficTime += Math.max(0, deltaSeconds)
    this.updateTraffic(deltaSeconds)
  }

  private updateTraffic(deltaSeconds: number) {
    const fleet = this.trafficMeshes

    if (fleet.length === 0 || this.trafficRoutes.length === 0) {
      return
    }

    const junction=this.neighborhoodTurn
    const snapshot=this.getTrafficPositions()
    const riverCars=snapshot.filter((_,i)=>!!this.trafficRoutes[i].path)
    const ordinary=junction?snapshot.slice(0,-1):snapshot
    const majorBusy=junction?junctionMajorBusy(junction,ordinary):false
    if(junction){
      const own=sampleNeighborhoodTurn(junction,this.turnMotion.progress)
      let gap=turnYieldGap(this.turnMotion.progress,majorBusy)
      // Merge clearance and following use the same world positions as pedestrians.
      for(const v of ordinary){
        if(v.height>=1)continue
        const x=wrapAngleToPi(v.azimuth-own.azimuth)*this.radius,z=v.axial-own.axial
        const along=x*Math.sin(own.heading)+z*Math.cos(own.heading),across=x*Math.cos(own.heading)-z*Math.sin(own.heading)
        if(along>0&&Math.abs(across)<2.3)gap=Math.min(gap,along-2)
        if(this.turnMotion.progress<=TURN_APPROACH&&Math.abs(wrapAngleToPi(v.azimuth-junction.azimuth)*this.radius)<junction.halfWidth+2&&Math.abs(v.axial-junction.axial)<4)gap=Math.min(gap,TURN_APPROACH-this.turnMotion.progress+3.2)
      }
      if(this.crossingGate&&this.turnMotion.progress>=TURN_APPROACH)
        gap=Math.min(gap,crossingGap(this.crossingGate,this.radius,'street',own.azimuth,own.axial,-1))
      this.turnMotion=advanceTraffic(this.turnMotion,deltaSeconds,this.turnMotion.progress<TURN_APPROACH?6:4,gap)
      if(this.turnMotion.progress>=TURN_LENGTH)this.turnMotion={progress:0,speed:0}
    }
    // Snapshot lane order before moving any car, so update order cannot let
    // the follower overlap a stopped leader. Group/sort is O(n log n).
    const lanes = new Map<string, { index:number; along:number }[]>()
    const leaderGaps = new Map<number,number>()
    this.trafficRoutes.forEach((r,index) => {
      if(junction&&index===this.trafficRoutes.length-1)return
      const key=[r.kind,r.laneAzimuth,r.laneAxial,r.surfaceRadius,r.direction,r.spanStart,r.spanLength].join(':')
      const progress=THREE.MathUtils.euclideanModulo(r.motion?.progress??r.phaseMeters,r.spanLength)
      const period = r.kind === 'street' ? Math.min(r.spanLength, fullTurn * this.radius) : r.spanLength
      const along=THREE.MathUtils.euclideanModulo((r.direction===1?r.spanStart+progress:r.spanStart+r.spanLength-progress)*r.direction,period)
      const lane=lanes.get(key)??[];lane.push({index,along});lanes.set(key,lane)
    })
    for(const lane of lanes.values()){
      const route = this.trafficRoutes[lane[0].index]
      const period = route.kind === 'street' ? Math.min(route.spanLength, fullTurn * this.radius) : route.spanLength
      fillLaneLeaderGaps(lane, period, leaderGaps)
    }

    const variantCounts = new Uint16Array(fleet.length)
    for (let index = 0; index < this.trafficRoutes.length; index += 1) {
      const route = this.trafficRoutes[index]
      route.motion ??= { progress: route.phaseMeters, speed: route.speedMetersPerSecond }
      const previous = THREE.MathUtils.euclideanModulo(route.motion.progress, route.spanLength)
      const previousAlong = route.direction === 1 ? route.spanStart + previous : route.spanStart + route.spanLength - previous
      let gap = leaderGaps.get(index) ?? Infinity
      const isTurn=!!junction&&index===this.trafficRoutes.length-1
      if(route.path){
        const others=snapshot.filter((_,i)=>i!==index)
        gap=Math.min(gap,trafficFollowingGap(snapshot[index],others,this.radius),riverTrafficYieldGap(route.path,route.motion.progress,others))
      }else if(!isTurn){
        gap=Math.min(gap,trafficFollowingGap(snapshot[index],riverCars,this.radius))
      }
      if(junction&&!isTurn&&!route.path&&this.radius-route.surfaceRadius<1){
        const own=snapshot[index],turn=sampleNeighborhoodTurn(junction,this.turnMotion.progress)
        const dx=wrapAngleToPi(turn.azimuth-own.azimuth)*this.radius,dz=turn.axial-own.axial
        const along=(route.kind==='avenue'?dz:dx)*route.direction,across=route.kind==='avenue'?dx:dz
        if(along>0&&Math.abs(across)<2.3)gap=Math.min(gap,along-2)
        if(route.kind==='street'&&Math.abs(route.laneAxial-junction.axial)<3){
          const ahead=wrapAngleToPi(junction.azimuth-own.azimuth)*this.radius*route.direction
          const turnInJunction=this.turnMotion.progress>=TURN_APPROACH-1&&this.turnMotion.progress<TURN_APPROACH+20
          // Minor-road approaches yield before the conflict area. Cars already
          // inside clear it, preventing a new priority grant from trapping them.
          if(ahead>junction.halfWidth+3.2&&(majorBusy||turnInJunction))gap=Math.min(gap,ahead-junction.halfWidth)
        }
      }
      if (!route.path && this.crossingGate && this.radius-route.surfaceRadius < 1) {
        gap = Math.min(gap, crossingGap(this.crossingGate, this.radius, route.kind,
          route.kind === 'avenue' ? route.laneAzimuth : route.laneAzimuth+previousAlong/this.radius,
          route.kind === 'avenue' ? previousAlong : route.laneAxial, route.direction))
      }
      if (!isTurn && !route.path && this.radius - route.surfaceRadius < 1) {
        gap = Math.min(gap, trafficSignalGap(route.signals ?? [], route.kind, previousAlong,
          route.direction, route.motion.speed, this.trafficTime,
          route.kind === 'street' && route.spanLength >= fullTurn * this.radius - 1 ? fullTurn * this.radius : 0))
      }
      const cruise=route.path?sampleRiverTraffic(route.path,route.motion.progress).cruise:route.speedMetersPerSecond
      route.motion = advanceTraffic(route.motion, deltaSeconds, cruise, gap)
      const progress = THREE.MathUtils.euclideanModulo(route.motion.progress, route.spanLength)
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

      const turn=isTurn?sampleNeighborhoodTurn(junction!,this.turnMotion.progress):null
      if(turn){azimuth=turn.azimuth;axial=turn.axial}
      const river=route.path?sampleRiverTraffic(route.path,route.motion.progress):null
      if(river){azimuth=river.azimuth;axial=river.axial}
      const cos = Math.cos(azimuth)
      const sin = Math.sin(azimuth)
      inward.set(-cos, 0, -sin)

      if (route.kind === 'avenue') {
        trafficForward.set(0, route.direction, 0)
      } else {
        trafficForward.set(-sin, 0, cos).multiplyScalar(route.direction)
      }

      if(turn)trafficForward.set(-sin*Math.sin(turn.heading),Math.cos(turn.heading),cos*Math.sin(turn.heading))
      if(river){
        trafficForward.set(-sin*Math.sin(river.heading),Math.cos(river.heading),cos*Math.sin(river.heading))
        trafficForward.multiplyScalar(Math.cos(river.slope)).addScaledVector(inward,Math.sin(river.slope))
      }
      // Right-handed car frame: X = up × forward, Y = up (toward the axis),
      // Z = travel direction (the kit's nose).
      trafficRight.copy(inward).cross(trafficForward).normalize()
      if(river)inward.copy(trafficForward).cross(trafficRight).normalize()
      basis.makeBasis(trafficRight, inward, trafficForward)
      instanceQuaternion.setFromRotationMatrix(basis)
      instancePosition.set(cos, 0, sin).multiplyScalar(river?this.radius-river.height:turn?this.radius-.2:route.surfaceRadius).setY(axial)
      instanceScale.setScalar(route.scale)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      const variant = route.variant % fleet.length
      fleet[variant].setMatrixAt(variantCounts[variant]++, instanceMatrix)
    }

    fleet.forEach((mesh, variant) => {
      mesh.count = variantCounts[variant]
      mesh.instanceMatrix.needsUpdate = true
    })
  }

  // Mix the material's lit colour toward the scene fog colour over a distance
  // window, on top of the normal exponential fog. The distance is measured in
  // metres of STREET-LEVEL air — the layered optical depth divided by the
  // floor density (layeredHaze.ts) — so under the boundary-layer profile a
  // sightline up through the thin upper air fades no sooner than the haze
  // itself would, while a horizontal sightline fades exactly as before (the
  // two coincide under uniform fog). Reuses the fog uniforms/varyings that
  // the swapped fog chunks inject. No-op if the material is unfogged.
  private installDistanceFade(material: THREE.Material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeStart = this.fadeStart
      shader.uniforms.uFadeEnd = this.fadeEnd
      shader.fragmentShader =
        'uniform float uFadeStart;\nuniform float uFadeEnd;\n' +
        shader.fragmentShader.replace(
          '#include <fog_fragment>',
          'float fadeDepth = layeredHazeOpticalDepth(cameraPosition, vFogWorldOffset, fogDensity, fogHabitat) / max(fogDensity, 1e-9);\n' +
            'gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ' +
            'smoothstep(uFadeStart, uFadeEnd, fadeDepth));\n#include <fog_fragment>'
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
    this.riverDistrict = this.habitatType === 'cylinder' ? planRiverDistrict(plan, radius) : null
    this.riverTraffic = planRiverTraffic(this.riverDistrict, plan, radius)
    if (this.riverDistrict) {
      const p = this.riverDistrict
      plan.patches = plan.patches.filter(patch => patch !== p.patch)
      plan.trees = plan.trees.filter(t => Math.abs(Math.atan2(Math.sin(t.azimuth-p.azimuth),Math.cos(t.azimuth-p.azimuth))) * radius > p.width / 2 + 3 || Math.abs(t.axial-p.axial) > p.length / 2 + 3)
    }
    this.riverLayer.rebuild(this.riverDistrict, radius)
    this.riverBuildings.rebuild(this.riverDistrict?.buildings ?? [], radius, new Map(), [], false)
    // Structural collision follows the same authored recipes as the visible city.
    this.neighborhoodFronts.rebuild(plan.buildings, radius)
    this.interiors = planBuildingInteriors(plan.buildings, radius)
    const apartment = planNyaanApartment(plan.buildings, radius)
    if (apartment) this.interiors.set(apartment.building, apartment)
    this.authoredBlock.rebuild(plan.buildings,radius)
    this.colonyBuildings.rebuild(plan.buildings,radius,this.interiors,plan.roads)
    this.oldTownBlock.rebuild(plan.buildings, plan.roads, radius, length, this.interiors,
      [...this.colonyBuildings.getForecourtColliders(), ...this.colonyBuildings.getStairColliders()])
    // Keep the retired facade overlays disabled; public plans see actual lots.
    this.civicDetails.rebuild({ ...plan, buildings: [] }, radius, planPublicPark(plan, radius), planPublicUnderpass(plan, radius))
    this.roomSeats = planRoomSeats(this.interiors.values(), radius)
    this.seats = [...this.roomSeats, ...this.civicDetails.seats, ...this.riverLayer.seats]
    this.civicDetails.lamps.push(...this.riverLayer.lamps)
    this.coffeeStation = planCoffeeStation(this.interiors.values(), radius)
    this.collisionBuildings = plan.buildings.flatMap((building) => {
      const authored=cityBlockSpec(building,radius)
      if(authored)return cityBlockCollision(building,authored,radius)
      const interior = this.interiors.get(building)
      if (interior) return interiorCollisionBuildings(interior, radius)
      return cityBlockCollision(building,colonyBuildingSpec(building),radius)
    })

    this.collisionBuildings.push(...this.colonyBuildings.getForecourtColliders())
    this.collisionBuildings.push(...this.colonyBuildings.getStairColliders())
    this.collisionBuildings.push(...this.oldTownBlock.getColliders())
    this.collisionBuildings.push(...this.civicDetails.colliders, ...this.riverLayer.colliders)
    for (const b of this.riverDistrict?.buildings ?? []) this.collisionBuildings.push(...cityBlockCollision(b, colonyBuildingSpec(b), radius))
    if (plan.tower !== null) {
      this.collisionBuildings.push(this.getTowerFootprint(plan.tower))
    }

    this.collisionIndex = buildCityCollisionIndex(this.collisionBuildings, radius, length)
    this.cityPlanRoads = plan.roads
    this.trafficRoadSpans = planTrafficRoadSpans(plan.roads, radius)
    this.cityPlan = plan
    this.carShareBay = planCarShareBay(plan, radius)
    this.trafficSignals = createTrafficSignalIndex(this.habitatType === 'ring' ? [] : plan.intersections)
    this.buildBuildings(plan.buildings)
    this.rebuildRoadTiles()
    this.buildRoads(plan.roads, radius)
    this.buildPatches(plan.patches, radius, length)
    this.buildTrees(plan.trees, radius)
    this.buildHeroUtilities(plan.roads, radius)
    this.buildBeacons(plan.buildings, radius)
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

    this.cityExpressway = plan.expressway
    this.rainArcs = planExpresswayRainRoofs(plan.expressway, radius)

    if (plan.expressway !== null) {
      this.buildExpressway(plan.expressway, radius)
      // Ring routes exist now; deal the fleet again so the viaduct opens
      // with traffic instead of waiting for the next focus step.
      this.rebuildTraffic()
    }
  }

  // Resolve a named visit against this tier's generated plan, so preview
  // links work on mobile too (quality budgets generate different parcels).
  sampleRoomEnvironment(azimuth: number, axial: number, altitude: number) {
    return this.interiorLayer.sampleRoomEnvironment(azimuth, axial, altitude)
  }

  getRoomSeats(): readonly RoomSeat[] { return this.roomSeats }
  getRainRoofs() {
    const source=this.interiorLayer.getRainRoofs()
    if(source!==this.interiorRainSource){this.interiorRainSource=source;this.combinedRainRoofs=[...source,...this.riverLayer.rainRoofs]}
    return this.combinedRainRoofs
  }
  getRainArcs() { return this.rainArcs }
  sampleRainShelter(point: THREE.Vector3) { return sampleRainShelter(this.getRainRoofs(), this.rainArcs, point) }
  getSeats(): readonly RoomSeat[] { return this.seats }
  getCarShareBay() { return this.carShareBay }
  getPublicPark() { return this.civicDetails.park }
  getParkLamps() { return this.civicDetails.lamps }
  getCoffeeStation() { return this.coffeeStation }
  getRiverDistrict() { return this.riverDistrict }
  sampleRiverRoad(azimuth: number, axial: number) { return sampleRiverRoad(this.riverDistrict, this.radius, azimuth, axial) }

  getInteriorVisit(kind: string | null): { azimuth: number; axial: number; orientation: THREE.Quaternion; groundHeight?: number } | null {
    if (kind === 'river') {
      const p = this.riverDistrict
      if (!p) return null
      const azimuth=p.azimuth+18/this.radius, axial=p.axial+32, height=3
      const point=new THREE.Vector3(Math.cos(azimuth)*(this.radius-height),axial,Math.sin(azimuth)*(this.radius-height))
      const a=p.azimuth+5/this.radius,target=new THREE.Vector3(Math.cos(a)*(this.radius-2.7),p.axial-5,Math.sin(a)*(this.radius-2.7))
      const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(point,target,new THREE.Vector3(-Math.cos(azimuth),0,-Math.sin(azimuth))))
      return {azimuth,axial,orientation,groundHeight:1.2}
    }
    if (kind === 'ball-practice' || kind === 'car-share') {
      const park = this.civicDetails.park, bay = this.carShareBay
      if (kind === 'ball-practice' && !park || kind === 'car-share' && !bay) return null
      const azimuth = kind === 'ball-practice' ? park!.azimuth : bay!.azimuth - Math.cos(bay!.heading) * bay!.signSide * 3.6 / this.radius
      const axial = kind === 'ball-practice' ? park!.axial + 4 : bay!.axial + Math.sin(bay!.heading) * bay!.signSide * 3.6
      const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
      const forward = kind === 'ball-practice' ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(Math.cos(bay!.azimuth) * this.radius, bay!.axial, Math.sin(bay!.azimuth) * this.radius)
          .sub(new THREE.Vector3(Math.cos(azimuth) * this.radius, axial, Math.sin(azimuth) * this.radius)).projectOnPlane(up).normalize()
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()))
      return { azimuth, axial, orientation }
    }
    if (kind === 'park') {
      const park = this.civicDetails.park
      if (!park) return null
      const azimuth = park.azimuth + park.entrance.x / this.radius, axial = park.axial + park.entrance.y
      const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
      const forward = new THREE.Vector3(-Math.sin(azimuth) * park.forward.x, park.forward.y, Math.cos(azimuth) * park.forward.x)
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()))
      return { azimuth, axial, orientation }
    }
    if (kind === 'city-block') {
      const b = this.cityPlanBuildings.find(b => cityBlockSpec(b, this.radius)?.id === 'office' && Math.abs(b.azimuth-0.05333934543525725)<1e-9 && b.axial > 0 && b.axial < 50)
      if (!b?.access) return null
      const { azimuth, axial } = b.access.roadEdge
      const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
      const forward = new THREE.Vector3(0, 1, 0)
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()))
      return { azimuth, axial, orientation }
    }
    if (kind === 'coffee' && this.coffeeStation) {
      const station = this.coffeeStation, front = station.interior.building.front!
      const up = new THREE.Vector3(-Math.cos(station.azimuth), 0, -Math.sin(station.azimuth))
      const forward = front.axis === 'axial' ? new THREE.Vector3(0, -front.side, 0)
        : new THREE.Vector3(Math.sin(station.azimuth) * front.side, 0, -Math.cos(station.azimuth) * front.side)
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()))
      return { azimuth: station.azimuth, axial: station.axialPosition, orientation }
    }
    if (kind === 'shops') {
      const b = matchNeighborhoodLot(this.cityPlanBuildings, this.radius)
      if (!b) return null
      const p = neighborhoodPoint(b, this.radius, new THREE.Vector3(32, 0, b.width / 2 + 7))
      const azimuth = Math.atan2(p.z, p.x), up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
      const forward = new THREE.Vector3(Math.sin(azimuth) * b.front!.side, 0, -Math.cos(azimuth) * b.front!.side)
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()))
      return { azimuth, axial: p.y, orientation }
    }
    if (kind !== 'cafe' && kind !== 'passage' && kind !== 'court' && kind !== 'lobby' && kind !== 'nyaan') return null
    const interior = (kind === 'cafe' ? this.coffeeStation?.interior : null) ?? [...this.interiors.values()].filter(i => kind === 'lobby'
      ? matchesAuthoredPilot(i, this.radius, LOBBY_PILOT) : i.kind === (kind === 'nyaan' ? 'apartment' : kind))
      .sort((a, b) => getBuildingSurfaceDistance(this.radius, 0, 0, a.building.azimuth, a.building.axial) -
        getBuildingSurfaceDistance(this.radius, 0, 0, b.building.azimuth, b.building.axial))[0]
    if (!interior) return null
    const b = interior.building, front = b.front!, edge = b.access!.roadEdge
    const up = new THREE.Vector3(-Math.cos(edge.azimuth), 0, -Math.sin(edge.azimuth))
    const forward = front.axis === 'axial' ? new THREE.Vector3(0, -front.side, 0)
      : new THREE.Vector3(Math.sin(edge.azimuth) * front.side, 0, -Math.cos(edge.azimuth) * front.side)
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      forward.clone().cross(up), up, forward.clone().negate()))
    return { azimuth: edge.azimuth, axial: edge.axial, orientation }
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

  // The current build's full plan (read-only), for the city shell bake.
  getCityPlan(): CityPlan | null {
    return this.cityPlan
  }

  // The Car Kit pack once loaded (null until then); parkedCars.ts shares it.
  getKenneyCarPack(): KenneyCarGeometryPack | null {
    return this.kenneyCarGeometries
  }

  // Day/night dressing: the mirrors dim to night-side blue, facades and
  // street lamps take over as the light sources.
  // The window-strip mirrors are the colony's "sky": tint them with the current
  // grade so dusk pours warm/violet light through the strips, day pours blue.
  setSkyColor(color: THREE.Color) {
    this.skyColor.copy(color)
  }

  setDaylight(daylight: number) {
    this.riverLayer.setDaylight(daylight)
    this.riverBuildings.setDaylight(daylight)
    this.civicDetails.setDaylight(daylight)
    this.authoredBlock.setDaylight(daylight)
    this.colonyBuildings.setDaylight(daylight)
    this.interiorLayer.setDaylight(daylight)
    this.neighborhoodFronts.setDaylight(daylight)
    this.oldTownBlock.setDaylight(daylight)
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
    // Roads become pale light veins at night; arterials carry the network,
    // residential locals only hint (2026-09-11: the mid-distance lattice was
    // reading as a grid over the city — see cityShellBake SHELL_ROAD_*).
    this.roadMaterial.emissiveIntensity = night * 1.55
    this.localRoadMaterial.emissiveIntensity = night * 0.4
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

  dispose() {
    this.disposed = true
    this.clear()
    this.authoredBlock.dispose()
    this.colonyBuildings.dispose()
    this.oldTownBlock.dispose()
    this.riverLayer.dispose()
    this.riverBuildings.dispose()
    this.civicDetails.dispose()
    this.interiorLayer.dispose()
    this.neighborhoodFronts.dispose()
    this.streetAccessLayer.dispose()
    this.windowStripMaterial.map?.dispose()
    this.windowStripMaterial.dispose()
    this.facetMaterial.dispose()
    this.trussMaterial.dispose()
    this.axisSpineMaterial.dispose()
    this.roadMaterial.map?.dispose()
    this.roadMaterial.dispose()
    this.roadSurfaceMaterial.dispose()
    this.collectorRoadMaterial.map?.dispose()
    this.collectorRoadMaterial.dispose()
    this.bridgeSidewalkMaterial.dispose()
    this.localRoadMaterial.map?.dispose()
    this.localRoadMaterial.dispose()
    this.alleyMaterial.dispose()
    this.arterialRoadGlowTexture.dispose()
    this.localRoadGlowTexture.dispose()
    this.bridgeMaterial.map?.dispose()
    this.bridgeMaterial.dispose()
    this.bridgeEdgeMaterial.dispose()
    this.parkMaterial.map?.dispose()
    this.parkMaterial.dispose()
    this.farmMaterial.map?.dispose()
    this.farmMaterial.dispose()
    this.treeMaterial.dispose()
    this.trunkMaterial.dispose()
    this.beaconMaterial.dispose()
    this.towerMaterial.dispose()
    this.towerAccentMaterial.dispose()
    this.expresswayFasciaMaterial.dispose()
    this.expresswayRampMaterial.dispose()
    this.utilityPoleMaterial.dispose()
    this.utilityWireMaterial.dispose()
    this.trafficBodyMaterial.dispose()
    this.headlightMaterial.dispose()
    this.taillightMaterial.dispose()
    this.cableMaterial.dispose()
    this.spineRingMaterial.dispose()
  }

  private clear() {
    this.oldTownBlock.clear()
    this.riverLayer.clear()
    this.riverDistrict = null
    this.riverTraffic = null
    this.interiorRainSource = null
    this.combinedRainRoofs = []
    this.rainArcs = []
    this.riverBuildings.rebuild([], this.radius, new Map(), [], false)
    this.civicDetails.clear()
    this.interiorLayer.clear()
    this.neighborhoodFronts.clear()
    this.interiors.clear()
    this.roomSeats = []
    this.seats = []
    this.coffeeStation = null
    this.streetAccessLayer.clear()
    this.clearRoadTiles()
    this.collisionBuildings = []
    this.collisionIndex = buildCityCollisionIndex([], 1, 1)
    this.cityPlanBuildings = []
    this.cityNearBuildings = []
    this.cityPlanRoads = []
    this.trafficRoadSpans = []
    this.cityPlan = null
    this.carShareBay = null
    this.trafficRoutes = []
    this.trafficSignals = createTrafficSignalIndex([])
    this.cityExpressway = null

    if (this.expresswayGroup !== null) {
      for (const child of this.expresswayGroup.children) {
        if (child instanceof THREE.InstancedMesh) child.dispose()
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(this.expresswayGroup)
      this.expresswayGroup = null
    }

    for (const mesh of this.trafficMeshes) {
      mesh.dispose()
      mesh.geometry.dispose()
      this.group.remove(mesh)
    }
    this.trafficMeshes = []
    if (this.kenneyCarGeometries !== null) {
      disposeKenneyCarGeometryPack(this.kenneyCarGeometries)
      this.kenneyCarGeometries = null
    }


    for (const patch of this.patchMeshes) {
      patch.geometry.dispose()
      this.group.remove(patch)
    }

    this.patchMeshes = []

    for (const single of [
      this.trees,
      this.treeTrunks,
      this.utilityPoles,
      this.utilityWires,
      this.beacons,
      this.beaconStems,
      this.cables,
      this.spineRings,
      this.bridges,
      this.bridgeEdges,
      this.localRoads,
      this.alleyRoads
    ]) {
      if (single !== null) {
        if (single instanceof THREE.InstancedMesh) single.dispose()
        single.geometry.dispose()
        this.group.remove(single)
      }
    }

    this.trees = null
    this.treeTrunks = null
    this.utilityPoles = null
    this.utilityWires = null
    this.beacons = null
    this.beaconStems = null
    this.cables = null
    this.spineRings = null
    this.bridges = null
    this.bridgeEdges = null
    this.localRoads = null
    this.alleyRoads = null

    if (this.towerGroup !== null) {
      for (const child of this.towerGroup.children) {
        if (child instanceof THREE.InstancedMesh) child.dispose()
        ;(child as THREE.Mesh).geometry?.dispose()
      }
      this.group.remove(this.towerGroup)
      this.towerGroup = null
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

  // The fine grid refreshes street access, interiors and traffic; the coarse
  // grid selects the nearby interior plans. ColonyBuildings owns exterior LODs.
  setFocusSurface(azimuth: number, axial: number, altitude = 1.8) {
    this.authoredBlock.update(azimuth,axial,altitude)
    this.riverLayer.setFocus(azimuth, axial, altitude)
    this.riverBuildings.update(azimuth, axial, altitude)
    this.colonyBuildings.update(azimuth,axial,altitude)
    this.oldTownBlock.update(azimuth, axial, altitude)
    this.updateBeaconVisibility()
    this.interiorFocus = { azimuth, axial, altitude }
    this.interiorLayer.update(azimuth, axial, altitude)
    this.neighborhoodFronts.update(azimuth, axial, altitude)
    if (this.cityPlanBuildings.length === 0 || this.radius <= 0) {
      return
    }

    const coarseStepMeters = getCityNearDistance(this.radius) / 3
    const coarseStepRadians = coarseStepMeters / this.radius
    const detailStepMeters = Math.max(
      16,
      Math.min(this.focusStepMeters, 32)
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
      }
    }

    this.cityNearBuildings = near
    this.rebuildNearBuildingBatches()
    this.rebuildTraffic()
  }

  private rebuildNearBuildingBatches() {
    if (this.cityPlan) this.streetAccessLayer.rebuild(this.cityPlan, this.radius,
      this.cityFocusAzimuth, this.cityFocusAxial)

    const interiorPlans = this.cityNearBuildings.flatMap(b => {
      const interior = this.interiors.get(b)
      return interior ? [interior] : []
    })
    this.interiorLayer.rebuild(interiorPlans, this.radius)
    this.interiorLayer.update(this.interiorFocus.azimuth, this.interiorFocus.axial, this.interiorFocus.altitude)
    this.colonyBuildings.setNearInteriors(interiorPlans.map(p=>p.building))
    this.colonyBuildings.update(this.interiorFocus.azimuth,this.interiorFocus.axial,this.interiorFocus.altitude)
  }

  private ensureTrafficMesh() {
    if (this.maxTraffic <= 0) {
      return
    }
    const pack = this.kenneyCarGeometries
    const wantKit = pack !== null
    if (this.trafficMeshes.length > 0 && this.trafficKitBacked === wantKit) {
      return
    }

    for (const mesh of this.trafficMeshes) {
      mesh.dispose()
      mesh.geometry.dispose()
      this.group.remove(mesh)
    }
    this.trafficMeshes = []

    if (pack !== null) {
      // Stable per-car variants no longer depend on the array position.
      const capacity = this.maxTraffic
      for (const car of pack.cars) {
        const mesh = new THREE.InstancedMesh(
          car.clone(),
          [pack.material, this.headlightMaterial, this.taillightMaterial],
          capacity
        )
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        this.trafficMeshes.push(mesh)
        this.group.add(mesh)
      }
    } else {
      const mesh = new THREE.InstancedMesh(
        buildTrafficCarGeometry(),
        [this.trafficBodyMaterial, this.headlightMaterial, this.taillightMaterial],
        this.maxTraffic
      )
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      this.trafficMeshes.push(mesh)
      this.group.add(mesh)
    }
    this.trafficKitBacked = wantKit
  }

  // Deal the car fleet onto the arterial roads around the focus arc and the
  // plaza's axial band — beyond that a car is sub-pixel, so the whole budget
  // stays where it can be seen. Stable road/car identities retain motion and
  // appearance while the visibility window moves without reallocating meshes.
  private rebuildTraffic() {
    const previousPositions = this.getTrafficPositions()
    const previousRoutes = new Map(this.trafficRoutes.map(r => [r.id, r]))
    const previouslyVisible = this.trafficRoutes.flatMap((route, index) => {
      if(route.path)return []
      if (this.neighborhoodTurn && index === this.trafficRoutes.length - 1) return []
      const position = previousPositions[index]
      const distance = Math.hypot(wrapAngleToPi(position.azimuth - this.cityFocusAzimuth) * this.radius, position.axial - this.cityFocusAxial)
      return distance < 200 ? [route] : []
    })
    this.trafficRoutes = []

    if (this.maxTraffic <= 0 || this.radius <= 0 || this.cityPlanRoads.length === 0) {
      for (const mesh of this.trafficMeshes) {
        mesh.count = 0
      }
      return
    }

    this.ensureTrafficMesh()
    const fleet = this.trafficMeshes

    if (fleet.length === 0) {
      return
    }

    const laneOffsets = streetLaneCenters('arterial', 1, this.radius)
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

    for (const physical of this.trafficRoadSpans) {
      const { road, isAvenue } = physical
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

        // A full-circle road includes a small mesh overlap at its seam. The
        // cars repeat after one actual circumference, not after that overlap.
        const spanLength = Math.min(road.tangentWidth, fullTurn * this.radius)
        candidates.push({
          road,
          isAvenue,
          spanStart: -spanLength * 0.5,
          spanLength
        })
      }

      totalSpan += candidates[candidates.length - 1].spanLength
    }

    totalSpan = candidates.reduce((sum, candidate) => sum + candidate.spanLength, 0)
    if (candidates.length === 0 || totalSpan <= 0) {
      for (const mesh of fleet) {
        mesh.count = 0
      }
      return
    }

    let random = createSeededRandom(0x7a55c0de)
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
          id: `viaduct:${i}`,
          variant: i % fleet.length,
          color: 0,
          kind: 'street',
          laneAzimuth: 0,
          laneAxial: ring.axial + direction * laneOffsets[i % laneOffsets.length],
          spanStart: -ringCircumference * 0.5,
          spanLength: ringCircumference,
          surfaceRadius: this.radius - ring.deckHeight,
          direction,
          speedMetersPerSecond: 16 + random() * 8,
          phaseMeters: random() * ringCircumference,
          scale: 0.97 + random() * 0.06
        })

        const paintRoll = random()
        instanceColor.setHSL(
          paintRoll > 0.9 ? random() : 0.6,
          paintRoll > 0.9 ? 0.55 : 0.04 + random() * 0.08,
          0.25 + random() * 0.55
        )
        this.trafficRoutes[this.trafficRoutes.length - 1].color = instanceColor.getHex()
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
      const roadKey = trafficRoadKey(candidate.road)
      random = createSeededRandom(trafficRoadSeed(roadKey))
      const variantOffset = trafficRoadSeed(roadKey) % fleet.length
      const signals = routeTrafficSignals(this.trafficSignals, candidate.road, this.radius, candidate.spanStart, candidate.spanLength)

      for (let i = 0; i < share && count < this.maxTraffic; i += 1) {
        const direction = random() < 0.5 ? 1 : -1
        const candidateLanes = streetLaneCenters(candidate.road.kind, 1, this.radius)
        const laneOffset = candidateLanes[Math.floor(random() * candidateLanes.length)]
        const surfaceRadius =
          this.radius - 0.2

        this.trafficRoutes.push({
          id: `${roadKey}:${i}`,
          variant: (variantOffset + i) % fleet.length,
          color: 0,
          kind: candidate.isAvenue ? 'avenue' : 'street',
          laneAzimuth:
            candidate.road.azimuth +
            (candidate.isAvenue ? (-direction * laneOffset) / this.radius : 0),
          laneAxial: candidate.isAvenue
            ? 0
            : candidate.road.axial + direction * laneOffset,
          spanStart: candidate.spanStart,
          spanLength: candidate.spanLength,
          surfaceRadius,
          direction,
          speedMetersPerSecond: candidate.road.kind === 'local' ? 5 + random() * 3 : 8 + random() * 5,
          phaseMeters: random() * candidate.spanLength,
          signals,
          scale: 0.97 + random() * 0.06,
          })

        // Mostly white/silver/graphite paint, with the occasional loud one.
        const paintRoll = random()
        instanceColor.setHSL(
          paintRoll > 0.9 ? random() : 0.6,
          paintRoll > 0.9 ? 0.55 : 0.04 + random() * 0.08,
          0.25 + random() * 0.55
        )
        this.trafficRoutes[this.trafficRoutes.length - 1].color = instanceColor.getHex()
        count += 1
      }
    }

    // The authored turn owns its final slot; ordinary cars must not inherit
    // that slot's identity when the surrounding road allocation changes.
    const pilot = this.neighborhoodTurn ? this.trafficRoutes[this.trafficRoutes.length - 1] : null
    if (pilot) { pilot.id = 'neighborhood-turn'; pilot.variant = 0 }
    for (const route of this.trafficRoutes) {
      const previous = previousRoutes.get(route.id)
      if (previous) route.motion = remapTrafficMotion(previous, route)
    }
    const roadSpans = new Map(candidates.map(candidate => [trafficRoadKey(candidate.road), candidate]))
    const assigned = new Set(this.trafficRoutes.map(route => route.id))
    const distanceFromFocus = (route: TrafficRoute) => {
      const p = THREE.MathUtils.euclideanModulo(route.motion?.progress ?? route.phaseMeters, route.spanLength)
      const along = route.spanStart + (route.direction === 1 ? p : route.spanLength - p)
      return Math.hypot(
        wrapAngleToPi(route.laneAzimuth + (route.kind === 'street' ? along / this.radius : 0) - this.cityFocusAzimuth) * this.radius,
        (route.kind === 'avenue' ? along : route.laneAxial) - this.cityFocusAxial
      )
    }
    // Length-based quotas may change by a car or two. Retire a distant slot
    // instead of making a car vanish beside the pedestrian.
    for (const previous of previouslyVisible) {
      if (assigned.has(previous.id)) continue
      const candidate = roadSpans.get(previous.id.slice(0, previous.id.lastIndexOf(':')))
      if (!candidate) continue
      const restored = { ...previous, spanStart: candidate.spanStart, spanLength: candidate.spanLength,
        signals: routeTrafficSignals(this.trafficSignals, candidate.road, this.radius, candidate.spanStart, candidate.spanLength) }
      restored.motion = remapTrafficMotion(previous, restored)
      if (!restored.motion) continue
      let replace = -1, farthest = 200
      this.trafficRoutes.forEach((route, index) => {
        if (route === pilot) return
        const distance = distanceFromFocus(route)
        if (distance > farthest) { replace = index; farthest = distance }
      })
      if (replace >= 0) {
        assigned.delete(this.trafficRoutes[replace].id)
        this.trafficRoutes[replace] = restored
        assigned.add(restored.id)
      }
    }
    // Keep existing traffic first. A newly visible/recycled car can wait for
    // another refresh rather than appear inside a moving car or stopped queue.
    const loop=this.riverTraffic
    if(loop&&Math.hypot(wrapAngleToPi(loop.azimuth-this.cityFocusAzimuth)*this.radius,loop.axial+200-this.cityFocusAxial)<800){
      const budget=Math.min(3,Math.floor(this.maxTraffic/16))
      for(let i=0;i<budget;i++){
        let replace=-1,farthest=200
        this.trafficRoutes.forEach((r,index)=>{if(r===pilot||r.path)return;const d=distanceFromFocus(r);if(d>farthest){farthest=d;replace=index}})
        if(replace<0)break
        const id=`river-loop:${i}`,previous=previousRoutes.get(id)
        this.trafficRoutes[replace]={id,path:loop,variant:2,color:0x879596,kind:'avenue',laneAzimuth:loop.azimuth,laneAxial:loop.axial,
          spanStart:0,spanLength:loop.length,surfaceRadius:this.radius-.2,direction:1,speedMetersPerSecond:5,
          phaseMeters:loop.length*i/budget,motion:previous?.motion,scale:1}
      }
    }
    const occupiedLanes = new Map<string, number[]>(), admitted = new Set<TrafficRoute>()
    const positions=this.getTrafficPositions(),spawnPositions=new Map(this.trafficRoutes.map((route,i)=>[route,positions[i]]))
    const spawnOrder = [...this.trafficRoutes].sort((a, b) => Number(!!b.motion) - Number(!!a.motion))
    for (const route of spawnOrder) {
      if (route === pilot) { admitted.add(route); continue }
      if(!route.motion){
        const own=spawnPositions.get(route)!
        const blocked=this.trafficRoutes.some(other=>{
          if(other===route||(!route.path&&!other.path))return false
          const p=spawnPositions.get(other)!
          return Math.abs(own.height-p.height)<1&&Math.hypot(wrapAngleToPi(own.azimuth-p.azimuth)*this.radius,own.axial-p.axial)<6.2
        })
        if(blocked)continue
      }
      const key = [route.kind, route.laneAzimuth, route.laneAxial, route.surfaceRadius, route.direction, route.spanStart, route.spanLength].join(':')
      const lane = occupiedLanes.get(key) ?? []
      const progress = THREE.MathUtils.euclideanModulo(route.motion?.progress ?? route.phaseMeters, route.spanLength)
      const along = route.spanStart + (route.direction === 1 ? progress : route.spanLength - progress)
      if (route.motion || canSpawnTrafficAt(along, lane, route.spanLength)) {
        admitted.add(route); lane.push(along); occupiedLanes.set(key, lane)
      }
    }
    this.trafficRoutes = this.trafficRoutes.filter(route => admitted.has(route))
    if (!this.trafficKitBacked) this.trafficRoutes.forEach((route, index) => {
      fleet[0].setColorAt(index, instanceColor.setHex(route.color))
    })
    for (const mesh of fleet) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    // Place everyone immediately so a focus change never shows a frame of
    // stale cars parked on the old roads.
    this.updateTraffic(0)
  }

  private buildRoads(roads: CityRoad[], radius: number) {
    const network = compileRoadNetwork(roads, radius)
    for (const kind of ['arterial', 'collector', 'local', 'alley', 'junction'] as const) {
      const surfaces = network.surfaces.filter(road => kind === 'junction'
        ? road.junction : !road.junction && road.kind === kind)
      const merged = buildRoadSurfaceGeometry(surfaces, radius, ROAD_TEXTURE_WORLD_METERS)
      if (merged === null) {
        continue
      }

      const mesh = new THREE.Mesh(
        merged,
        kind === 'arterial' && radius >= 300
          ? this.roadMaterial
          : kind === 'collector' && radius >= 300
            ? this.collectorRoadMaterial
          : kind === 'local' || kind === 'arterial' || kind === 'collector'
            ? this.localRoadMaterial
            : this.alleyMaterial
      )
      mesh.renderOrder = 1

      if (kind === 'arterial') {
        this.roads = mesh
      } else if (kind === 'local') {
        this.localRoads = mesh
      } else if (kind === 'alley') {
        this.alleyRoads = mesh
      } else {
        this.patchMeshes.push(mesh)
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

        if (kind === 'farm' || kind === 'park') {
          // Constant world-size meadow/crop texture regardless of patch size.
          // Rotate and phase patches so adjacent blocks do not repeat
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
          const tintChoices = kind==='park' ? [0xf2eed4,0xe0e8ca,0xdce8d5,0xe9e7c7] : [0xe4efd0, 0xf1ddb7, 0xd2e5bd, 0xe5cfaa]
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

      const merged = mergeGeometries(geometries)

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

    // Original broadleaf silhouettes: a trunk and three asymmetric crown
    // lobes, sharing one 120-triangle geometry and the existing two batches.
    const crownGeometry = createLandscapeCrown()
    const trunkGeometry = new THREE.CylinderGeometry(0.06, 0.085, 1, 6)
    trunkGeometry.translate(0, 0.5, 0)
    const mesh = new THREE.InstancedMesh(crownGeometry, this.treeMaterial, treePlan.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    const trunks = new THREE.InstancedMesh(trunkGeometry, this.trunkMaterial, treePlan.length)
    trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    trunks.frustumCulled = false

    for (let index = 0; index < treePlan.length; index += 1) {
      const tree = treePlan[index]
      const cos = Math.cos(tree.azimuth)
      const sin = Math.sin(tree.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      binormal.copy(tangent).cross(inward)
      basis.makeBasis(tangent, inward, binormal)
      instanceQuaternion.setFromRotationMatrix(basis)
      // A little yaw per tree so the faceted crowns do not all align.
      instanceQuaternion.multiply(
        treeYawScratch.setFromAxisAngle(unitY, tree.tone * Math.PI * 2)
      )
      instancePosition.set(cos, 0, sin).multiplyScalar(radius - 0.02).setY(tree.axial)
      const crown = tree.height * (0.62 + tree.tone * 0.16)
      instanceScale.set(crown, tree.height * 0.78, crown * (0.9 + tree.tone * 0.2))
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
      mesh.setColorAt(
        index,
        instanceColor.setHSL(0.24 + tree.tone * 0.09, 0.45, 0.22 + tree.tone * 0.14)
      )
      instanceScale.set(tree.height * 0.16, tree.height * 0.62, tree.height * 0.16)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      trunks.setMatrixAt(index, instanceMatrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    trunks.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.trees = mesh
    this.treeTrunks = trunks
    this.group.add(mesh)
    this.group.add(trunks)
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
  private buildBeacons(buildings: CityBuilding[], radius: number) {
    if (buildings.length === 0) {
      return
    }

    const rooftops=buildings.map(building=>{
      const authored=cityBlockSpec(building,radius)
      const spec=authored??colonyBuildingSpec(building,this.interiors.get(building))
      return {building,roof:buildingRoofAttachment(spec,radius,authored?.32:0)}
    })
    const maxHeight=rooftops.reduce((h,p)=>Math.max(h,p.roof.height),0)
    const minHeight=Math.max(18,maxHeight*.55)
    const tall=rooftops.filter(p=>p.roof.height>=minHeight).sort((a,b)=>b.roof.height-a.roof.height).slice(0,700)

    if (tall.length === 0) {
      return
    }

    // Physical size only; the shader keeps far beacons a pixel or so wide
    // (installBeaconBlink). Before 2026-09-05 this was clamp(cell*0.05, 0.6, 5)
    // = 4 m on Izma: an 8 m red ball on every tower top.
    const beaconRadius = BEACON_PHYSICAL_RADIUS
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
    const stemHeight=.35
    const stems=new THREE.InstancedMesh(new THREE.CylinderGeometry(.035,.035,stemHeight,5),this.towerMaterial,tall.length)
    stems.name='roof-beacon-stems'
    const mounts:ReturnType<typeof buildingRoofAttachment>[]=[]


    for (let index = 0; index < tall.length; index += 1) {
      const {roof}=tall[index]
      const up=new THREE.Vector3(roof.up.x,roof.up.y,roof.up.z)
      instanceQuaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),up)
      instancePosition.set(roof.x,roof.y,roof.z).addScaledVector(up,stemHeight/2)
      instanceScale.setScalar(1)
      instanceMatrix.compose(instancePosition,instanceQuaternion,instanceScale)
      stems.setMatrixAt(index,instanceMatrix)
      instancePosition.set(roof.x,roof.y,roof.z).addScaledVector(up,stemHeight+beaconRadius)
      instanceScale.setScalar(beaconRadius)
      instanceMatrix.compose(instancePosition,instanceQuaternion,instanceScale)
      mesh.setMatrixAt(index,instanceMatrix)
      mounts.push(roof)
      phases[index] = random()
    }

    stems.instanceMatrix.needsUpdate=true;stems.computeBoundingSphere()
    this.beaconStems=stems;this.group.add(stems)
    mesh.name='roof-beacons';mesh.userData.mounts=mounts
    mesh.userData.buildings=tall.map(p=>p.building);mesh.userData.authored=tall.map(p=>!!cityBlockSpec(p.building,radius));mesh.userData.baseMatrices=mesh.instanceMatrix.array.slice();mesh.userData.visible=new Array(tall.length).fill(true)
    stems.userData.baseMatrices=stems.instanceMatrix.array.slice()
    geometry.setAttribute('aBlinkPhase', new THREE.InstancedBufferAttribute(phases, 1))
    mesh.instanceMatrix.needsUpdate = true
    this.beacons = mesh
    this.group.add(mesh)
  }

  private updateBeaconVisibility(){
    const lights=this.beacons,stems=this.beaconStems
    if(!lights||!stems)return
    let changed=false
    const buildings=lights.userData.buildings as CityBuilding[]
    for(let i=0;i<buildings.length;i++){
      const b=buildings[i]
      const visible=lights.userData.authored[i]?this.authoredBlock.isBuildingVisible(b):this.colonyBuildings.isBuildingVisible(b)
      if(visible===lights.userData.visible[i])continue
      lights.userData.visible[i]=visible;changed=true
      for(const mesh of [lights,stems]){
        instanceMatrix.fromArray(mesh.userData.baseMatrices,i*16)
        if(!visible)instanceMatrix.scale(instanceScale.setScalar(0))
        mesh.setMatrixAt(i,instanceMatrix)
      }
    }
    if(changed){lights.instanceMatrix.needsUpdate=true;stems.instanceMatrix.needsUpdate=true}
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
    const roadWidth = getArterialRoadWidth(radius, length)
    const sidewalkWidth = STREET_PROFILES.arterial.sidewalk
    const deckWidth = roadWidth + sidewalkWidth * 2
    const deckParts: THREE.BufferGeometry[] = []
    const sidewalkParts: THREE.BufferGeometry[] = []
    const edgeParts: THREE.BufferGeometry[] = []
    // Match the cross streets the bridges continue (R-0.2) so the road carries
    // onto the bridge without a step at the window edge.
    const deckRadius = radius - 0.2
    const edgeWidth = 0.25

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
          roadWidth,
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
          const sidewalk = new THREE.CylinderGeometry(deckRadius, deckRadius, sidewalkWidth,
            segments, 1, true, getThetaStart(gapStart + gapSpan * 0.5, gapSpan), gapSpan)
          sidewalk.translate(0, axial + side * (roadWidth + sidewalkWidth) / 2, 0)
          sidewalkParts.push(sidewalk)
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

    const sidewalkMerged = mergeBufferGeometries(sidewalkParts)
    for (const part of sidewalkParts) part.dispose()
    if (sidewalkMerged) {
      const mesh = new THREE.Mesh(sidewalkMerged, this.bridgeSidewalkMaterial)
      this.patchMeshes.push(mesh)
      this.group.add(mesh)
    }
    const deckMerged = mergeBufferGeometries(deckParts)
    const edgeMerged = mergeBufferGeometries(edgeParts)

    for (const part of [...deckParts, ...edgeParts]) {
      part.dispose()
    }

    if (deckMerged !== null) {
      this.bridges = new THREE.Mesh(deckMerged, radius < 300 ? this.localRoadMaterial : this.bridgeMaterial)
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
