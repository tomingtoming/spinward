import * as THREE from 'three'
import type { RapierModule } from './rapierContext'
import type { UnitsContext } from '../units/units'
import type { ColonyRailData } from '../worlds/colonyRailData'
import type { RailService } from '../gameplay/railService'
import { railTrainDistance, railTrainMatrix, RAIL_DETAIL_LIMIT } from '../objects/colonyRail'
import { rotatingOrientationToInertial, rotatingPositionToInertial } from '../sim/frameTransforms'
import { BUILDING_COLLISION_GROUPS, scaleVector3ForRapier, setNextKinematicTranslationFromReal } from './rapierBoundary'

type World = InstanceType<RapierModule['World']>
type Body = ReturnType<World['createRigidBody']>
type Collider = ReturnType<World['createCollider']>
type Shape = { id: string; vertices: Float32Array; indices: Uint32Array; side: number; leaf: number }

/** Nearby moving hulls use the same Blender triangles and door offsets as
 * rendering. Streaming never creates a body for every remote service vehicle. */
export class RailColliders {
  private active = new Map<string, { body: Body; doors: { collider: Collider; side: number; leaf: number }[] }>()
  private shapes: Shape[] = []
  private data: ColonyRailData | null = null
  private scale = 0
  private matrix = new THREE.Matrix4()
  private position = new THREE.Vector3()
  private orientation = new THREE.Quaternion()
  private inertialOrientation = new THREE.Quaternion()
  private startPosition = new THREE.Vector3()
  private startOrientation = new THREE.Quaternion()
  constructor(private rapier: RapierModule, private world: World) {}
  configure(data: ColonyRailData | null, units: UnitsContext) {
    if (this.data === data && this.scale === units.simScale) return
    this.clear(); this.data = data; this.scale = units.simScale
    if (!data) return
    this.shapes = Object.entries(data.vehicle).map(([id, mesh]) => {
      const vertices = Float32Array.from(mesh.vertices, (v, i) => units.toSimLength(i % 3 === 0 ? -v : v))
      for (let i = 0; i < vertices.length; i += 3) [vertices[i + 1], vertices[i + 2]] = [vertices[i + 2], vertices[i + 1]]
      const door = /^tram-door-(-?1)-(-?1)$/.exec(id)
      return { id, vertices, indices: Uint32Array.from(Object.values(mesh.meshes).flat()), side: Number(door?.[1] ?? 0), leaf: Number(door?.[2] ?? 0) }
    })
  }
  /** stepAngle is the frame rotation this physics step covers (omega * dt). */
  update(service: RailService | null, azimuth: number, axial: number, frameAngle: number, units: UnitsContext, rider: string | null, stepAngle = 0) {
    const nearest = (service?.trains ?? []).map(train => ({ train, distance: railTrainDistance(train, azimuth, axial) }))
      .filter(c => c.distance < 96 || c.train.id === rider)
      .sort((a, b) => Number(b.train.id === rider) - Number(a.train.id === rider) || a.distance - b.distance).slice(0, RAIL_DETAIL_LIMIT)
    const selected = new Set(nearest.map(c => c.train.id))
    for (const [id, slot] of this.active) if (!selected.has(id)) { this.world.removeRigidBody(slot.body); this.active.delete(id) }
    for (const { train } of nearest) {
      railTrainMatrix(train, this.matrix)
      this.position.setFromMatrixPosition(this.matrix)
      this.orientation.setFromRotationMatrix(this.matrix)
      rotatingPositionToInertial(this.position, frameAngle, this.position)
      rotatingOrientationToInertial(this.orientation, frameAngle, this.inertialOrientation)
      let slot = this.active.get(train.id)
      if (!slot) {
        // Start where the car was when this step began. Created at the step's
        // end pose it would stand still in inertial space for one step while
        // everything around co-rotates at ~177 m/s, and fling a walker beside it.
        const start = rotatingPositionToInertial(this.startPosition.setFromMatrixPosition(this.matrix), frameAngle - stepAngle, this.startPosition)
        const startOrientation = rotatingOrientationToInertial(this.orientation, frameAngle - stepAngle, this.startOrientation)
        const p = scaleVector3ForRapier(start, units)
        const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z).setRotation(startOrientation))
        const doors: { collider: Collider; side: number; leaf: number }[] = []
        for (const shape of this.shapes) {
          const collider = this.world.createCollider(this.rapier.ColliderDesc.trimesh(shape.vertices, shape.indices)
            .setFriction(.6).setRestitution(0).setDensity(0).setCollisionGroups(BUILDING_COLLISION_GROUPS), body)
          if (shape.side) doors.push({ collider, side: shape.side, leaf: shape.leaf })
        }
        slot = { body, doors }; this.active.set(train.id, slot)
      }
      setNextKinematicTranslationFromReal(slot.body, this.position, units)
      slot.body.setNextKinematicRotation(this.inertialOrientation)
      for (const door of slot.doors) door.collider.setTranslationWrtParent({ x: 0, y: 0,
        z: units.toSimLength(door.leaf * .8 * (door.side === -Math.sign(train.lane) ? train.doorOpen : 0)) })
    }
  }
  get stats() { return { bodies: this.active.size, colliders: this.active.size * this.shapes.length,
    triangles: this.active.size * this.shapes.reduce((n, s) => n + s.indices.length / 3, 0), limit: RAIL_DETAIL_LIMIT } }
  clear() { for (const slot of this.active.values()) this.world.removeRigidBody(slot.body); this.active.clear(); this.shapes = [] }
  dispose() { this.clear() }
}
