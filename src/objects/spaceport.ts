import * as THREE from 'three'

import { mergeBufferGeometries } from './cylinder'
import {DockingCollars,DOCKING_REACH,type DockingBerth} from './dockingCollars'

// Ships are human artifacts: fixed size regardless of habitat scale.
const SHIP_LENGTH = 18
const SHIP_RADIUS = 2.2

export type SpaceportDimensions = {
  hubRadius: number
  hubLength: number
  armLength: number
  // Axial center of the hub tube (the cylinder's -Y end plane: the same
  // end the Island-Three mirrors hinge from, so arrivals see the petals).
  hubCenterY: number
  approachSpan: number
}

// Docking only works at the axis, where there is no spin to fight — so the
// port is a hub tube on the mirror-hinge end. Structure scales with the
// habitat (clamped), ships stay human-scale.
export const getSpaceportDimensions = (
  radius: number,
  length: number
): SpaceportDimensions => ({
  hubRadius: THREE.MathUtils.clamp(radius * 0.03, 2.5, 120),
  hubLength: THREE.MathUtils.clamp(length * 0.04, 20, 600),
  armLength: THREE.MathUtils.clamp(radius * 0.12, 8, 360),
  hubCenterY: -length * 0.5,
  approachSpan: THREE.MathUtils.clamp(length * 0.12, 60, 3000)
})

// +1 when the port sits on the +Y end, -1 on the -Y end: every one-sided
// offset (arms, approach path, docked noses) mirrors through this.
const getEndSign = (dims: SpaceportDimensions) => Math.sign(dims.hubCenterY) || 1

export const getDockingPortSize=(dims:SpaceportDimensions)=>{
  const arm=Math.max(.6,dims.hubRadius*.14)
  return {arm,width:Math.max(3.6,arm*3),depth:Math.max(2.4,arm*2.2)}
}
export const planDockingBerths=(dims:SpaceportDimensions):DockingBerth[]=>{
  const endSign=getEndSign(dims),port=getDockingPortSize(dims)
  const face=dims.hubCenterY+endSign*dims.hubLength*.32+endSign*port.depth/2
  return Array.from({length:4},(_,i)=>{
    const angle=i*Math.PI/2
    return {x:Math.cos(angle)*(dims.hubRadius+dims.armLength),z:Math.sin(angle)*(dims.hubRadius+dims.armLength),
      y:face,endSign,shipY:face+endSign*(DOCKING_REACH+SHIP_LENGTH*.57),occupied:i%2===0,portWidth:port.width}
  })
}

// Includes the human-sized shuttles and their short final-approach path. On
// the small Playground this extends much farther than the inhabited hull.
export const getSpaceportEnvelopeRadius = (radius: number, length: number) => {
  const dims = getSpaceportDimensions(radius, length)
  return Math.hypot(dims.hubRadius + dims.armLength + SHIP_RADIUS * 2,
    length * .5 + dims.hubLength * .7 + dims.approachSpan + SHIP_LENGTH)
}

// Low-poly shuttle: body + nose + engine bell, pointing along +Y.
const buildShipGeometry = () => {
  const parts: THREE.BufferGeometry[] = []

  const body = new THREE.CylinderGeometry(SHIP_RADIUS, SHIP_RADIUS * 0.9, SHIP_LENGTH * 0.62, 10)
  parts.push(body)

  const nose = new THREE.CylinderGeometry(.75, SHIP_RADIUS, SHIP_LENGTH * 0.26, 10)
  nose.translate(0, SHIP_LENGTH * 0.44, 0)
  parts.push(nose)

  // A flat pressure interface meets the berth seal at the same forward plane
  // used by the placement plan; no part of the hull enters the pressure trunk.
  const interfaceRing=new THREE.CylinderGeometry(.98,.98,.12,10)
  interfaceRing.translate(0,SHIP_LENGTH*.57-.06,0)
  parts.push(interfaceRing)

  const engine = new THREE.CylinderGeometry(SHIP_RADIUS * 0.55, SHIP_RADIUS * 1.05, SHIP_LENGTH * 0.14, 10)
  engine.translate(0, -SHIP_LENGTH * 0.38, 0)
  parts.push(engine)

  const merged = mergeBufferGeometries(parts)

  for (const part of parts) {
    part.dispose()
  }

  return merged
}

export class Spaceport {
  readonly group = new THREE.Group()
  private readonly collars=new DockingCollars(this.group)

  private readonly structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x55687c,
    roughness: 0.55,
    metalness: 0.45,
    emissive: new THREE.Color(0x111b27),
    emissiveIntensity: 0.8,
    side: THREE.DoubleSide
  })

  private readonly shipMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9c6d4,
    roughness: 0.45,
    metalness: 0.3,
    emissive: new THREE.Color(0x18222e),
    emissiveIntensity: 0.7
  })

  // Navigation strobes: shared material pulsed from update().
  private readonly navLightMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8866,
    toneMapped: false,
    fog: false
  })

  // Constant guide strips lining the arrival bay interior.
  private readonly bayLightMaterial = new THREE.MeshBasicMaterial({
    color: 0x9adfe8,
    toneMapped: false,
    fog: false
  })

  private structure: THREE.Mesh | null = null
  private bayLights: THREE.Mesh | null = null
  private dockedShips: THREE.Mesh | null = null
  private navLights: THREE.InstancedMesh | null = null
  private approachShip: THREE.Mesh | null = null
  private dimensions: SpaceportDimensions | null = null
  private elapsedSeconds = 0
  private radius = 0
  private length = 0

  constructor(dimensionsInput: { radius: number; length: number }) {
    this.group.name='spaceport'
    this.setDimensions(dimensionsInput)
  }

  setDimensions({ radius, length }: { radius: number; length: number }) {
    if (radius === this.radius && length === this.length) {
      return
    }

    this.radius = radius
    this.length = length
    this.clear()

    if (radius <= 0 || length <= 0) {
      return
    }

    const dims = getSpaceportDimensions(radius, length)
    this.dimensions = dims
    const berths=planDockingBerths(dims)
    this.group.userData.berths=berths
    this.collars.rebuild(berths)
    this.buildStructure(dims)
    this.buildBayLights(dims)
    this.buildDockedShips(dims)
    this.buildNavLights(dims)
    this.buildApproachShip(dims)
  }

  update(deltaSeconds: number) {
    this.elapsedSeconds += Math.max(0, deltaSeconds)

    // Strobe: short bright blink every 1.4 seconds.
    const phase = this.elapsedSeconds % 1.4
    const lit = phase < 0.18
    this.navLightMaterial.color.setHex(lit ? 0xffb38c : 0x401f14)

    const dims = this.dimensions
    const ship = this.approachShip

    if (dims === null || ship === null) {
      return
    }

    // A shuttle on slow final approach along the axis, looping.
    const cycleSeconds = 75
    const progress = (this.elapsedSeconds % cycleSeconds) / cycleSeconds
    ship.position.y =
      dims.hubCenterY +
      getEndSign(dims) * (dims.hubLength * 0.7 + dims.approachSpan * (1 - progress))
    ship.position.x = dims.hubRadius * 0.4
    ship.position.z = 0
  }

  dispose() {
    this.clear()
    this.collars.dispose()
    this.structureMaterial.dispose()
    this.shipMaterial.dispose()
    this.navLightMaterial.dispose()
    this.bayLightMaterial.dispose()
  }

  private clear() {
    this.dimensions = null
    this.collars.rebuild([])
    this.group.userData.berths=[]

    for (const mesh of [
      this.structure,
      this.bayLights,
      this.dockedShips,
      this.navLights,
      this.approachShip
    ]) {
      if (mesh !== null) {
        if (mesh instanceof THREE.InstancedMesh) mesh.dispose()
        mesh.geometry.dispose()
        this.group.remove(mesh)
      }
    }

    this.structure = null
    this.bayLights = null
    this.dockedShips = null
    this.navLights = null
    this.approachShip = null
  }

  // Hub tube (open both ends, walk-in scale on big habitats), interior
  // rings, and four radial docking arms with port blocks at their tips.
  private buildStructure(dims: SpaceportDimensions) {
    const parts: THREE.BufferGeometry[] = []
    const tube = Math.max(0.2, dims.hubRadius * 0.08)

    const hub = new THREE.CylinderGeometry(
      dims.hubRadius,
      dims.hubRadius,
      dims.hubLength,
      20,
      1,
      true
    )
    hub.translate(0, dims.hubCenterY, 0)
    parts.push(hub)

    for (const ringOffset of [-0.5, 0, 0.5]) {
      const ring = new THREE.TorusGeometry(dims.hubRadius, tube, 6, 24)
      ring.rotateX(Math.PI * 0.5)
      ring.translate(0, dims.hubCenterY + dims.hubLength * ringOffset, 0)
      parts.push(ring)
    }

    const armY = dims.hubCenterY + getEndSign(dims) * dims.hubLength * 0.32
    const portSize=getDockingPortSize(dims),armThickness=portSize.arm

    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2
      const arm = new THREE.BoxGeometry(dims.armLength, armThickness, armThickness)
      arm.translate(dims.hubRadius + dims.armLength * 0.5, 0, 0)
      arm.rotateY(-angle)
      arm.translate(0, armY, 0)
      parts.push(arm)

      const port = new THREE.BoxGeometry(portSize.width,portSize.depth,portSize.width)
      port.translate(dims.hubRadius + dims.armLength, 0, 0)
      port.rotateY(-angle)
      port.translate(0, armY, 0)
      parts.push(port)
    }

    const merged = mergeBufferGeometries(parts)

    for (const part of parts) {
      part.dispose()
    }

    if (merged === null) {
      return
    }

    this.structure = new THREE.Mesh(merged, this.structureMaterial)
    this.structure.name='spaceport-structure'
    this.group.add(this.structure)
  }

  // Six longitudinal light strips just inside the tube wall, so arriving
  // players read the bay as a lit interior rather than a bare gray pipe.
  private buildBayLights(dims: SpaceportDimensions) {
    const parts: THREE.BufferGeometry[] = []
    const stripThickness = THREE.MathUtils.clamp(dims.hubRadius * 0.02, 0.12, 1.0)
    const stripRadius = dims.hubRadius * 0.94

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2
      const strip = new THREE.BoxGeometry(stripThickness, dims.hubLength * 0.94, stripThickness)
      strip.translate(stripRadius, 0, 0)
      strip.rotateY(-angle)
      strip.translate(0, dims.hubCenterY, 0)
      parts.push(strip)
    }

    const merged = mergeBufferGeometries(parts)

    for (const part of parts) {
      part.dispose()
    }

    if (merged === null) {
      return
    }

    this.bayLights = new THREE.Mesh(merged, this.bayLightMaterial)
    this.group.add(this.bayLights)
  }

  private buildDockedShips(dims: SpaceportDimensions) {
    const parts: THREE.BufferGeometry[] = []
    const endSign = getEndSign(dims)

    // Two shuttles docked nose-in at opposite arm ports.
    for (const berth of planDockingBerths(dims).filter(b=>b.occupied)) {
      const ship = buildShipGeometry()

      if (ship === null) {
        continue
      }

      // Berths face space. Even the smallest habitat keeps the entire ship
      // outside its opaque end cap; only the nose meets the pressure seal.
      if (endSign > 0) {
        ship.rotateZ(Math.PI)
      }

      ship.translate(berth.x,berth.shipY,berth.z)
      parts.push(ship)
    }

    const merged = mergeBufferGeometries(parts)

    for (const part of parts) {
      part.dispose()
    }

    if (merged === null) {
      return
    }

    this.dockedShips = new THREE.Mesh(merged, this.shipMaterial)
    this.dockedShips.name='spaceport-docked-ships'
    this.group.add(this.dockedShips)
  }

  private buildNavLights(dims: SpaceportDimensions) {
    const positions: THREE.Vector3[] = []
    const endSign = getEndSign(dims)

    // Arm tips.
    for (const [index,berth] of planDockingBerths(dims).entries()) {
      const angle=index*Math.PI/2
      positions.push(
        new THREE.Vector3(
          berth.x+Math.cos(angle)*berth.portWidth*.34,
          berth.y+endSign*.12,
          berth.z+Math.sin(angle)*berth.portWidth*.34
        )
      )
    }

    // Hub mouth ring (the space-facing opening).
    // The six-sided torus has its front corner at 60 degrees, not at tube
    // depth. Put the lamp on that actual face, including on giant habitats.
    const rimTube=Math.max(.2,dims.hubRadius*.08)
    const lampRingRadius=(dims.hubRadius+rimTube*.25)*Math.cos(Math.PI/24)
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2+Math.PI/24
      positions.push(
        new THREE.Vector3(
          Math.cos(angle) * lampRingRadius,
          dims.hubCenterY + endSign * (dims.hubLength * 0.5+rimTube*Math.sin(Math.PI/3)+.1),
          Math.sin(angle) * lampRingRadius
        )
      )
    }

    const lightRadius = .24
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      this.navLightMaterial,
      positions.length
    )
    mesh.frustumCulled = false
    const matrix = new THREE.Matrix4()
    const scale = new THREE.Vector3(lightRadius, lightRadius, lightRadius)
    const quaternion = new THREE.Quaternion()

    positions.forEach((position, index) => {
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
    })

    mesh.instanceMatrix.needsUpdate = true
    this.navLights = mesh
    mesh.name='spaceport-navigation-lamps'
    this.group.add(mesh)
  }

  private buildApproachShip(dims: SpaceportDimensions) {
    const geometry = buildShipGeometry()

    if (geometry === null) {
      return
    }

    // Nose toward the port: approaching from outside the end plane.
    const endSign = getEndSign(dims)

    if (endSign > 0) {
      geometry.rotateZ(Math.PI)
    }

    const ship = new THREE.Mesh(geometry, this.shipMaterial)
    ship.position.set(
      dims.hubRadius * 0.4,
      dims.hubCenterY + endSign * dims.approachSpan,
      0
    )
    this.approachShip = ship
    this.group.add(ship)
  }
}
