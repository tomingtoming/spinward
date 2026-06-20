import * as THREE from 'three'

import {
  ISLAND_THREE_TOPOLOGY,
  type HabitatTopology
} from '../sim/habitatConfig'
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
  type CityPatch,
  type CityRoad,
  type CityTower,
  type CityTree
} from './cityLayout'
import { mergeBufferGeometries } from './cylinder'

type CityscapeDimensions = {
  radius: number
  length: number
  topology?: HabitatTopology
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
  }

  const merged = mergeWithMaterialGroups(parts)

  for (const part of parts) {
    part.geometry.dispose()
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
// Night city signature: an emissive teal road grid, red rooftop beacons, and
// windows that cool from warm dusk amber toward white/cyan at deep night.
const ROAD_GLOW = new THREE.Color(0x39d6e0)
const BEACON_COLOR = new THREE.Color(0xff2e2a)
const WINDOW_WARM = new THREE.Color(0xffe2b8)
const WINDOW_COOL = new THREE.Color(0xdfeaff)

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

const buildingTone = (tone: number, target: THREE.Color) => {
  // Cool slate blocks with occasional warmer facades.
  const hue = tone > 0.85 ? 0.07 : 0.58
  const lightness = 0.38 + tone * 0.34
  return target.setHSL(hue, 0.16, lightness)
}

// Sun reflection gradient for the exterior mirrors: hot near the hinge end
// (closest to the habitat), fading to deep space blue at the free end.
const createMirrorTexture = () => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the mirror texture')
  }

  // CanvasTexture flips Y, so v=0 (the hinge end of the plane) samples the
  // bottom of the canvas — start the bright end there.
  // The whole panel reflects the sun, so it stays warm for most of its
  // length and only cools toward the far free end.
  const gradient = context.createLinearGradient(0, size, 0, 0)
  gradient.addColorStop(0, '#f7ead0')
  gradient.addColorStop(0.55, '#ecd7a4')
  gradient.addColorStop(0.85, '#a8bcd4')
  gradient.addColorStop(1, '#3a4c64')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  // Panel seams so the mirror reads as a segmented structure, not a blob.
  context.strokeStyle = 'rgba(10, 18, 28, 0.35)'
  context.lineWidth = 2

  for (let offset = 0; offset <= size; offset += 16) {
    context.beginPath()
    context.moveTo(0, offset + 0.5)
    context.lineTo(size, offset + 0.5)
    context.stroke()
  }

  for (let offset = 0; offset <= size; offset += 32) {
    context.beginPath()
    context.moveTo(offset + 0.5, 0)
    context.lineTo(offset + 0.5, size)
    context.stroke()
  }

  // Reflected starfield: the mirror is what you see through the windows,
  // so the night sky lives on its surface. Denser toward the space end.
  let seed = 0x51c0ffee >>> 0
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }

  for (let star = 0; star < 240; star += 1) {
    const x = random() * size
    const y = random() * size
    // Canvas top = far (dark) end of the petal.
    const weight = 1 - y / size
    const alpha = (0.3 + random() * 0.7) * (0.35 + weight * 0.65)
    const dot = random() < 0.06 ? 2.4 : 1.4
    context.globalAlpha = alpha
    context.fillStyle = '#ffffff'
    context.fillRect(x, y, dot, dot)
  }

  context.globalAlpha = 1

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Facade texture shared by buildings: a window grid where a portion of the
// windows are lit. Used as the emissive map on the side faces. Large
// buildings get a denser grid so their windows stay window-sized.
const createWindowTexture = (columns = 6, rows = 9) => {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the building window texture')
  }

  let seed = 0x2c1b3a5d >>> 0
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }

  context.fillStyle = '#000000'
  context.fillRect(0, 0, size, size)

  const cellWidth = size / columns
  const cellHeight = size / rows

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (random() > 0.42) {
        continue
      }

      const tone = random()
      context.fillStyle = tone < 0.7 ? '#ffd9a0' : '#cfe6ff'
      context.globalAlpha = 0.55 + random() * 0.45
      context.fillRect(
        column * cellWidth + cellWidth * 0.22,
        row * cellHeight + cellHeight * 0.24,
        cellWidth * 0.56,
        cellHeight * 0.5
      )
    }
  }

  context.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // The far side's lit windows are tiny and high-contrast across the colony, so
  // they sparkle without anisotropic filtering. Request the hardware max.
  texture.anisotropy = 16
  return texture
}

export class Cityscape {
  readonly group = new THREE.Group()

  private readonly windowTexture = createWindowTexture()
  private readonly largeWindowTexture = createWindowTexture(14, 20)

  // Side faces carry the lit-window emissive map; roof and foundation stay
  // plain so towers do not glow from above.
  private readonly buildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.windowTexture
  })

  private readonly largeBuildingSideMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0xffe2b8),
    emissiveIntensity: 0.65,
    emissiveMap: this.largeWindowTexture
  })

  private readonly buildingRoofMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.08,
    emissive: new THREE.Color(0x141c26),
    emissiveIntensity: 0.5
  })

  // Faint glass tint: the cutout in the shell shows space and the mirrors,
  // this band just hints at the glazing.
  private readonly windowStripMaterial = new THREE.MeshBasicMaterial({
    color: 0xbcd8f2,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  })

  private readonly mirrorMaterial = new THREE.MeshBasicMaterial({
    map: createMirrorTexture(),
    side: THREE.DoubleSide,
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

  private readonly towerAccentMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    toneMapped: false
  })

  // Red aviation warning lights on the tallest rooftops. Unlit and always on
  // (real beacons burn day and night); they read instantly at dusk and night.
  private readonly beaconMaterial = new THREE.MeshBasicMaterial({
    color: BEACON_COLOR.clone(),
    toneMapped: false
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
  private collisionBuildings: CityBuilding[] = []
  private collisionIndex: CityCollisionIndex = buildCityCollisionIndex([], 1, 1)
  private windowStrips: THREE.Mesh[] = []
  private bridges: THREE.Mesh | null = null
  private bridgeEdges: THREE.Mesh | null = null
  private mirrors: THREE.Mesh[] = []
  private roads: THREE.Mesh | null = null
  private localRoads: THREE.Mesh | null = null
  private patchMeshes: THREE.Mesh[] = []
  private trees: THREE.InstancedMesh | null = null
  private lamps: THREE.InstancedMesh | null = null
  private beacons: THREE.InstancedMesh | null = null
  private towerGroup: THREE.Group | null = null
  private cables: THREE.Mesh | null = null
  private spineRings: THREE.Mesh | null = null
  private axisSpine: THREE.Mesh | null = null
  private radius = 0
  private length = 0
  private topology: HabitatTopology = ISLAND_THREE_TOPOLOGY

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
    this.setDimensions(dimensions)
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

  setDimensions({ radius, length, topology }: CityscapeDimensions) {
    const nextTopology = topology ?? this.topology

    if (radius === this.radius && length === this.length && nextTopology === this.topology) {
      return
    }

    this.radius = radius
    this.length = length
    this.topology = nextTopology
    // Begin fading roads/bridges out past ~1.15 radii (so the opposite side of
    // the cylinder, ~2 radii away, is well into the fade) and finish by ~1.9.
    // Floored so small habitats — where nothing is far enough to alias — never
    // fade. vFogDepth is camera-relative, so this tracks the player anywhere.
    this.fadeStart.value = Math.max(radius * 1.15, 600)
    this.fadeEnd.value = Math.max(radius * 1.9, 1200)
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
    this.collisionBuildings =
      plan.tower !== null
        ? [...plan.buildings, this.getTowerFootprint(plan.tower)]
        : plan.buildings
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
    this.buildCables(radius, length)
    this.buildSpineRings(radius, length)
    this.buildAxisSpine(radius, length)

    if (plan.tower !== null) {
      this.buildTower(plan.tower, radius)
    }
  }

  getBuildings(): readonly CityBuilding[] {
    return this.collisionBuildings
  }

  // O(1) spatial lookups for the per-frame collision queries.
  getCollisionIndex(): CityCollisionIndex {
    return this.collisionIndex
  }

  // Day/night dressing: the mirrors dim to night-side blue, facades and
  // street lamps take over as the light sources.
  setDaylight(daylight: number) {
    const night = 1 - daylight
    this.mirrorMaterial.color.lerpColors(MIRROR_NIGHT, MIRROR_DAY, daylight)
    this.windowStripMaterial.opacity = 0.05 + daylight * 0.12
    this.buildingSideMaterial.emissiveIntensity = 0.6 + night * 0.85
    this.largeBuildingSideMaterial.emissiveIntensity =
      this.buildingSideMaterial.emissiveIntensity
    // Windows cool from warm dusk amber toward white/cyan as night falls.
    this.buildingSideMaterial.emissive.lerpColors(WINDOW_COOL, WINDOW_WARM, daylight)
    this.largeBuildingSideMaterial.emissive.copy(this.buildingSideMaterial.emissive)
    // Roads glow teal at night; arterials brighter than residential locals.
    this.roadMaterial.emissiveIntensity = night * 1.15
    this.localRoadMaterial.emissiveIntensity = night * 0.7
    this.lampMaterial.color.lerpColors(LAMP_NIGHT, LAMP_DAY, daylight)
    this.axisSpineMaterial.color.lerpColors(SPINE_NIGHT, SPINE_DAY, daylight)
    this.axisSpineMaterial.opacity = 0.35 + daylight * 0.5
    // Let the glowing night grid arch overhead and dim into haze (push the fade
    // window out at night); keep it tight in daylight to kill asphalt shimmer.
    if (this.radius > 0) {
      this.fadeStart.value = Math.max(this.radius * (1.15 + night * 0.55), 600)
      this.fadeEnd.value = Math.max(this.radius * (1.9 + night * 1.2), 1200)
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
    this.clear()
    this.buildingSideMaterial.dispose()
    this.largeBuildingSideMaterial.dispose()
    this.buildingRoofMaterial.dispose()
    this.windowTexture.dispose()
    this.largeWindowTexture.dispose()
    this.windowStripMaterial.dispose()
    this.mirrorMaterial.map?.dispose()
    this.mirrorMaterial.dispose()
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
    this.cableMaterial.dispose()
    this.spineRingMaterial.dispose()
  }

  private disposeBuildingBatches() {
    for (const batch of [
      this.buildings,
      this.largeBuildings,
      this.farBuildings,
      ...this.archetypeBatches
    ]) {
      if (batch !== null) {
        batch.geometry.dispose()
        this.group.remove(batch)
      }
    }

    this.buildings = null
    this.largeBuildings = null
    this.farBuildings = null
    this.archetypeBatches = []
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

    for (const strip of this.windowStrips) {
      strip.geometry.dispose()
      this.group.remove(strip)
    }

    this.windowStrips = []

    for (const mirror of this.mirrors) {
      mirror.geometry.dispose()
      this.group.remove(mirror)
    }

    this.mirrors = []

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
    this.disposeBuildingBatches()

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

    this.buildings = this.buildBuildingBatch(small, this.buildingSideMaterial)
    this.largeBuildings = this.buildBuildingBatch(large, this.largeBuildingSideMaterial)

    for (const kind of ['setback', 'tower', 'house'] as const) {
      const batch = this.buildArchetypeBatch(
        near.filter((b) => b.kind === kind),
        kind
      )

      if (batch !== null) {
        this.archetypeBatches.push(batch)
      }
    }

    this.farBuildings = this.buildBuildingBatch(far, this.largeBuildingSideMaterial)
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
      kind === 'house' ? this.buildingSideMaterial : this.largeBuildingSideMaterial
    const mesh = new THREE.InstancedMesh(
      geometry,
      [sideMaterial, this.buildingRoofMaterial],
      plan.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false

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
      mesh.setColorAt(index, buildingTone(building.tone, instanceColor))
    }

    mesh.instanceMatrix.needsUpdate = true

    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true
    }

    this.group.add(mesh)
    return mesh
  }

  private buildBuildingBatch(
    plan: CityBuilding[],
    sideMaterial: THREE.MeshStandardMaterial
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
      mesh.setColorAt(index, buildingTone(building.tone, instanceColor))
    }

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
      const roadRadius = radius - 0.05
      const geometries: THREE.BufferGeometry[] = []

      for (const road of roads) {
        if (road.kind !== kind) {
          continue
        }

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
        // Avenues run along the axis; cross streets run along the arc.
        const isAvenue = road.axialLength > road.tangentWidth
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
    const bandRadius = radius - 0.04
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
    const beaconRadius = THREE.MathUtils.clamp(cell * 0.04, 0.4, 3)
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      this.beaconMaterial,
      tall.length
    )
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.frustumCulled = false
    instanceQuaternion.identity()
    instanceScale.setScalar(beaconRadius)

    for (let index = 0; index < tall.length; index += 1) {
      const building = tall[index]
      instancePosition
        .set(Math.cos(building.azimuth), 0, Math.sin(building.azimuth))
        .multiplyScalar(radius - building.height - beaconRadius)
        .setY(building.axial)
      instanceMatrix.compose(instancePosition, instanceQuaternion, instanceScale)
      mesh.setMatrixAt(index, instanceMatrix)
    }

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

    for (const arc of getWindowArcs(this.topology)) {
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
    const deckRadius = radius - 0.05
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

  // The three exterior sun mirrors, Island Three style: each is a long petal
  // hinged at one end of the cylinder, spanning a window strip in width and
  // tilted 45 degrees off the axis. Sunlight arriving parallel to the axis
  // bounces 90 degrees off the petal and falls radially inward through the
  // window — which is exactly the direction our per-window sun lights point.
  private buildMirrors(radius: number, length: number) {
    const mirrorWidth = radius * 1.05
    // Covers the full cylinder length when projected along the axis.
    const mirrorLength = length * Math.SQRT2 * 1.02
    const basis = new THREE.Matrix4()
    const along = new THREE.Vector3()
    const axis = new THREE.Vector3(0, 1, 0)
    const tangentDir = new THREE.Vector3()
    const outwardDir = new THREE.Vector3()
    const normalDir = new THREE.Vector3()

    for (const arc of getWindowArcs(this.topology)) {
      const cos = Math.cos(arc.centerAzimuth)
      const sin = Math.sin(arc.centerAzimuth)
      outwardDir.set(cos, 0, sin)
      tangentDir.set(-sin, 0, cos)
      // 45 degrees between the axis and the outward radial direction.
      along.copy(axis).add(outwardDir).multiplyScalar(Math.SQRT1_2)
      normalDir.crossVectors(tangentDir, along)
      basis.makeBasis(tangentDir, along, normalDir)

      const mirror = new THREE.Mesh(
        new THREE.PlaneGeometry(mirrorWidth, mirrorLength),
        this.mirrorMaterial
      )
      mirror.quaternion.setFromRotationMatrix(basis)
      // Hinged at the rim of the -Y end, leaning out over its window.
      mirror.position
        .copy(outwardDir)
        .multiplyScalar(radius)
        .setY(-length * 0.5)
        .addScaledVector(along, mirrorLength * 0.5)
      this.mirrors.push(mirror)
      this.group.add(mirror)
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
