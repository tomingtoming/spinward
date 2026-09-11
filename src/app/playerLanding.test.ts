import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { HABITAT_PRESETS } from '../presets/presets'
import { initRapier } from '../physics/rapierContext'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { createUnitsContext } from '../units/units'
import {
  createPlayerTraversalState, detachPlayerToFreeFly, disposePlayerTraversalState,
  resetPlayerToFreeFly,
  stepGroundedPlayer, syncGroundedSurfaceFromPhysics, syncPlayerTraversalFromPhysics,
  updatePlayerGroundContact
} from './playerTraversal'

for (const preset of HABITAT_PRESETS) for (const hz of [30, 72]) {
  test(`${preset.id} ${hz} Hz jump lands after the ballistic arc reaches the floor`, async () => {
    const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
    const radius = preset.real.radius_m, length = preset.real.length_m ?? preset.real.thickness_m!
    const omega = preset.real.omega_rad_s!, units = createUnitsContext(preset.sim.scale)
    applyWorldLengthUnit(world, units)
    const wall = createRotatingCylinderBody(rapier, world, { radius, length, units })
    wall.setAngularVelocity(omega)
    const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, 0, omega, { rapier, world, units })
    const deltaSeconds = 1 / hz
    let frameAngle = 0
    world.timestep = deltaSeconds
    try {
      // Settle against the actual rotating panels before jumping. No analytic
      // ground constraint or constant-gravity acceleration runs in this test.
      for (let i = 0; i < hz * 2; i++) {
        frameAngle += omega * deltaSeconds
        stepGroundedPlayer(state, { radius, length, omega, frameAngleEnd: frameAngle, deltaSeconds, axisDistanceDelta: 0, tangentDistanceDelta: 0 })
        world.step()
        syncGroundedSurfaceFromPhysics(state, frameAngle)
      }
      if (process.env.LANDING_TRACE) console.log({ settled: preset.id, hz, mode: state.mode, gap: radius - Math.hypot(state.inertialPosition.x, state.inertialPosition.z), radialSpeed: state.inertialPosition.dot(state.inertialVelocity) / state.inertialPosition.length() })
      const launch = new THREE.Vector3(-Math.cos(state.surface.azimuth), 0, -Math.sin(state.surface.azimuth)).multiplyScalar(4)
      detachPlayerToFreeFly(state, { radius, omega, frameAngle, launchVelocity: launch })
      const startRadius = Math.hypot(state.inertialPosition.x, state.inertialPosition.z)
      const returnTime = -2 * state.inertialPosition.dot(state.inertialVelocity) / state.inertialVelocity.lengthSq()
      let landedAt = 0, peak = 0, landingContacts = 0
      for (let i = 1; i < hz * 4; i++) {
        frameAngle += omega * deltaSeconds
        world.step()
        syncPlayerTraversalFromPhysics(state)
        peak = Math.max(peak, startRadius - Math.hypot(state.inertialPosition.x, state.inertialPosition.z))
        if (updatePlayerGroundContact(state, { radius, length, omega, frameAngle })) {
          landedAt = i * deltaSeconds
          world.contactPairsWith(state.physics!.freeFlyBody.collider(0), other => {
            world.contactPair(state.physics!.freeFlyBody.collider(0), other, (manifold, flipped) => {
              landingContacts += manifold.numSolverContacts()
              if (process.env.LANDING_TRACE) console.log({ normal: manifold.normal(), flipped, distance: manifold.numSolverContacts() ? manifold.solverContactDist(0) : null })
            })
          })
          break
        }
      }
      if (process.env.LANDING_TRACE) console.log({ preset: preset.id, hz, returnTime, landedAt, peak, landingContacts })
      expect(landedAt).toBeGreaterThan(returnTime * .8)
      expect(landedAt).toBeLessThan(returnTime * 1.5 + .1)
      expect(peak).toBeGreaterThan(.5)
      expect(landingContacts).toBeGreaterThan(0)
    } finally {
      wall.dispose()
      disposePlayerTraversalState(state)
      world.free()
    }
  })
}

for (const kind of ['floor', 'wall', 'ceiling', 'dynamic', 'none'] as const) {
  for (const supportFirst of [false, true]) {
    test(`landing requires static support below the player: ${kind}, support first=${supportFirst}`, async () => {
      const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
      const radius = 30, length = 60, omega = 0, frameAngle = 0
      const createSupport = () => {
        if (kind === 'none') return
        const position = kind === 'wall' ? { x: 29.6, y: 1.31, z: 0 }
          : { x: 29.6 + (kind === 'ceiling' ? -1.31 : 1.31), y: 0, z: 0 }
        const body = world.createRigidBody((kind === 'dynamic' ? rapier.RigidBodyDesc.dynamic() : rapier.RigidBodyDesc.fixed()).setTranslation(position.x, position.y, position.z))
        world.createCollider(rapier.ColliderDesc.cuboid(1, 1, 1), body)
      }
      if (supportFirst) createSupport()
      const state = createPlayerTraversalState({ azimuth: 0, axialPosition: 0 }, radius, frameAngle, omega, { rapier, world })
      if (!supportFirst) createSupport()
      try {
        resetPlayerToFreeFly(state, { rotatingPosition: new THREE.Vector3(29.6, 0, 0), omega, frameAngle })
        world.step()
        syncPlayerTraversalFromPhysics(state)
        let contacts = 0
        world.contactPairsWith(state.physics!.freeFlyBody.collider(0), other => {
          world.contactPair(state.physics!.freeFlyBody.collider(0), other, manifold => { contacts += manifold.numSolverContacts() })
        })
        expect(contacts > 0).toBe(kind !== 'none')
        expect(updatePlayerGroundContact(state, { radius, length, omega, frameAngle })).toBe(kind === 'floor')
      } finally {
        disposePlayerTraversalState(state)
        world.free()
      }
    })
  }
}
