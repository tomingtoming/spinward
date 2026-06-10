import * as THREE from 'three'

import {
  getWindowStripArcs,
  planCity,
  type CityBuilding,
  type CityRoad
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

const buildingTone = (tone: number, target: THREE.Color) => {
  // Cool slate blocks with occasional warmer facades.
  const hue = tone > 0.85 ? 0.07 : 0.58
  const lightness = 0.38 + tone * 0.34
  return target.setHSL(hue, 0.16, lightness)
}

// Sun reflection gradient for the exterior mirrors: hot near the hinge edge,
// fading to deep space blue at the free edge.
const createMirrorTexture = () => {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the mirror texture')
  }

  const gradient = context.createLinearGradient(0, 0, size, 0)
  gradient.addColorStop(0, '#f3e3b4')
  gradient.addColorStop(0.35, '#dcc28b')
  gradient.addColorStop(0.7, '#7e98ba')
  gradient.addColorStop(1, '#27374c')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  // Panel seams so the mirror reads as a segmented structure, not a blob.
  context.strokeStyle = 'rgba(10, 18, 28, 0.35)'
  context.lineWidth = 2

  for (let offset = 0; offset <= size; offset += 32) {
    context.beginPath()
    context.moveTo(offset + 0.5, 0)
    context.lineTo(offset + 0.5, size)
    context.stroke()
    context.beginPath()
    context.moveTo(0, offset + 0.5)
    context.lineTo(size, offset + 0.5)
    context.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapT = THREE.RepeatWrapping
  // Seams repeat along the mirror's long axis; the gradient spans its width.
  texture.repeat.set(1, 6)
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
    depthWrite: false
  })

  private buildings: THREE.InstancedMesh | null = null
  private buildingPlan: CityBuilding[] = []
  private windowStrips: THREE.Mesh[] = []
  private mirrors: THREE.Mesh[] = []
  private roads: THREE.Mesh | null = null
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
    this.buildingPlan = plan.buildings
    this.buildBuildings(plan.buildings)
    this.buildRoads(plan.roads, radius)
    this.buildWindowStrips(radius, length)
    this.buildMirrors(radius, length)
    this.buildAxisSpine(radius, length)
  }

  getBuildings(): readonly CityBuilding[] {
    return this.buildingPlan
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
  }

  private clear() {
    this.buildingPlan = []

    if (this.buildings !== null) {
      this.buildings.geometry.dispose()
      this.group.remove(this.buildings)
      this.buildings = null
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
    // curve with the cylinder, so flat planes would visibly chord.
    const roadRadius = radius * 0.998
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

  private buildWindowStrips(radius: number, length: number) {
    // Slightly inside the shell so the glow does not z-fight with it.
    const stripRadius = radius * 0.996

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

  // The three exterior sun mirrors, hinged along one edge of each window
  // strip and opened outward like petals — the classic O'Neill silhouette.
  private buildMirrors(radius: number, length: number) {
    const openAngle = THREE.MathUtils.degToRad(58)
    const mirrorWidth = radius * 1.05
    const mirrorLength = length * 1.02
    const basis = new THREE.Matrix4()
    const along = new THREE.Vector3()
    const axis = new THREE.Vector3(0, 1, 0)
    const normalDir = new THREE.Vector3()

    for (const arc of getWindowStripArcs()) {
      const hingeAzimuth = arc.centerAzimuth + arc.arcRadians * 0.5
      const cos = Math.cos(hingeAzimuth)
      const sin = Math.sin(hingeAzimuth)
      // Tangent pointing back across the window, tilted outward by the
      // opening angle.
      along
        .set(sin, 0, -cos)
        .multiplyScalar(Math.cos(openAngle))
        .add(normalDir.set(cos, 0, sin).multiplyScalar(Math.sin(openAngle)))
      normalDir.crossVectors(along, axis)
      basis.makeBasis(along, axis, normalDir)

      const mirror = new THREE.Mesh(
        new THREE.PlaneGeometry(mirrorWidth, mirrorLength),
        this.mirrorMaterial
      )
      mirror.quaternion.setFromRotationMatrix(basis)
      mirror.position
        .set(cos * radius, 0, sin * radius)
        .addScaledVector(along, mirrorWidth * 0.5)
      this.mirrors.push(mirror)
      this.group.add(mirror)
    }
  }

  private buildAxisSpine(radius: number, length: number) {
    const spineRadius = Math.max(0.35, radius * 0.012)
    const spine = new THREE.Mesh(
      new THREE.CylinderGeometry(spineRadius, spineRadius, length * 0.92, 12, 1),
      this.axisSpineMaterial
    )
    this.axisSpine = spine
    this.group.add(spine)
  }
}
