import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  confinePlayerToCityBuildings,
  confinePlayerToHabitatInterior,
  detachPlayerToFreeFly,
  DEFAULT_REATTACH_TUNING,
  applyPlayerTraversalState,
  createPlayerTraversalState,
  disposePlayerTraversalState,
  evaluateReattachPlayer,
  getPlayerBodyRadius,
  getPlayerTraversalRegion,
  resetPlayerToFreeFly,
  resetPlayerToGrounded,
  syncGroundedSurfaceFromPhysics,
  syncPlayerTraversalFromPhysics,
  tryReattachPlayer,
  stepGroundedPlayer,
  stepFreeFlyPlayer,
  updatePlayerGroundContact
} from './playerTraversal'
import {
  buildCityCollisionIndex,
  getCityGroundHeight,
  type CityBuilding
} from '../objects/cityLayout'
import { respawnExterior } from '../gameplay/respawn'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { Accelerometer } from '../sim/accelerometer'
import {
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from '../sim/frameTransforms'
import { createUnitsContext } from '../units/units'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.z).toBeCloseTo(expected.z, 5)
}

test('stepGroundedPlayer transitions to free-fly after crossing the opening', () => {
  const state = createPlayerTraversalState({ axialPosition: 8.4, azimuth: 0 }, 10, 0, 1.2)
  const expectedVelocity = new THREE.Vector3(0, 2, -10 * 1.2).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    0.6
  )

  stepGroundedPlayer(state, {
    axisDistanceDelta: 1,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1.2,
    frameAngleEnd: 0.6
  })

  expect(state.mode).toBe('free-fly')
  expect(state.surface.axialPosition).toBeCloseTo(9.4, 6)
  expectVectorCloseTo(state.inertialVelocity, expectedVelocity)
})

test('grounded traversal seeds free-fly with the visible wall transport speed', () => {
  const radius = 3200
  const omega = 0.05535
  const frameAngleEnd = 0.45
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, 0, omega)
  const expectedVelocity = new THREE.Vector3(0, 0, -radius * omega).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    frameAngleEnd
  )

  stepGroundedPlayer(state, {
    axisDistanceDelta: 0,
    tangentDistanceDelta: 0,
    radius,
    length: 40000,
    deltaSeconds: 0.5,
    omega,
    frameAngleEnd
  })
  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(0, 0, 0),
    radius,
    omega,
    frameAngle: frameAngleEnd
  })

  expect(state.mode).toBe('free-fly')
  expectVectorCloseTo(state.inertialVelocity, expectedVelocity)
})

test('stepGroundedPlayer keeps the player grounded while still inside the cylinder', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 1)

  stepGroundedPlayer(state, {
    axisDistanceDelta: 2,
    tangentDistanceDelta: 5,
    radius: 10,
    length: 20,
    deltaSeconds: 1,
    omega: 1,
    frameAngleEnd: 1
  })

  expect(state.mode).toBe('grounded')
  expect(state.surface.axialPosition).toBeCloseTo(2, 6)
  expect(state.surface.azimuth).toBeCloseTo(0.5, 6)
})

test('detachPlayerToFreeFly switches mode and adds launch velocity in the rotating frame', () => {
  const frameAngle = 0.6
  const omega = 1.1
  const state = createPlayerTraversalState({ axialPosition: 2, azimuth: 0 }, 10, frameAngle, omega)
  const previousVelocity = state.inertialVelocity.clone()

  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(0, 1.5, -4),
    radius: 10,
    omega,
    frameAngle
  })

  expect(state.mode).toBe('free-fly')
  expectVectorCloseTo(
    state.inertialVelocity,
    previousVelocity.add(new THREE.Vector3(0, 1.5, -4).applyAxisAngle(new THREE.Vector3(0, 1, 0), frameAngle))
  )
})

test('detachPlayerToFreeFly refreshes wall transport speed at the current frame angle', () => {
  const radius = 3200
  const omega = 0.05535
  const frameAngle = 1.1
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, 0, omega)
  const expectedVelocity = new THREE.Vector3(0, 0, -radius * omega).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    frameAngle
  )

  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(0, 0, 0),
    radius,
    omega,
    frameAngle
  })

  expect(state.mode).toBe('free-fly')
  expectVectorCloseTo(state.inertialVelocity, expectedVelocity)
})

test('stepFreeFlyPlayer advances inertial motion and leaves orientation alone', () => {
  const state = createPlayerTraversalState({ axialPosition: 9.2, azimuth: 0 }, 10, 0, 1)
  const rig = new THREE.Group()

  stepGroundedPlayer(state, {
    axisDistanceDelta: 1,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1,
    frameAngleEnd: 0.5
  })

  const previousVelocity = state.inertialVelocity.clone()

  stepFreeFlyPlayer(state, {
    thrustAcceleration: new THREE.Vector3(0, 0, 0),
    deltaSeconds: 0.5,
    frameAngleStart: 0.5,
    frameAngleEnd: 1,
    omega: 1,
    linearDamping: 0,
    brakeAmount: 0,
    brakeDamping: 6
  })
  applyPlayerTraversalState(rig, state, 10, 1)

  expect(state.mode).toBe('free-fly')
  expectVectorCloseTo(state.inertialVelocity, previousVelocity)
  expect(rig.position.x).toBeGreaterThan(10.5)
  expect(rig.position.y).toBeGreaterThan(11)
  expect(Math.abs(rig.position.z)).toBeLessThan(1)
})

test('stepFreeFlyPlayer coasts ballistically far from the axis — no forced co-rotation', () => {
  // Regression: a rotating-frame max-speed clamp used to live in stepFreeFlyPlayer.
  // Far from the spin axis the transport speed (omega*r) alone exceeded the cap,
  // so it rewrote the inertial velocity toward co-rotation every frame — a phantom
  // acceleration that the felt-g accelerometer (correctly) reported. A coasting
  // free-flyer must feel nothing: its inertial velocity is left exactly alone.
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 2)
  state.mode = 'free-fly'
  state.inertialPosition.set(60, 0, 0) // omega*r = 120, way past any old cap
  state.inertialVelocity.set(0.4, -0.2, 0.3)
  const before = state.inertialVelocity.clone()

  stepFreeFlyPlayer(state, {
    thrustAcceleration: new THREE.Vector3(0, 0, 0),
    deltaSeconds: 0.5,
    frameAngleStart: 0.3,
    frameAngleEnd: 0.9,
    omega: 2,
    linearDamping: 0,
    brakeAmount: 0,
    brakeDamping: 6
  })

  expectVectorCloseTo(state.inertialVelocity, before)
})

test('getPlayerTraversalRegion reports outside for a free-flying player beyond the opening', () => {
  const state = createPlayerTraversalState({ axialPosition: 9.6, azimuth: 0 }, 10, 0, 1)

  stepGroundedPlayer(state, {
    axisDistanceDelta: 0.5,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1,
    frameAngleEnd: 0.5
  })

  expect(getPlayerTraversalRegion(state, 10, 20, 0.5)).toBe('outside')
})

test('getPlayerTraversalRegion reports outside for the exterior vantage (radially clear, axially within)', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 1)
  // Radially 1.6 R outside the hull but well within the ends — the Exterior
  // spawn's geometry. An axial-only region test used to call this 'inside',
  // and everything keyed on the region (vacuum audio, rain gate) misfired.
  resetPlayerToFreeFly(state, {
    rotatingPosition: new THREE.Vector3(16, -6, 0),
    frameAngle: 0.5,
    omega: 1
  })

  expect(getPlayerTraversalRegion(state, 10, 20, 0.5)).toBe('outside')
})

test('physical walking drives the live body velocity toward the intent', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const state = createPlayerTraversalState(
    { axialPosition: 2, azimuth: 0 },
    10,
    0,
    1.2,
    { rapier, world }
  )

  stepGroundedPlayer(state, {
    axisDistanceDelta: 1,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1.2,
    frameAngleEnd: 0.6
  })

  expect(state.mode).toBe('grounded')

  const rotatingVelocity = inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    1.2,
    0.6,
    new THREE.Vector3()
  )

  // Desired axial walk speed = 1m / 0.5s; full traction at this g.
  expect(rotatingVelocity.y).toBeCloseTo(2, 5)

  disposePlayerTraversalState(state)
  world.free()
})

test('physical walking holds co-rotation on the spinning wall at izma scale', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(0.02)
  applyWorldLengthUnit(world, units)
  const radius = 3200
  const length = 32000
  const omega = (Math.PI * 2) / 113.5
  const cylinder = createRotatingCylinderBody(rapier, world, { radius, length, units })
  cylinder.setAngularVelocity(omega)

  let frameAngle = 0
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    frameAngle,
    omega,
    { rapier, world, units }
  )

  // 4 simulated seconds of standing still. The historical failure mode:
  // wall contact read as static (kinematic body com displaced by partially
  // enabled panels), friction bled ~13 m/s of co-rotation and the player
  // drifted onto an inward epicycle within two seconds.
  const deltaSeconds = 1 / 72
  for (let index = 0; index < 288; index += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(
      frameAngle + omega * deltaSeconds,
      Math.PI * 2
    )
    stepGroundedPlayer(state, {
      axisDistanceDelta: 0,
      tangentDistanceDelta: 0,
      radius,
      length,
      deltaSeconds,
      omega,
      frameAngleEnd: frameAngle
    })
    world.timestep = deltaSeconds
    world.step()
  }

  expect(state.mode).toBe('grounded')

  const rotatingVelocity = inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    omega,
    frameAngle,
    new THREE.Vector3()
  )
  const radialDistance = Math.hypot(state.inertialPosition.x, state.inertialPosition.z)

  // Still co-rotating (rotating-frame speed ~ 0) and resting on the surface.
  expect(rotatingVelocity.length()).toBeLessThan(0.5)
  expect(radius - radialDistance).toBeGreaterThan(0.2)
  expect(radius - radialDistance).toBeLessThan(0.8)

  cylinder.dispose()
  disposePlayerTraversalState(state)
  world.free()
})

test('grounded walking feels a measured ~1g from the spinning wall contact', async () => {
  // P2: on the open floor the radial axis is Rapier's wall contact, not an
  // analytic ground-follow. So the felt gravity is differenced from the
  // velocity Rapier integrates against the real normal force — emergent, not
  // omega^2 R fed back in. Remove the wall and this body would fly off at 0 g.
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(0.02)
  applyWorldLengthUnit(world, units)
  const radius = 3200
  const length = 32000
  const omega = (Math.PI * 2) / 113.5
  const expectedG = omega * omega * radius
  const cylinder = createRotatingCylinderBody(rapier, world, { radius, length, units })
  cylinder.setAngularVelocity(omega)

  let frameAngle = 0
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    frameAngle,
    omega,
    { rapier, world, units }
  )
  const accelerometer = new Accelerometer()
  const deltaSeconds = 1 / 72
  let feltGravity = 0

  for (let index = 0; index < 216; index += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(
      frameAngle + omega * deltaSeconds,
      Math.PI * 2
    )
    stepGroundedPlayer(state, {
      axisDistanceDelta: 0,
      tangentDistanceDelta: 0,
      radius,
      length,
      deltaSeconds,
      omega,
      frameAngleEnd: frameAngle
    })
    world.timestep = deltaSeconds
    world.step()
    syncGroundedSurfaceFromPhysics(state, frameAngle)
    feltGravity = accelerometer.sample(state.inertialVelocity, state.inertialPosition, deltaSeconds)
  }

  expect(state.mode).toBe('grounded')
  // Resting on the wall via contact (not free-flying outward, which the
  // one-sided grounded check would not catch): the body sits just inside the
  // inner face, and the felt weight is the real ~1g normal force.
  const restingGap = radius - Math.hypot(state.inertialPosition.x, state.inertialPosition.z)
  expect(restingGap).toBeGreaterThan(0.1)
  expect(restingGap).toBeLessThan(0.8)
  expect(feltGravity).toBeGreaterThan(0.85 * expectedG)
  expect(feltGravity).toBeLessThan(1.15 * expectedG)

  cylinder.dispose()
  disposePlayerTraversalState(state)
  world.free()
})

test('jumping mid-run keeps the walking momentum', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const state = createPlayerTraversalState(
    { axialPosition: 2, azimuth: 0 },
    10,
    0,
    1.2,
    { rapier, world }
  )

  // Build up an axial run (2 m/s after this step, per the walking test).
  stepGroundedPlayer(state, {
    axisDistanceDelta: 1,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1.2,
    frameAngleEnd: 0.6
  })

  // Jump straight "up" (radially inward at azimuth ~0).
  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(-3, 0, 0),
    radius: 10,
    omega: 1.2,
    frameAngle: 0.6
  })

  expect(state.mode).toBe('free-fly')

  const rotatingVelocity = inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    1.2,
    0.6,
    new THREE.Vector3()
  )

  // The run survives the jump; the launch impulse rides on top of it.
  expect(rotatingVelocity.y).toBeCloseTo(2, 5)
  expect(rotatingVelocity.x).toBeLessThan(-2)

  disposePlayerTraversalState(state)
  world.free()
})

test('a free-fly drop lands on a rooftop and grounds at its height', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const radius = 30
  const length = 60
  const omega = 0.7
  const building: CityBuilding = {
    azimuth: 0,
    axial: 0,
    width: 8,
    depth: 8,
    height: 6,
    tone: 0.5,
    kind: 'block'
  }
  const sample = (azimuth: number, axialPosition: number, altitude: number) =>
    getCityGroundHeight([building], radius, azimuth, axialPosition, altitude)
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    omega,
    { rapier, world }
  )

  // Co-rotating, 4m above the roof: spin gravity pulls it down onto it.
  resetPlayerToFreeFly(state, {
    rotatingPosition: new THREE.Vector3(radius - building.height - 4, 0, 0),
    frameAngle: 0,
    omega
  })

  const deltaSeconds = 1 / 72
  let frameAngle = 0
  let landed = false

  for (let index = 0; index < 720 && !landed; index += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(
      frameAngle + omega * deltaSeconds,
      Math.PI * 2
    )
    world.timestep = deltaSeconds
    world.step()
    syncPlayerTraversalFromPhysics(state)
    confinePlayerToCityBuildings(state, {
      buildings: [building],
      radius,
      frameAngle,
      omega
    })
    landed = updatePlayerGroundContact(state, {
      radius,
      length,
      frameAngle,
      omega,
      sampleGroundHeight: sample
    })
  }

  expect(landed).toBe(true)
  expect(state.mode).toBe('grounded')
  expect(state.groundHeight).toBeCloseTo(building.height, 5)

  const rotating = inertialPositionToRotating(
    state.inertialPosition,
    frameAngle,
    new THREE.Vector3()
  )
  // Resting just above the roof plane, well inside the cylinder floor.
  expect(Math.hypot(rotating.x, rotating.z)).toBeLessThan(radius - building.height)

  disposePlayerTraversalState(state)
  world.free()
})

test('updatePlayerGroundContact never lands a player floating outside the hull', async () => {
  // Regression: the reattach check only ever bounded radialDistance from
  // below (too far from the wall toward the axis), assuming free-fly always
  // stayed inside the hull. The exterior vantage sits at radius * 1.6 —
  // outside it — and once it stopped cancelling the spin to hang at rest
  // (zero rotating velocity, like every other respawn), that zero velocity
  // satisfied the speed gates here and "landed" the player from outer space.
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const radius = 18
  const length = 120
  const omega = 0.5
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    omega,
    { rapier, world }
  )

  respawnExterior(state, {
    type: 'cylinder',
    radius,
    length,
    frameAngle: 0,
    omega
  })

  const landed = updatePlayerGroundContact(state, {
    radius,
    length,
    frameAngle: 0,
    omega
  })

  expect(landed).toBe(false)
  expect(state.mode).toBe('free-fly')

  disposePlayerTraversalState(state)
  world.free()
})

test('walking off a roof edge releases to free-fall', async () => {
  // The walker rests on the real streamed roof collider (P1) — not an analytic
  // follow — and walks off its edge; past the footprint the sampled ground
  // drops to the street and the grounded check releases to free-fall.
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(1)
  applyWorldLengthUnit(world, units)
  const radius = 30
  const length = 60
  const omega = 0.7
  const building: CityBuilding = {
    azimuth: 0,
    axial: 0,
    width: 12,
    depth: 12,
    height: 6,
    tone: 0.5,
    kind: 'block'
  }
  const index = buildCityCollisionIndex([building], radius, length)
  const city = createRotatingCityColliders(rapier, world, { radius, index, units, omega, margin: 0.25 })
  const sample = (azimuth: number, axialPosition: number, altitude: number) =>
    getCityGroundHeight([building], radius, azimuth, axialPosition, altitude)
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    omega,
    { rapier, world, units }
  )

  resetPlayerToGrounded(state, {
    axialPosition: 0,
    azimuth: 0,
    radius,
    frameAngle: 0,
    omega,
    groundHeight: building.height
  })

  const deltaSeconds = 1 / 72
  let frameAngle = 0

  for (let index = 0; index < 360 && state.mode === 'grounded'; index += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(
      frameAngle + omega * deltaSeconds,
      Math.PI * 2
    )
    stepGroundedPlayer(state, {
      axisDistanceDelta: 6 * deltaSeconds,
      tangentDistanceDelta: 0,
      radius,
      length,
      deltaSeconds,
      omega,
      frameAngleEnd: frameAngle,
      sampleGroundHeight: sample
    })
    city.update(state.surface.azimuth, state.surface.axialPosition)
    world.timestep = deltaSeconds
    world.step()
    syncPlayerTraversalFromPhysics(state)
    syncGroundedSurfaceFromPhysics(state, frameAngle)
  }

  expect(state.mode).toBe('free-fly')
  expect(Math.abs(state.surface.axialPosition)).toBeGreaterThan(building.depth * 0.5)

  city.dispose()
  disposePlayerTraversalState(state)
  world.free()
})

test('physical walking releases to free-fly past the opening', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const state = createPlayerTraversalState(
    { axialPosition: 9.6, azimuth: 0 },
    10,
    0,
    1.2,
    { rapier, world }
  )

  stepGroundedPlayer(state, {
    axisDistanceDelta: 0,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1.2,
    frameAngleEnd: 0
  })

  expect(state.mode).toBe('free-fly')

  disposePlayerTraversalState(state)
  world.free()
})

test('detachPlayerToFreeFly seeds the Rapier body slightly inside the wall for large presets', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(0.02)
  const radius = 3200
  const length = 40000
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    0.05535,
    { rapier, world, units }
  )
  const cylinder = createRotatingCylinderBody(rapier, world, {
    radius,
    length,
    units
  })

  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(0, 0, 0),
    radius,
    omega: 0.05535,
    frameAngle: 0
  })
  cylinder.syncToFrame(0)
  world.timestep = 1 / 60
  world.step()
  syncPlayerTraversalFromPhysics(state)

  const rotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    0,
    new THREE.Vector3()
  )

  expect(Math.hypot(rotatingPosition.x, rotatingPosition.z)).toBeCloseTo(
    getPlayerBodyRadius(radius),
    2
  )
  expect(rotatingPosition.x).toBeLessThan(radius)

  cylinder.dispose()
  disposePlayerTraversalState(state)
  world.free()
})

test('confinePlayerToHabitatInterior keeps a free-fly player inside the cylinder wall', () => {
  const radius = 3200
  const frameAngle = 0.4
  const omega = 0.05535
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, frameAngle, omega)
  const outsideRotatingPosition = new THREE.Vector3(radius + 3, 0, 0)
  const outwardRotatingVelocity = new THREE.Vector3(2, 0, 0.2)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(outsideRotatingPosition, frameAngle))
  state.inertialVelocity.copy(
    rotatingVelocityToInertial(
      outsideRotatingPosition,
      outwardRotatingVelocity,
      omega,
      frameAngle
    )
  )

  const collided = confinePlayerToHabitatInterior(state, {
    radius,
    length: 40000,
    omega,
    frameAngle
  })
  const correctedRotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    frameAngle,
    new THREE.Vector3()
  )

  expect(collided).toBe(true)
  expect(Math.hypot(correctedRotatingPosition.x, correctedRotatingPosition.z)).toBeLessThanOrEqual(
    getPlayerBodyRadius(radius) + 1e-4
  )
})

test('stepFreeFlyPlayer applies thrust through Rapier and syncs it back to the state', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const state = createPlayerTraversalState(
    { axialPosition: 8.4, azimuth: 0 },
    10,
    0,
    1,
    { rapier, world }
  )

  detachPlayerToFreeFly(state, {
    launchVelocity: new THREE.Vector3(0, 0, 0),
    radius: 10,
    omega: 1,
    frameAngle: 0.5
  })

  const previousVelocity = state.inertialVelocity.clone()
  const inertialAcceleration = rotatingPositionToInertial(new THREE.Vector3(0, 0, 2), 0.5)
  const expectedVelocity = previousVelocity.clone().addScaledVector(inertialAcceleration, 0.5)

  stepFreeFlyPlayer(state, {
    thrustAcceleration: new THREE.Vector3(0, 0, 2),
    deltaSeconds: 0.5,
    frameAngleStart: 0.5,
    frameAngleEnd: 1,
    omega: 1,
    linearDamping: 0,
    brakeAmount: 0,
    brakeDamping: 6
  })
  world.timestep = 0.5
  world.step()
  syncPlayerTraversalFromPhysics(state)

  expectVectorCloseTo(state.inertialVelocity, expectedVelocity)

  disposePlayerTraversalState(state)
  world.free()
})

test('stepFreeFlyPlayer keeps the same real-space result across sim scales', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const buildState = (world: InstanceType<typeof rapier.World>, simScale: number) =>
    createPlayerTraversalState(
      { axialPosition: 8.4, azimuth: 0 },
      10,
      0,
      1,
      { rapier, world, units: createUnitsContext(simScale) }
    )

  const izmaState = buildState(izmaWorld, 0.02)
  const elysiumState = buildState(elysiumWorld, 0.005)

  for (const state of [izmaState, elysiumState]) {
    stepGroundedPlayer(state, {
      axisDistanceDelta: 1,
      tangentDistanceDelta: 0,
      radius: 10,
      length: 20,
      deltaSeconds: 0.5,
      omega: 1,
      frameAngleEnd: 0.5
    })
    stepFreeFlyPlayer(state, {
      thrustAcceleration: new THREE.Vector3(0, 0, 2),
      deltaSeconds: 0.5,
      frameAngleStart: 0.5,
      frameAngleEnd: 1,
      omega: 1,
      linearDamping: 0,
      brakeAmount: 0,
      brakeDamping: 6
    })
  }

  izmaWorld.timestep = 0.5
  elysiumWorld.timestep = 0.5
  izmaWorld.step()
  elysiumWorld.step()
  syncPlayerTraversalFromPhysics(izmaState)
  syncPlayerTraversalFromPhysics(elysiumState)

  expectVectorCloseTo(izmaState.inertialPosition, elysiumState.inertialPosition)
  expectVectorCloseTo(izmaState.inertialVelocity, elysiumState.inertialVelocity)

  disposePlayerTraversalState(izmaState)
  disposePlayerTraversalState(elysiumState)
  izmaWorld.free()
  elysiumWorld.free()
})

test('stepFreeFlyPlayer brake strongly reduces free-fly inertial speed', () => {
  const state = createPlayerTraversalState({ axialPosition: 8.4, azimuth: 0 }, 10, 0, 1)

  stepGroundedPlayer(state, {
    axisDistanceDelta: 1,
    tangentDistanceDelta: 0,
    radius: 10,
    length: 20,
    deltaSeconds: 0.5,
    omega: 1,
    frameAngleEnd: 0.5
  })

  state.inertialVelocity.set(6, -2, 3)

  stepFreeFlyPlayer(state, {
    thrustAcceleration: new THREE.Vector3(0, 0, 0),
    deltaSeconds: 0.5,
    frameAngleStart: 0.5,
    frameAngleEnd: 1,
    omega: 1,
    linearDamping: 0,
    brakeAmount: 1,
    brakeDamping: 6
  })

  expect(state.inertialVelocity.length()).toBeLessThan(1)
})

test('tryReattachPlayer returns to grounded mode on a low-speed wall contact', () => {
  const radius = 10
  const length = 20
  const frameAngle = 0.4
  const omega = 1.1
  const bodyRadius = getPlayerBodyRadius(radius)
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, frameAngle, omega)
  const rotatingPosition = new THREE.Vector3(bodyRadius, 1.4, 0)
  const rotatingVelocity = new THREE.Vector3(0.15, 0.05, -0.1)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(rotatingPosition, frameAngle))
  state.inertialVelocity.copy(
    rotatingVelocityToInertial(rotatingPosition, rotatingVelocity, omega, frameAngle)
  )

  const grounded = tryReattachPlayer(state, {
    ...DEFAULT_REATTACH_TUNING,
    radius,
    length,
    omega,
    frameAngle
  })

  expect(grounded).toBe(true)
  expect(state.mode).toBe('grounded')
  expect(state.surface.axialPosition).toBeCloseTo(1.4, 6)
  expect(state.surface.azimuth).toBeCloseTo(0, 6)
})

test('evaluateReattachPlayer exposes readiness metrics for low-speed wall contact', () => {
  const radius = 10
  const length = 20
  const frameAngle = 0.4
  const omega = 1.1
  const bodyRadius = getPlayerBodyRadius(radius)
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, frameAngle, omega)
  const rotatingPosition = new THREE.Vector3(bodyRadius, 1.4, 0)
  const rotatingVelocity = new THREE.Vector3(0.15, 0.05, -0.1)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(rotatingPosition, frameAngle))
  state.inertialVelocity.copy(
    rotatingVelocityToInertial(rotatingPosition, rotatingVelocity, omega, frameAngle)
  )

  const status = evaluateReattachPlayer(state, {
    ...DEFAULT_REATTACH_TUNING,
    radius,
    length,
    omega,
    frameAngle
  })

  expect(status.withinAxialWindow).toBe(true)
  expect(status.radialError).toBeLessThan(DEFAULT_REATTACH_TUNING.radialTolerance)
  expect(status.normalSpeed).toBeLessThan(DEFAULT_REATTACH_TUNING.maxNormalSpeed)
  expect(status.surfaceSpeed).toBeLessThan(DEFAULT_REATTACH_TUNING.maxSurfaceSpeed)
  expect(status.canAttach).toBe(true)
})

test('tryReattachPlayer stays in free-fly when wall-relative speed is too high', () => {
  const radius = 10
  const length = 20
  const frameAngle = 0.4
  const omega = 1.1
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, radius, frameAngle, omega)
  const rotatingPosition = new THREE.Vector3(radius - 0.2, 1.4, 0)
  const rotatingVelocity = new THREE.Vector3(0.1, 0.05, -2.8)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(rotatingPosition, frameAngle))
  state.inertialVelocity.copy(
    rotatingVelocityToInertial(rotatingPosition, rotatingVelocity, omega, frameAngle)
  )

  const grounded = tryReattachPlayer(state, {
    ...DEFAULT_REATTACH_TUNING,
    radius,
    length,
    omega,
    frameAngle
  })

  expect(grounded).toBe(false)
  expect(state.mode).toBe('free-fly')
})

test('a streamed building collider blocks the walker (P1), no analytic pushout', async () => {
  // Walk a grounded player straight at a building and compare with an empty
  // city: the streamed collider must stop the walker at the building face while
  // an empty city lets the same walk carry far past it.
  const walkAtBuilding = async (withBuilding: boolean) => {
    const rapier = await initRapier()
    const world = new rapier.World({ x: 0, y: 0, z: 0 })
    const units = createUnitsContext(0.02)
    applyWorldLengthUnit(world, units)
    const radius = 3200
    const length = 40000
    const omega = (Math.PI * 2) / 113.5
    const wall = createRotatingCylinderBody(rapier, world, { radius, length, units })
    wall.setAngularVelocity(omega)

    const buildings: CityBuilding[] = withBuilding
      ? [{ azimuth: 0.005, axial: 0, width: 14, depth: 60, height: 30, tone: 0.5, kind: 'block' }]
      : []
    const index = buildCityCollisionIndex(buildings, radius, length)
    const city = createRotatingCityColliders(rapier, world, {
      radius,
      index,
      units,
      omega,
      margin: 0.25
    })

    let frameAngle = 0
    const state = createPlayerTraversalState(
      { axialPosition: 0, azimuth: 0 },
      radius,
      frameAngle,
      omega,
      { rapier, world, units }
    )
    const deltaSeconds = 1 / 72

    for (let i = 0; i < Math.round(5 / deltaSeconds); i += 1) {
      frameAngle = THREE.MathUtils.euclideanModulo(
        frameAngle + omega * deltaSeconds,
        Math.PI * 2
      )
      stepGroundedPlayer(state, {
        axisDistanceDelta: 0,
        tangentDistanceDelta: 6 * deltaSeconds, // walk +tangent toward the building
        radius,
        length,
        deltaSeconds,
        omega,
        frameAngleEnd: frameAngle
      })
      city.update(state.surface.azimuth, state.surface.axialPosition)
      world.timestep = deltaSeconds
      world.step()
      syncPlayerTraversalFromPhysics(state)
      syncGroundedSurfaceFromPhysics(state, frameAngle)
    }

    const tangential = state.surface.azimuth * radius
    const mode = state.mode
    city.dispose()
    wall.dispose()
    disposePlayerTraversalState(state)
    world.free()
    return { tangential, mode }
  }

  const blocked = await walkAtBuilding(true)
  const free = await walkAtBuilding(false)

  // Near face ~ 0.005*3200 - (14/2 + 0.25 margin) = 8.75 m: the walker reaches
  // it (not stalled at the start) and stops there, staying grounded, while an
  // empty city lets the same walk carry well past it.
  expect(blocked.mode).toBe('grounded')
  expect(blocked.tangential).toBeGreaterThan(6)
  expect(blocked.tangential).toBeLessThan(12)
  expect(free.tangential).toBeGreaterThan(20)
})

test('a free-fly drop lands on a real building roof collider (P1, no analytic)', async () => {
  // App-faithful: the deleted confinePlayerToCityBuildings is NOT used; the
  // streamed roof collider must catch the falling body and updatePlayerGroundContact
  // must ground it at the roof height.
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(1)
  applyWorldLengthUnit(world, units)
  const radius = 30
  const length = 60
  const omega = 0.7
  const building: CityBuilding = {
    azimuth: 0,
    axial: 0,
    width: 12,
    depth: 12,
    height: 6,
    tone: 0.5,
    kind: 'block'
  }
  const index = buildCityCollisionIndex([building], radius, length)
  const city = createRotatingCityColliders(rapier, world, { radius, index, units, omega, margin: 0.25 })
  const sample = (azimuth: number, axialPosition: number, altitude: number) =>
    getCityGroundHeight([building], radius, azimuth, axialPosition, altitude)
  const state = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    omega,
    { rapier, world, units }
  )

  // Co-rotating, a few metres above the roof: spin gravity pulls it onto the
  // real roof collider.
  resetPlayerToFreeFly(state, {
    rotatingPosition: new THREE.Vector3(radius - building.height - 3, 0, 0),
    frameAngle: 0,
    omega
  })

  const deltaSeconds = 1 / 72
  let frameAngle = 0
  let landed = false

  for (let i = 0; i < 1200 && !landed; i += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + omega * deltaSeconds, Math.PI * 2)
    const rotating = inertialPositionToRotating(state.inertialPosition, frameAngle, new THREE.Vector3())
    city.update(Math.atan2(rotating.z, rotating.x), rotating.y)
    world.timestep = deltaSeconds
    world.step()
    syncPlayerTraversalFromPhysics(state)
    landed = updatePlayerGroundContact(state, {
      radius,
      length,
      frameAngle,
      omega,
      sampleGroundHeight: sample
    })
  }

  expect(landed).toBe(true)
  expect(state.mode).toBe('grounded')
  expect(state.groundHeight).toBeCloseTo(building.height, 5)

  city.dispose()
  disposePlayerTraversalState(state)
  world.free()
})
