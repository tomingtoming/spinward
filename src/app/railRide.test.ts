import { expect, test } from 'bun:test'
import * as THREE from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import { readColonyManifest } from '../worlds/authoredColony'
import { RailService } from '../gameplay/railService'
import { RailRide } from './railRide'
import { ColonyRail, railTrainMatrix } from '../objects/colonyRail'
import { RailColliders } from '../physics/railColliders'
import { initRapier } from '../physics/rapierContext'
import { createPlayerTraversalState, resetPlayerToGrounded, disposePlayerTraversalState } from './playerTraversal'
import { inertialPositionToRotating, inertialVelocityToRotating, rotatingPositionToInertial } from '../sim/frameTransforms'
import { createUnitsContext } from '../units/units'
import { scaleVector3ForRapier } from '../physics/rapierBoundary'

const manifest = readColonyManifest(raw), data = manifest.railways!
const frame = { radius: 3200, frameAngle: 1, omega: .03 }
test('standing passengers retain a local floor anchor, body offset and real velocity until alighting', async () => {
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
  const service = new RailService(data), ride = new RailRide(); service.step(2)
  const train = service.trains[0], p = train.station!.boarding[0]
  const state = createPlayerTraversalState({ azimuth: p[0] / 3200, axialPosition: p[1] }, 3200, 1, .03, { rapier, world })
  resetPlayerToGrounded(state, { ...frame, azimuth: p[0] / 3200, axialPosition: p[1], groundHeight: p[2] })
  try {
    expect(ride.enter(service, train, state, frame)).toBe(true)
    expect(state.physics!.freeFlyBody.collider(0).isSensor()).toBe(true)
    service.step(60)
    for (let i = 0; i < 120; i++) {
      service.step(1 / 60); frame.frameAngle += .03 / 60
      ride.pin(state, frame, service.time); world.step(); ride.pin(state, frame, service.time)
      const point = new THREE.Vector3(-.45, data.configuration.carFloor, 0).applyMatrix4(railTrainMatrix(train))
      const physical = inertialPositionToRotating(state.inertialPosition, frame.frameAngle, new THREE.Vector3())
      expect(frame.radius - Math.hypot(physical.x, physical.z) - state.groundHeight).toBeCloseTo(.4, 6)
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(frame.radius - state.groundHeight, 6)
      expect(state.surface.axialPosition).toBeCloseTo(point.y, 6)
      expect(ride.leave(state, frame)).toBe(false)
    }
    const velocity = inertialVelocityToRotating(state.inertialPosition, state.inertialVelocity, frame.omega, frame.frameAngle, new THREE.Vector3())
    expect(velocity.length()).toBeGreaterThan(10)
    const arrival = train.arrivalIn; service.step(arrival + 2); ride.pin(state, frame, service.time)
    expect(ride.leave(state, frame)).toBe(true)
    expect(state.physics!.freeFlyBody.collider(0).isSensor()).toBe(false)
    expect(state.groundHeight).toBe(train.station!.boarding[train.lane < 0 ? 0 : 1][2])
    expect(ride.riding).toBe(false)
  } finally { ride.cancel(state); disposePlayerTraversalState(state); world.free() }
})

test('nearby moving colliders meet the drawn car floor and release every body across preset scale changes', async () => {
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
  const service = new RailService(data), colliders = new RailColliders(rapier, world)
  const view = new ColonyRail(new THREE.Group())
  view.configure(data, manifest.palette, manifest.materialDetails)
  try {
    for (const scale of [1, .1, 1]) {
      const units = createUnitsContext(scale); colliders.configure(data, units)
      for (let i = 0; i < 36; i++) {
        service.step(.1); const train = service.trains[i]
        colliders.update(service, train.position[0] / 3200, train.position[1], .7, units, train.id)
        world.step()
        expect(colliders.stats.bodies).toBeLessThanOrEqual(3); expect(colliders.stats.colliders).toBeLessThanOrEqual(15)
        const matrix = railTrainMatrix(train), floor = new THREE.Vector3(0, data.configuration.carFloor, 0).applyMatrix4(matrix)
        const origin = new THREE.Vector3(0, data.configuration.carFloor + .5, 0).applyMatrix4(matrix)
        rotatingPositionToInertial(origin, .7, origin); rotatingPositionToInertial(floor, .7, floor)
        const direction = floor.clone().sub(origin).normalize(), ray = new rapier.Ray(scaleVector3ForRapier(origin, units), direction)
        const hit = world.castRay(ray, units.toSimLength(.6), true)
        expect(hit, train.id).not.toBeNull()
        expect(units.toRealLength(hit!.timeOfImpact)).toBeCloseTo(.5, 2)
      }
    }
    view.update(0, service.trains[0].position[0] / 3200, service.trains[0].position[1], 0, null)
    expect(view.group.userData.detailed).toBeLessThanOrEqual(3)
    expect(view.lightSources).toHaveLength(36)
    view.configure(null, {}); colliders.configure(null, createUnitsContext(1))
    expect(colliders.stats.bodies).toBe(0); expect(view.group.children).toHaveLength(0)
  } finally { view.dispose(); colliders.dispose(); world.free() }
})
