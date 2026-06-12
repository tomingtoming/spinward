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
import { getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
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
    brakeDamping: 6,
    maxSpeed: 100
  })
  applyPlayerTraversalState(rig, state, 10, 1)

  expect(state.mode).toBe('free-fly')
  expectVectorCloseTo(state.inertialVelocity, previousVelocity)
  expect(rig.position.x).toBeGreaterThan(10.5)
  expect(rig.position.y).toBeGreaterThan(11)
  expect(Math.abs(rig.position.z)).toBeLessThan(1)
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

  expect(getPlayerTraversalRegion(state, 20, 0.5)).toBe('outside')
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

test('walking off a roof edge releases to free-fall', async () => {
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
    world.timestep = deltaSeconds
    world.step()
    syncPlayerTraversalFromPhysics(state)
    syncGroundedSurfaceFromPhysics(state, frameAngle)
  }

  // Past the footprint edge the sampled ground drops to the street and the
  // walker leaves the roof in free-fall.
  expect(state.mode).toBe('free-fly')
  expect(Math.abs(state.surface.axialPosition)).toBeGreaterThan(building.depth * 0.5)

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
    brakeDamping: 6,
    maxSpeed: 100
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
      brakeDamping: 6,
      maxSpeed: 100
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
    brakeDamping: 6,
    maxSpeed: 100
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
