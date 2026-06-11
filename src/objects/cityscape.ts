import * as THREE from 'three'

import {
  getCityCellSize,
  getLandStripCenters,
  getWindowStripArcs,
  planCity,
  type CityBuilding,
  type CityPatch,
  type CityRoad,
  type CityTower,
  type CityTree
} from './cityLayout'
import { mergeBufferGeometries } from './cylinder'

type CityscapeDimensions = {
  radius: number
  length: number
}

const fullTurn = Math.PI * 2

// Same azimuth -> CylinderGeometry theta conversion used by CylinderHabitat.
const getThetaStart = (centerAzimuth: number, arcRadians: number) =>
  THREE.MathUtils.euclideanModulo(
    Math.PI * 0.5 - centerAzimuth - arcRadians * 0.5,
    fullTurn
  )

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

const MIRROR_DAY = new THREE.Color(0xffffff)
const MIRROR_NIGHT = new THREE.Color(0x2a3648)
const LAMP_DAY = new THREE.Color(0x6b5a40)
const LAMP_NIGHT = new THREE.Color(0xffe2b0)
const SPINE_DAY = new THREE.Color(0xffeec4)
const SPINE_NIGHT = new THREE.Color(0x8a7f63)

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

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Facade texture shared by every building: a window grid where a portion of
// the windows are lit. Used as the emissive map on the side faces.
const createWindowTexture = () => {
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

  const columns = 6
  const rows = 9
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
  return texture
}

export class Cityscape {
  readonly group = new THREE.Group()

  private readonly windowTexture = createWindowTexture()

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

  private readonly roadMaterial = new THREE.MeshBasicMaterial({
    color: 0x141a21,
    transparent: true,
    opacity: 0.88,
    side: THREE.BackSide,
    depthWrite: false,
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

  private buildings: THREE.InstancedMesh | null = null
  private collisionBuildings: CityBuilding[] = []
  private windowStrips: THREE.Mesh[] = []
  private mirrors: THREE.Mesh[] = []
  private roads: THREE.Mesh | null = null
  private patchMeshes: THREE.Mesh[] = []
  private trees: THREE.InstancedMesh | null = null
  private lamps: THREE.InstancedMesh | null = null
  private towerGroup: THREE.Group | null = null
  private cables: THREE.Mesh | null = null
  private spineRings: THREE.Mesh | null = null
  private axisSpine: THREE.Mesh | null = null
  private radius = 0
  private length = 0

  constructor(dimensions: CityscapeDimensions) {
    this.setDimensions(dimensions)
  }

  setDimensions({ radius, length }: CityscapeDimensions) {
    if (radius === this.radius && length === this.length) {
      return
    }

    this.radius = radius
    this.length = length
    this.clear()

    if (radius <= 0 || length <= 0) {
      return
    }

    const plan = planCity({ radius, length })
    this.collisionBuildings =
      plan.tower !== null
        ? [...plan.buildings, this.getTowerFootprint(plan.tower)]
        : plan.buildings
    this.buildBuildings(plan.buildings)
    this.buildRoads(plan.roads, radius)
    this.buildPatches(plan.patches, radius)
    this.buildTrees(plan.trees, radius)
    this.buildLamps(plan.roads, radius)
    this.buildWindowStrips(radius, length)
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

  // Day/night dressing: the mirrors dim to night-side blue, facades and
  // street lamps take over as the light sources.
  setDaylight(daylight: number) {
    this.mirrorMaterial.color.lerpColors(MIRROR_NIGHT, MIRROR_DAY, daylight)
    this.windowStripMaterial.opacity = 0.05 + daylight * 0.12
    this.buildingSideMaterial.emissiveIntensity = 0.6 + (1 - daylight) * 0.85
    this.lampMaterial.color.lerpColors(LAMP_NIGHT, LAMP_DAY, daylight)
    this.axisSpineMaterial.color.lerpColors(SPINE_NIGHT, SPINE_DAY, daylight)
    this.axisSpineMaterial.opacity = 0.35 + daylight * 0.5
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
      tone: 0.5
    }
  }

  dispose() {
    this.clear()
    this.buildingSideMaterial.dispose()
    this.buildingRoofMaterial.dispose()
    this.windowTexture.dispose()
    this.windowStripMaterial.dispose()
    this.mirrorMaterial.map?.dispose()
    this.mirrorMaterial.dispose()
    this.axisSpineMaterial.dispose()
    this.roadMaterial.dispose()
    this.parkMaterial.dispose()
    this.farmMaterial.map?.dispose()
    this.farmMaterial.dispose()
    this.treeMaterial.dispose()
    this.lampMaterial.dispose()
    this.towerMaterial.dispose()
    this.towerAccentMaterial.dispose()
    this.cableMaterial.dispose()
    this.spineRingMaterial.dispose()
  }

  private clear() {
    this.collisionBuildings = []

    if (this.buildings !== null) {
      this.buildings.geometry.dispose()
      this.group.remove(this.buildings)
      this.buildings = null
    }

    for (const patch of this.patchMeshes) {
      patch.geometry.dispose()
      this.group.remove(patch)
    }

    this.patchMeshes = []

    for (const single of [this.trees, this.lamps, this.cables, this.spineRings]) {
      if (single !== null) {
        single.geometry.dispose()
        this.group.remove(single)
      }
    }

    this.trees = null
    this.lamps = null
    this.cables = null
    this.spineRings = null

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
    if (plan.length === 0) {
      return
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z. Local +y is the roof
    // (toward the axis) in the instance basis below.
    const materials = [
      this.buildingSideMaterial,
      this.buildingSideMaterial,
      this.buildingRoofMaterial,
      this.buildingRoofMaterial,
      this.buildingSideMaterial,
      this.buildingSideMaterial
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

    this.buildings = mesh
    this.group.add(mesh)
  }

  private buildRoads(roads: CityRoad[], radius: number) {
    if (roads.length === 0) {
      return
    }

    // Each road is a thin arc band hugging the inner wall; cross streets
    // curve with the cylinder, so flat planes would visibly chord. The
    // clearance is absolute meters: proportional offsets float at head
    // height on multi-kilometer habitats.
    const roadRadius = radius - 0.05
    const geometries: THREE.BufferGeometry[] = []

    for (const road of roads) {
      const arcRadians = road.tangentWidth / radius
      const segments = Math.max(2, Math.ceil(arcRadians / THREE.MathUtils.degToRad(4)))
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
      geometries.push(geometry)
    }

    const merged = mergeBufferGeometries(geometries)

    for (const geometry of geometries) {
      geometry.dispose()
    }

    if (merged === null) {
      return
    }

    const mesh = new THREE.Mesh(merged, this.roadMaterial)
    mesh.renderOrder = 1
    this.roads = mesh
    this.group.add(mesh)
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
    const segments = Math.max(2, Math.ceil(arcRadians / THREE.MathUtils.degToRad(4)))
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

  private buildPatches(patches: CityPatch[], radius: number) {
    const bandRadius = radius - 0.04
    // Crop rows stay field-scale even on multi-km habitats.
    const stripeWorld = Math.min(getCityCellSize(radius) * 0.8, 30)

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
  private buildLamps(roads: CityRoad[], radius: number) {
    const cell = getCityCellSize(radius)
    const spacing = cell * 2.2
    const lampHeight = THREE.MathUtils.clamp(cell * 0.55, 3, 12)
    const lampRadius = THREE.MathUtils.clamp(cell * 0.02, 0.12, 0.5)
    const positions: Array<{ azimuth: number; axial: number }> = []

    for (const road of roads) {
      // Avenues run along the axis; cross streets are wider than long.
      if (road.axialLength <= road.tangentWidth) {
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
    const cableRadius = Math.max(0.05, radius * 0.004)
    const cableLength = Math.max(0, radius - spineRadius)

    if (cableLength <= 0) {
      return
    }

    const geometries: THREE.BufferGeometry[] = []
    const transform = new THREE.Matrix4()

    for (const stripCenter of getLandStripCenters()) {
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

    for (const arc of getWindowStripArcs()) {
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

    for (const arc of getWindowStripArcs()) {
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
