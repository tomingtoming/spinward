import { test, expect } from 'bun:test'
import { HABITAT_PRESETS } from '../presets/presets'
import { createPlayerTraversalState, disposePlayerTraversalState, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createRotatingCylinderBody } from './rotatingCylinder'
import { initRapier } from './rapierContext'
import { applyWorldLengthUnit } from './rapierBoundary'
import { createUnitsContext } from '../units/units'

for (const preset of HABITAT_PRESETS) {
  test(`${preset.id} physical floor supports standing around the whole circumference`, async () => {
    const rapier = await initRapier(), radius = preset.real.radius_m
    const length = preset.real.length_m ?? preset.real.thickness_m!, omega = preset.real.omega_rad_s!
    const units = createUnitsContext(preset.sim.scale), dt = 1 / 72
    const failures: unknown[] = []
    for (const azimuth of [0, .12, .3, Math.PI / 2, 2.1, Math.PI, -2.3, -.12]) {
      for (const axialPosition of [0, length * .25]) {
        const world = new rapier.World({ x: 0, y: 0, z: 0 })
        applyWorldLengthUnit(world, units)
        const wall = createRotatingCylinderBody(rapier, world, { radius, length, units })
        wall.setAngularVelocity(omega)
        const state = createPlayerTraversalState({ azimuth, axialPosition }, radius, 0, omega, { rapier, world, units })
        world.timestep = dt
        let minGap = Infinity, maxGap = -Infinity, contacts = 0
        try {
          for (let frame = 1; frame <= 216; frame++) {
            const frameAngle = frame * omega * dt
            stepGroundedPlayer(state, { radius, length, omega, frameAngleEnd: frameAngle, deltaSeconds: dt, axisDistanceDelta: 0, tangentDistanceDelta: 0 })
            world.step()
            syncGroundedSurfaceFromPhysics(state, frameAngle)
            if (frame > 72) {
              const gap = radius - Math.hypot(state.inertialPosition.x, state.inertialPosition.z)
              minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap)
              world.contactPairsWith(state.physics!.freeFlyBody.collider(0), other => {
                world.contactPair(state.physics!.freeFlyBody.collider(0), other, manifold => { contacts += manifold.numSolverContacts() })
              })
            }
          }
          if (minGap < .04 || maxGap > .8 || contacts < 1 || state.mode !== 'grounded') failures.push({ azimuth, axialPosition, minGap, maxGap, contacts, mode: state.mode })
        } finally {
          wall.dispose(); disposePlayerTraversalState(state); world.free()
        }
      }
    }
    if (failures.length) console.log(preset.id, failures)
    expect(failures).toEqual([])
  })
}
