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

    const expressway = getCityExpressway(IZMA_RADIUS, IZMA_LENGTH)
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

    // Drive like a person, not a cannonball: hold ~15 m/s. The first version
    // of this test ran open throttle, hit the ramp at 67 m/s and LAUNCHED
    // over the deck — the height assertion passed mid-air and proved nothing
    // about a controlled climb.
    const targetSpeed = 15
    const deltaSeconds = 1 / 60
    let maxGroundedElevation = -1
    let airborneSeconds = 0
    const trace: string[] = []

    for (let step = 0; step < 60 * 60; step += 1) {
      frameAngle += IZMA_OMEGA * deltaSeconds
      drive.preStep(
        { throttle: drive.lastSpeed < targetSpeed ? 1 : 0, steer: 0, brake: 0 },
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

      if (drive.lastGrounded) {
        maxGroundedElevation = Math.max(maxGroundedElevation, elevation)
      } else if (elevation > 1) {
        airborneSeconds += deltaSeconds
      }

      if (step % 120 === 119) {
        trace.push(
          `t=${((step + 1) * deltaSeconds).toFixed(0)}s elev=${elevation.toFixed(2)} speed=${drive.lastSpeed.toFixed(1)} grounded=${drive.lastGrounded} axial=${drive.surface.axialPosition.toFixed(1)}`
        )
      }
    }

    if (
      maxGroundedElevation <= expressway.deckHeight - 1.5 ||
      Math.abs(drive.surface.axialPosition - expressway.axial) >=
        expressway.deckWidth * 0.5 + 0.5
    ) {
      console.log(trace.join('\n'))
    }

    // A CONTROLLED climb: reach deck height IN CONTACT, not by being flung.
    expect(maxGroundedElevation).toBeGreaterThan(expressway.deckHeight - 1.5)
    // And without meaningful airtime above the ramp.
    expect(airborneSeconds).toBeLessThan(3)
    // The full hold-the-throttle user story: after the collector's funnel
    // barrier, the car must be cruising ON the main deck band, grounded.
    expect(drive.lastGrounded).toBe(true)
    expect(drive.lastRadialGap - 0.5).toBeGreaterThan(expressway.deckHeight - 1.5)
    expect(
      Math.abs(drive.surface.axialPosition - expressway.axial)
    ).toBeLessThan(expressway.deckWidth * 0.5 + 0.5)

    drive.dispose()
    wall.dispose()
  },
  30000
)
