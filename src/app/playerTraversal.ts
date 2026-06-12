import * as THREE from 'three'
import type { RigidBody, World } from '@dimforge/rapier3d-compat'

import { createLocomotionIntent, type LocomotionIntent } from './locomotionIntent'
import {
  applySurfaceRigState,
  getSurfacePosition,
  getSurfaceRigRegion,
  moveSurfaceRigState,
  type SurfaceRigState
} from './surfaceRig'
import type { RapierModule } from '../physics/rapierContext'
import {
  PLAYER_COLLISION_GROUPS,
  createRigidBodyAtRealPose,
  readRigidBodyPoseAsReal,
  scaleLengthForRapier,
  setRigidBodyLinvelFromReal,
  setRigidBodyTranslationFromReal
} from '../physics/rapierBoundary'
import {
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from '../sim/frameTransforms'
import { confineSphereToRotatingCylinder } from '../sim/cylinderCollision'
import { createUnitsContext, type UnitsContext } from '../units/units'

export type PlayerTraversalMode = 'attached' | 'free-fly'

type PlayerTraversalPhysicsState = {
  world: World
  freeFlyBody: RigidBody
  units: UnitsContext
}

export type PlayerTraversalPhysicsContext = {
  rapier: RapierModule
  world: World
  units?: UnitsContext
}

export type PlayerTraversalState = {
  mode: PlayerTraversalMode
  surface: SurfaceRigState
  inertialPosition: THREE.Vector3
  inertialVelocity: THREE.Vector3
  physics: PlayerTraversalPhysicsState | null
}

type AttachedPlayerStepConfig = {
  axisDistanceDelta: number
  tangentDistanceDelta: number
  radius: number
  length: number
  deltaSeconds: number
  omega: number
  frameAngleEnd: number
}

type FreeFlyPlayerStepConfig = {
  thrustAcceleration: THREE.Vector3
  deltaSeconds: number
  frameAngleStart: number
  frameAngleEnd: number
  omega: number
  linearDamping: number
  brakeAmount: number
  brakeDamping: number
  maxSpeed: number
}

export type ReattachTuning = {
  endCapMargin: number
  radialTolerance: number
  maxNormalSpeed: number
  maxSurfaceSpeed: number
}

export type ReattachPlayerConfig = ReattachTuning & {
  radius: number
  length: number
  omega: number
  frameAngle: number
}

export type FreeFlyInteriorConstraintConfig = {
  radius: number
  length: number
  omega: number
  frameAngle: number
}

export type ReattachStatus = {
  withinAxialWindow: boolean
  radialError: number
  normalSpeed: number
  surfaceSpeed: number
  canAttach: boolean
}

const previousRotatingPosition = new THREE.Vector3()
const nextRotatingPosition = new THREE.Vector3()
const previousVisibleRotatingPosition = new THREE.Vector3()
const nextVisibleRotatingPosition = new THREE.Vector3()
const rotatingVelocity = new THREE.Vector3()
const inertialAcceleration = new THREE.Vector3()
const inertialLaunchVelocity = new THREE.Vector3()
const zeroRotatingVelocity = new THREE.Vector3()
const renderPosition = new THREE.Vector3()
const reattachPosition = new THREE.Vector3()
const reattachVelocity = new THREE.Vector3()
const outwardNormal = new THREE.Vector3()
const surfaceRelativeVelocity = new THREE.Vector3()
// The body's rotation is locked to identity while "up" is radial and varies
// with azimuth, so any oriented collider shape ends up sideways somewhere on
// the ring. A sphere is the only orientation-free choice: it rests on the
// wall panels at every azimuth and glides over panel seams.
const PLAYER_COLLIDER_RADIUS = 0.32
const PLAYER_WALL_CLEARANCE = 0.08
const PLAYER_COLLISION_SUPPORT_RADIUS = PLAYER_COLLIDER_RADIUS

// Physical walking: the body is a live dynamic sphere. Tangent/axial motion
// is steered toward the intent with traction proportional to the EFFECTIVE
// spin gravity (your co-rotation speed, not the habitat's), while the radial
// axis follows the analytic cylinder surface — the ground constraint solved
// exactly, so panel seams and chord ripple never shake the walker. The
// sphere hovers just above the wall panels; they only matter for free-fly
// landings, thrown balls and the car.
const PLAYER_REST_SUPPORT = 0.32
const GROUND_LOSS_GAP = 1.0
const GROUND_CONTACT_GAP = 0.9
const GROUND_CONTACT_MAX_RADIAL_SPEED = 1.8
const WALK_TRACTION_ACCEL = 28
const GROUND_FOLLOW_TIME = 0.12
const GROUND_FOLLOW_MAX_SPEED = 3
const walkOutward = new THREE.Vector3()
const walkTangent = new THREE.Vector3()
const walkDesired = new THREE.Vector3()

export const DEFAULT_REATTACH_TUNING: ReattachTuning = {
  endCapMargin: 1.5,
  radialTolerance: 0.2,
  maxNormalSpeed: 0.75,
  maxSurfaceSpeed: 1.4
}

export const getPlayerBodyRadius = (habitatRadius: number) =>
  Math.max(0, habitatRadius - PLAYER_COLLISION_SUPPORT_RADIUS - PLAYER_WALL_CLEARANCE)

const getPlayerCollisionRadius = () =>
  PLAYER_COLLISION_SUPPORT_RADIUS + PLAYER_WALL_CLEARANCE

export const createPlayerTraversalState = (
  surface: SurfaceRigState,
  radius: number,
  frameAngle: number,
  omega: number,
  physics?: PlayerTraversalPhysicsContext
): PlayerTraversalState => {
  const state: PlayerTraversalState = {
    mode: 'attached',
    surface: { ...surface },
    inertialPosition: new THREE.Vector3(),
    inertialVelocity: new THREE.Vector3(),
    physics: null
  }

  syncAttachedInertialState(state, radius, frameAngle, omega, zeroRotatingVelocity)

  if (physics !== undefined) {
    const units = physics.units ?? createUnitsContext(1)
    const freeFlyBody = createRigidBodyAtRealPose(
      physics.world,
      physics.rapier.RigidBodyDesc.dynamic()
        .setGravityScale(0)
        .setLinearDamping(0)
        .lockRotations()
        .setCanSleep(false)
        // No CCD: sweeps ignore the wall's rotational surface velocity, so a
        // co-rotating body reads as a 177 m/s impact and gets stopped dead.
        // Relative wall speeds are a few m/s against a meters-thick shell.
        .setCcdEnabled(false)
        .setEnabled(true),
      {
        position: state.inertialPosition,
        linearVelocity: state.inertialVelocity
      },
      units
    )
    // Traction is modeled by the walking controller (grip ~ spin gravity), so
    // engine friction stays low: at panel seams the sphere touches two faces
    // at once, and full friction there out-muscled the controller and parked
    // the player on every seam.
    physics.world.createCollider(
      physics.rapier.ColliderDesc.ball(
        scaleLengthForRapier(PLAYER_COLLIDER_RADIUS, units)
      )
        .setFriction(0.5)
        .setFrictionCombineRule(physics.rapier.CoefficientCombineRule.Min)
        .setCollisionGroups(PLAYER_COLLISION_GROUPS)
        .setDensity(1.0)
        .setRestitution(0.02),
      freeFlyBody
    )
    state.physics = {
      world: physics.world,
      freeFlyBody,
      units
    }
    syncFreeFlyBodyToState(state, false)
  }

  return state
}

// Walking as physics: read the live body, steer its surface-plane velocity
// toward the intent with grip proportional to spin gravity, and let the
// radial axis (contact, bumps, lift-off) stay with the engine.
const stepGroundedPlayerPhysics = (
  state: PlayerTraversalState,
  config: AttachedPlayerStepConfig
) => {
  if (state.physics === null) {
    return
  }

  readRigidBodyPoseAsReal(state.physics.freeFlyBody, state.physics.units, {
    position: state.inertialPosition,
    linearVelocity: state.inertialVelocity
  })
  inertialPositionToRotating(state.inertialPosition, config.frameAngleEnd, nextRotatingPosition)
  inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    config.omega,
    config.frameAngleEnd,
    rotatingVelocity
  )

  const azimuth = Math.atan2(nextRotatingPosition.z, nextRotatingPosition.x)
  const radialDistance = Math.hypot(nextRotatingPosition.x, nextRotatingPosition.z)
  state.surface.azimuth = azimuth
  state.surface.axialPosition = nextRotatingPosition.y

  const insideAxially =
    Math.abs(nextRotatingPosition.y) <= Math.max(0, config.length * 0.5 - 1.5)
  const grounded = radialDistance > config.radius - PLAYER_REST_SUPPORT - GROUND_LOSS_GAP

  if (!grounded || !insideAxially) {
    state.mode = 'free-fly'
    return
  }

  if (config.deltaSeconds <= 0) {
    return
  }

  walkOutward.set(Math.cos(azimuth), 0, Math.sin(azimuth))
  walkTangent.set(-Math.sin(azimuth), 0, Math.cos(azimuth))

  const axialVelocity = rotatingVelocity.y
  const tangentVelocity = rotatingVelocity.dot(walkTangent)
  const desiredAxial = config.axisDistanceDelta / config.deltaSeconds
  const desiredTangent = config.tangentDistanceDelta / config.deltaSeconds

  // Traction is normal load, and the normal load is YOUR centripetal
  // acceleration: run against the spin and your feet get lighter.
  const inertialTangentSpeed = tangentVelocity + config.omega * radialDistance
  const effectiveGravity =
    (inertialTangentSpeed * inertialTangentSpeed) / Math.max(radialDistance, 1e-6)
  const grip = THREE.MathUtils.clamp(effectiveGravity / 9.80665, 0, 1.2)
  const maxDelta = WALK_TRACTION_ACCEL * grip * config.deltaSeconds
  const newAxial =
    axialVelocity + THREE.MathUtils.clamp(desiredAxial - axialVelocity, -maxDelta, maxDelta)
  const newTangent =
    tangentVelocity +
    THREE.MathUtils.clamp(desiredTangent - tangentVelocity, -maxDelta, maxDelta)

  // Radial ground-follow: hold the body on the analytic cylinder surface.
  const restRadial = getPlayerBodyRadius(config.radius)
  const newRadial = THREE.MathUtils.clamp(
    (restRadial - radialDistance) / GROUND_FOLLOW_TIME,
    -GROUND_FOLLOW_MAX_SPEED,
    GROUND_FOLLOW_MAX_SPEED
  )

  walkDesired
    .copy(walkTangent)
    .multiplyScalar(newTangent)
    .addScaledVector(walkOutward, newRadial)
  walkDesired.y += newAxial
  rotatingVelocityToInertial(
    nextRotatingPosition,
    walkDesired,
    config.omega,
    config.frameAngleEnd,
    state.inertialVelocity
  )
  setRigidBodyLinvelFromReal(
    state.physics.freeFlyBody,
    state.inertialVelocity,
    state.physics.units,
    true
  )
}

// Free-fly -> attached when the body has settled onto the wall. Returns true
// exactly on the landing frame.
export const updatePlayerGroundContact = (
  state: PlayerTraversalState,
  config: { radius: number; length: number; frameAngle: number; omega: number }
) => {
  if (state.mode !== 'free-fly' || state.physics === null) {
    return false
  }

  inertialPositionToRotating(state.inertialPosition, config.frameAngle, nextRotatingPosition)
  inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    config.omega,
    config.frameAngle,
    rotatingVelocity
  )

  const radialDistance = Math.hypot(nextRotatingPosition.x, nextRotatingPosition.z)
  const insideAxially =
    Math.abs(nextRotatingPosition.y) <= Math.max(0, config.length * 0.5 - 1.5)

  if (!insideAxially || radialDistance <= config.radius - PLAYER_REST_SUPPORT - GROUND_CONTACT_GAP) {
    return false
  }

  walkOutward.set(
    nextRotatingPosition.x / Math.max(radialDistance, 1e-6),
    0,
    nextRotatingPosition.z / Math.max(radialDistance, 1e-6)
  )

  if (Math.abs(rotatingVelocity.dot(walkOutward)) > GROUND_CONTACT_MAX_RADIAL_SPEED) {
    return false
  }

  state.mode = 'attached'
  state.surface.azimuth = Math.atan2(nextRotatingPosition.z, nextRotatingPosition.x)
  state.surface.axialPosition = nextRotatingPosition.y
  return true
}

export const stepAttachedPlayer = (
  state: PlayerTraversalState,
  config: AttachedPlayerStepConfig
) => {
  if (state.mode !== 'attached') {
    return
  }

  if (state.physics !== null) {
    stepGroundedPlayerPhysics(state, config)
    return
  }

  const bodyRadius = getPlayerBodyRadius(config.radius)
  getSurfacePosition(state.surface, bodyRadius, previousRotatingPosition)
  getSurfacePosition(state.surface, config.radius, previousVisibleRotatingPosition)
  moveSurfaceRigState(
    state.surface,
    config.axisDistanceDelta,
    config.tangentDistanceDelta,
    config.radius,
    config.length,
    { capEnds: false }
  )
  getSurfacePosition(state.surface, bodyRadius, nextRotatingPosition)
  getSurfacePosition(state.surface, config.radius, nextVisibleRotatingPosition)

  if (config.deltaSeconds > 0) {
    rotatingVelocity
      .copy(nextVisibleRotatingPosition)
      .sub(previousVisibleRotatingPosition)
      .divideScalar(config.deltaSeconds)
  } else {
    rotatingVelocity.set(0, 0, 0)
  }

  syncAttachedInertialState(state, config.radius, config.frameAngleEnd, config.omega, rotatingVelocity)

  if (getSurfaceRigRegion(state.surface, config.length) === 'outside') {
    state.mode = 'free-fly'
    syncFreeFlyBodyToState(state, true)
  }
}

export const detachPlayerToFreeFly = (
  state: PlayerTraversalState,
  config: {
    launchVelocity: THREE.Vector3
    radius: number
    omega: number
    frameAngle: number
  }
) => {
  if (state.mode !== 'attached') {
    return
  }

  syncAttachedInertialState(state, config.radius, config.frameAngle, config.omega, zeroRotatingVelocity)
  state.mode = 'free-fly'
  rotatingPositionToInertial(config.launchVelocity, config.frameAngle, inertialLaunchVelocity)
  state.inertialVelocity.add(inertialLaunchVelocity)
  syncFreeFlyBodyToState(state, true)
}

export const stepFreeFlyPlayer = (
  state: PlayerTraversalState,
  config: FreeFlyPlayerStepConfig
) => {
  if (state.mode !== 'free-fly') {
    return
  }

  syncPlayerTraversalFromPhysics(state)

  rotatingPositionToInertial(config.thrustAcceleration, config.frameAngleStart, inertialAcceleration)
  state.inertialVelocity.addScaledVector(inertialAcceleration, config.deltaSeconds)

  // Brake in inertial frame — brings the player toward absolute rest.
  if (config.brakeAmount > 0) {
    const brakeFactor = Math.exp(
      -config.brakeAmount * config.brakeDamping * config.deltaSeconds
    )
    state.inertialVelocity.multiplyScalar(brakeFactor)
  }

  // Max speed clamped in rotating frame — prevents unbounded perceived speed
  // while preserving co-rotation velocity.
  inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    config.omega,
    config.frameAngleStart,
    rotatingVelocity
  )
  if (rotatingVelocity.lengthSq() > config.maxSpeed * config.maxSpeed) {
    rotatingVelocity.setLength(config.maxSpeed)
    inertialPositionToRotating(state.inertialPosition, config.frameAngleStart, nextRotatingPosition)
    rotatingVelocityToInertial(
      nextRotatingPosition,
      rotatingVelocity,
      config.omega,
      config.frameAngleStart,
      state.inertialVelocity
    )
  }

  if (state.physics !== null) {
    setRigidBodyLinvelFromReal(
      state.physics.freeFlyBody,
      state.inertialVelocity,
      state.physics.units,
      true
    )
    return
  }

  state.inertialPosition.addScaledVector(state.inertialVelocity, config.deltaSeconds)
}

export const applyPlayerTraversalState = (
  playerRig: THREE.Group,
  state: PlayerTraversalState,
  radius: number,
  frameAngle: number
) => {
  if (state.mode === 'attached') {
    applySurfaceRigState(playerRig, state.surface, radius)
    return
  }

  playerRig.position.copy(inertialPositionToRotating(state.inertialPosition, frameAngle, renderPosition))
}

export const getPlayerTraversalRegion = (
  state: PlayerTraversalState,
  length: number,
  frameAngle: number
) => {
  if (state.mode === 'attached') {
    return getSurfaceRigRegion(state.surface, length)
  }

  return Math.abs(inertialPositionToRotating(state.inertialPosition, frameAngle, renderPosition).y) <=
    Math.max(0, length * 0.5 - 1.5)
    ? 'inside'
    : 'outside'
}

export const getIdleLocomotionIntent = () => createLocomotionIntent()

export const syncPlayerTraversalFromPhysics = (state: PlayerTraversalState) => {
  if (state.mode !== 'free-fly' || state.physics === null) {
    return
  }

  readRigidBodyPoseAsReal(state.physics.freeFlyBody, state.physics.units, {
    position: state.inertialPosition,
    linearVelocity: state.inertialVelocity
  })
}

export const confinePlayerToHabitatInterior = (
  state: PlayerTraversalState,
  config: FreeFlyInteriorConstraintConfig
) => {
  if (state.mode !== 'free-fly') {
    return false
  }

  inertialPositionToRotating(state.inertialPosition, config.frameAngle, reattachPosition)
  inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    config.omega,
    config.frameAngle,
    reattachVelocity
  )

  const collided = confineSphereToRotatingCylinder(reattachPosition, reattachVelocity, {
    radius: config.radius,
    length: config.length,
    sphereRadius: getPlayerCollisionRadius(),
    restitution: 0.02,
    omega: config.omega,
    capEnds: false
  })

  if (!collided) {
    return false
  }

  rotatingPositionToInertial(reattachPosition, config.frameAngle, state.inertialPosition)
  rotatingVelocityToInertial(
    reattachPosition,
    reattachVelocity,
    config.omega,
    config.frameAngle,
    state.inertialVelocity
  )

  if (state.physics !== null) {
    setRigidBodyTranslationFromReal(
      state.physics.freeFlyBody,
      state.inertialPosition,
      state.physics.units,
      true
    )
    setRigidBodyLinvelFromReal(
      state.physics.freeFlyBody,
      state.inertialVelocity,
      state.physics.units,
      true
    )
  }

  return true
}

export const disposePlayerTraversalState = (state: PlayerTraversalState) => {
  if (state.physics === null || !state.physics.freeFlyBody.isValid()) {
    return
  }

  state.physics.world.removeRigidBody(state.physics.freeFlyBody)
  state.physics = null
}

export const evaluateReattachPlayer = (
  state: PlayerTraversalState,
  config: ReattachPlayerConfig
): ReattachStatus => {
  if (state.mode !== 'free-fly') {
    return {
      withinAxialWindow: false,
      radialError: Number.POSITIVE_INFINITY,
      normalSpeed: Number.POSITIVE_INFINITY,
      surfaceSpeed: Number.POSITIVE_INFINITY,
      canAttach: false
    }
  }

  const halfLength = Math.max(0, config.length * 0.5 - config.endCapMargin)
  const bodyRadius = getPlayerBodyRadius(config.radius)

  inertialPositionToRotating(state.inertialPosition, config.frameAngle, reattachPosition)
  const withinAxialWindow = Math.abs(reattachPosition.y) <= halfLength
  const radialDistance = Math.hypot(reattachPosition.x, reattachPosition.z)
  const radialError = Math.abs(radialDistance - bodyRadius)

  if (radialDistance <= 1e-6) {
    return {
      withinAxialWindow,
      radialError,
      normalSpeed: Number.POSITIVE_INFINITY,
      surfaceSpeed: Number.POSITIVE_INFINITY,
      canAttach: false
    }
  }

  inertialVelocityToRotating(
    state.inertialPosition,
    state.inertialVelocity,
    config.omega,
    config.frameAngle,
    reattachVelocity
  )
  outwardNormal.set(
    reattachPosition.x / radialDistance,
    0,
    reattachPosition.z / radialDistance
  )
  const normalSpeed = Math.abs(reattachVelocity.dot(outwardNormal))
  surfaceRelativeVelocity
    .copy(reattachVelocity)
    .addScaledVector(outwardNormal, -reattachVelocity.dot(outwardNormal))
  const surfaceSpeed = surfaceRelativeVelocity.length()

  return {
    withinAxialWindow,
    radialError,
    normalSpeed,
    surfaceSpeed,
    canAttach:
      withinAxialWindow &&
      radialError <= config.radialTolerance &&
      normalSpeed <= config.maxNormalSpeed &&
      surfaceSpeed <= config.maxSurfaceSpeed
  }
}

export const tryReattachPlayer = (
  state: PlayerTraversalState,
  config: ReattachPlayerConfig
) => {
  const status = evaluateReattachPlayer(state, config)

  if (!status.canAttach) {
    return false
  }

  const halfLength = Math.max(0, config.length * 0.5 - config.endCapMargin)
  inertialPositionToRotating(state.inertialPosition, config.frameAngle, reattachPosition)
  state.mode = 'attached'
  state.surface.axialPosition = THREE.MathUtils.clamp(reattachPosition.y, -halfLength, halfLength)
  state.surface.azimuth = Math.atan2(reattachPosition.z, reattachPosition.x)
  syncAttachedInertialState(state, config.radius, config.frameAngle, config.omega, zeroRotatingVelocity)
  return true
}

const syncAttachedInertialState = (
  state: PlayerTraversalState,
  radius: number,
  frameAngle: number,
  omega: number,
  currentRotatingVelocity: THREE.Vector3
) => {
  getSurfacePosition(state.surface, getPlayerBodyRadius(radius), nextRotatingPosition)
  rotatingPositionToInertial(nextRotatingPosition, frameAngle, state.inertialPosition)
  getSurfacePosition(state.surface, radius, previousVisibleRotatingPosition)
  rotatingVelocityToInertial(
    previousVisibleRotatingPosition,
    currentRotatingVelocity,
    omega,
    frameAngle,
    state.inertialVelocity
  )
  syncFreeFlyBodyToState(state, false)
}

const syncFreeFlyBodyToState = (state: PlayerTraversalState, _enabled: boolean) => {
  if (state.physics === null) {
    return
  }

  setRigidBodyTranslationFromReal(
    state.physics.freeFlyBody,
    state.inertialPosition,
    state.physics.units,
    true
  )
  setRigidBodyLinvelFromReal(
    state.physics.freeFlyBody,
    state.inertialVelocity,
    state.physics.units,
    true
  )
  // The body is always live: walking is physical too, pressed onto the wall
  // by nothing but its own co-rotation.
  state.physics.freeFlyBody.setEnabled(true)
}

export const resetPlayerToAttached = (
  state: PlayerTraversalState,
  config: {
    axialPosition: number
    azimuth: number
    radius: number
    frameAngle: number
    omega: number
  }
) => {
  state.mode = 'attached'
  state.surface.axialPosition = config.axialPosition
  state.surface.azimuth = config.azimuth
  syncAttachedInertialState(state, config.radius, config.frameAngle, config.omega, zeroRotatingVelocity)
}

export const resetPlayerToFreeFly = (
  state: PlayerTraversalState,
  config: {
    rotatingPosition: THREE.Vector3
    rotatingVelocity?: THREE.Vector3
    frameAngle: number
    omega: number
  }
) => {
  state.mode = 'free-fly'
  rotatingPositionToInertial(config.rotatingPosition, config.frameAngle, state.inertialPosition)
  rotatingVelocityToInertial(
    config.rotatingPosition,
    config.rotatingVelocity ?? zeroRotatingVelocity,
    config.omega,
    config.frameAngle,
    state.inertialVelocity
  )
  syncFreeFlyBodyToState(state, true)
}

export const mergeLocomotionIntent = (
  base: LocomotionIntent,
  next: LocomotionIntent,
  target = createLocomotionIntent()
) => {
  target.attachedAxis = base.attachedAxis + next.attachedAxis
  target.attachedTangent = base.attachedTangent + next.attachedTangent
  target.freeFlyThrust.copy(base.freeFlyThrust).add(next.freeFlyThrust)
  target.freeFlyBrake = Math.max(base.freeFlyBrake, next.freeFlyBrake)
  target.detachRequested = base.detachRequested || next.detachRequested

  if (next.detachRequested) {
    target.detachLaunchVelocity.copy(next.detachLaunchVelocity)
  } else if (base.detachRequested) {
    target.detachLaunchVelocity.copy(base.detachLaunchVelocity)
  } else {
    target.detachLaunchVelocity.set(0, 0, 0)
  }

  if (target.freeFlyThrust.lengthSq() > 1) {
    target.freeFlyThrust.normalize()
  }

  target.freeFlyBrake = THREE.MathUtils.clamp(target.freeFlyBrake, 0, 1)
  target.attachedAxis = THREE.MathUtils.clamp(target.attachedAxis, -1, 1)
  target.attachedTangent = THREE.MathUtils.clamp(target.attachedTangent, -1, 1)
  return target
}
