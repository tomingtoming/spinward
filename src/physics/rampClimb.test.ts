import { expect, test } from 'bun:test'

import { initRapier } from './rapierContext'
import { createRotatingCylinderBody } from './rotatingCylinder'
import { applyWorldLengthUnit } from './rapierBoundary'
import { DriveRuntime } from '../app/driveRuntime'
import { getCityExpressway, getExpresswayElevation } from '../objects/cityLayout'
import { createUnitsContext, periodToOmega } from '../units/units'

// End-to-end proof that the CAR can actually drive up the expressway ramp on
// real Rapier contact — the exact scenario reported broken from the headset:
// "the car cannot get onto the ramp". Runs the true DriveRuntime + vehicle
// model against the true wall/deck/tread colliders at Izma scale.
const IZMA_RADIUS = 3200
const IZMA_LENGTH = 40000
const IZMA_OMEGA = periodToOmega(113.5)
const IZMA_SIM_SCALE = 0.02

test(
  'the car drives from the street up the ramp to the deck',
  async () => {
    const rapier = await initRapier()
    const world = new rapier.World({ x: 0, y: 0, z: 0 })
    const units = createUnitsContext(IZMA_SIM_SCALE)
    applyWorldLengthUnit(world, IZMA_SIM_SCALE)

    const expressway = getCityExpressway(IZMA_RADIUS)
    if (expressway === null) throw new Error('expected an expressway at Izma scale')

    const wall = createRotatingCylinderBody(rapier, world, {
      radius: IZMA_RADIUS,
      length: IZMA_LENGTH,
      units,
      expressway
    })
    wall.setAngularVelocity(IZMA_OMEGA)

    const drive = new DriveRuntime()
    drive.rebuild({ rapier, world, units })

    const ramp = expressway.ramps[0]
    const laneAxial =
      expressway.axial + expressway.deckWidth * 0.5 + expressway.rampWidth * 0.5
    // Park 30 m short of the ramp mouth, aimed up the lane (+tangent).
    drive.parkAt(ramp.azimuthStart - 30 / IZMA_RADIUS, laneAxial, Math.PI / 2)

    let frameAngle = 0
    drive.enter(frameAngle, IZMA_OMEGA, IZMA_RADIUS, { rapier, world, units })

    const surfaceElevation = (azimuth: number, axial: number) =>
      getExpresswayElevation(expressway, IZMA_RADIUS, azimuth, axial)

    const deltaSeconds = 1 / 60
    let maxElevation = -1
    let lastElevation = -1
    const trace: string[] = []

    for (let step = 0; step < 60 * 90; step += 1) {
      frameAngle += IZMA_OMEGA * deltaSeconds
      drive.preStep(
        { throttle: 1, steer: 0, brake: 0 },
        {
          deltaSeconds,
          frameAngle,
          omega: IZMA_OMEGA,
          radius: IZMA_RADIUS,
          units,
          surfaceElevation
        }
      )
      world.timestep = deltaSeconds
      world.step()
      drive.postStep({ frameAngle, units })

      const elevation = drive.lastRadialGap - 0.5
      maxElevation = Math.max(maxElevation, elevation)
      lastElevation = elevation

      if (step % 300 === 299) {
        trace.push(
          `t=${((step + 1) * deltaSeconds).toFixed(0)}s elev=${elevation.toFixed(2)} speed=${drive.lastSpeed.toFixed(1)} grounded=${drive.lastGrounded} axial=${drive.surface.axialPosition.toFixed(1)}`
        )
      }
    }

    // Reaching (near) deck height proves mouth, treads and grade all work.
    if (maxElevation < expressway.deckHeight - 2) {
      console.log(trace.join('\n'))
    }
    expect(maxElevation).toBeGreaterThan(expressway.deckHeight - 2)
    // And it should still be up there, not have fallen off the side.
    expect(lastElevation).toBeGreaterThan(5)

    drive.dispose()
    wall.dispose()
  },
  30000
)
