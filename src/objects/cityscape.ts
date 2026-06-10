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

export class Cityscape {
  readonly group = new THREE.Group()

  private readonly buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(0x1d2a3a),
    emissiveIntensity: 0.9
  })

  private readonly windowStripMaterial = new THREE.MeshBasicMaterial({
    color: 0xd6ecff,
    transparent: true,
    opacity: 0.5,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
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
    this.buildAxisSpine(radius, length)
  }

  getBuildings(): readonly CityBuilding[] {
    return this.buildingPlan
  }

  dispose() {
    this.clear()
    this.buildingMaterial.dispose()
    this.windowStripMaterial.dispose()
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
    const mesh = new THREE.InstancedMesh(geometry, this.buildingMaterial, plan.length)
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
