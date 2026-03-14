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
  copyRapierVectorScaled,
  toRapierVectorScaled
} from '../physics/rapierMath'
import {
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from '../sim/frameTransforms'

export type PlayerTraversalMode = 'attached' | 'free-fly'

type PlayerTraversalPhysicsState = {
  world: World
  freeFlyBody: RigidBody
  simScale: number
}

export type PlayerTraversalPhysicsContext = {
  rapier: RapierModule
  world: World
  simScale?: number
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
  assistDistance: number
  assistNormalDamping: number
  assistSurfaceDamping: number
  assistRadialPull: number
}

export type ReattachPlayerConfig = ReattachTuning & {
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

type ReattachAssistConfig = ReattachPlayerConfig & {
  deltaSeconds: number
}

const previousRotatingPosition = new THREE.Vector3()
const nextRotatingPosition = new THREE.Vector3()
const rotatingVelocity = new THREE.Vector3()
const inertialAcceleration = new THREE.Vector3()
const inertialLaunchVelocity = new THREE.Vector3()
const zeroRotatingVelocity = new THREE.Vector3()
const renderPosition = new THREE.Vector3()
const reattachPosition = new THREE.Vector3()
const reattachVelocity = new THREE.Vector3()
const outwardNormal = new THREE.Vector3()
const surfaceRelativeVelocity = new THREE.Vector3()
const adjustedSurfaceVelocity = new THREE.Vector3()
const adjustedRotatingVelocity = new THREE.Vector3()
const playerColliderOffset = new THREE.Vector3(0, 0.87, 0)

const PLAYER_COLLIDER_HALF_HEIGHT = 0.55
const PLAYER_COLLIDER_RADIUS = 0.32

export const DEFAULT_REATTACH_TUNING: ReattachTuning = {
  endCapMargin: 1.5,
  radialTolerance: 0.2,
  maxNormalSpeed: 0.75,
  maxSurfaceSpeed: 1.4,
  assistDistance: 1.2,
  assistNormalDamping: 4.5,
  assistSurfaceDamping: 1.6,
  assistRadialPull: 1.3
}

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
    const simScale = physics.simScale ?? 1
    const freeFlyBody = physics.world.createRigidBody(
      physics.rapier.RigidBodyDesc.dynamic()
        .setTranslation(
          state.inertialPosition.x * simScale,
          state.inertialPosition.y * simScale,
          state.inertialPosition.z * simScale
        )
        .setLinvel(
          state.inertialVelocity.x * simScale,
          state.inertialVelocity.y * simScale,
          state.inertialVelocity.z * simScale
        )
        .setGravityScale(0)
        .setLinearDamping(0)
        .lockRotations()
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setEnabled(false)
    )
    physics.world.createCollider(
      physics.rapier.ColliderDesc.capsule(
        PLAYER_COLLIDER_HALF_HEIGHT * simScale,
        PLAYER_COLLIDER_RADIUS * simScale
      )
        .setTranslation(
          playerColliderOffset.x * simScale,
          playerColliderOffset.y * simScale,
          playerColliderOffset.z * simScale
        )
        .setFriction(0.5)
        .setRestitution(0.05),
      freeFlyBody
    )
    state.physics = {
      world: physics.world,
      freeFlyBody,
      simScale
    }
    syncFreeFlyBodyToState(state, false)
  }

  return state
}

export const stepAttachedPlayer = (
  state: PlayerTraversalState,
  config: AttachedPlayerStepConfig
) => {
  if (state.mode !== 'attached') {
    return
  }

  getSurfacePosition(state.surface, config.radius, previousRotatingPosition)
  moveSurfaceRigState(
    state.surface,
    config.axisDistanceDelta,
    config.tangentDistanceDelta,
    config.radius,
    config.length,
    { capEnds: false }
  )
  getSurfacePosition(state.surface, config.radius, nextRotatingPosition)

  if (config.deltaSeconds > 0) {
    rotatingVelocity
      .copy(nextRotatingPosition)
      .sub(previousRotatingPosition)
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
    frameAngle: number
  }
) => {
  if (state.mode !== 'attached') {
    return
  }

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

  const dampingFactor = Math.exp(
    -(config.linearDamping + config.brakeAmount * config.brakeDamping) * config.deltaSeconds
  )
  state.inertialVelocity.multiplyScalar(dampingFactor)

  if (state.inertialVelocity.lengthSq() > config.maxSpeed * config.maxSpeed) {
    state.inertialVelocity.setLength(config.maxSpeed)
  }

  if (state.physics !== null) {
    state.physics.freeFlyBody.setLinvel(
      toRapierVectorScaled(state.inertialVelocity, state.physics.simScale),
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

  copyRapierVectorScaled(
    state.physics.freeFlyBody.translation(),
    state.physics.simScale,
    state.inertialPosition
  )
  copyRapierVectorScaled(
    state.physics.freeFlyBody.linvel(),
    state.physics.simScale,
    state.inertialVelocity
  )
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
  const bodyRadius = Math.max(0, config.radius - PLAYER_COLLIDER_RADIUS)

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

export const applyReattachAssist = (
  state: PlayerTraversalState,
  config: ReattachAssistConfig
) => {
  const status = evaluateReattachPlayer(state, config)

  if (!status.withinAxialWindow || status.radialError > config.assistDistance) {
    return false
  }

  inertialPositionToRotating(state.inertialPosition, config.frameAngle, reattachPosition)
  const radialDistance = Math.hypot(reattachPosition.x, reattachPosition.z)

  if (radialDistance <= 1e-6) {
    return false
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
  const signedNormalSpeed = reattachVelocity.dot(outwardNormal)
  surfaceRelativeVelocity
    .copy(reattachVelocity)
    .addScaledVector(outwardNormal, -signedNormalSpeed)

  const assistFactor = 1 - THREE.MathUtils.clamp(status.radialError / config.assistDistance, 0, 1)
  const normalBlend = 1 - Math.exp(-config.assistNormalDamping * assistFactor * config.deltaSeconds)
  const surfaceBlend = 1 - Math.exp(-config.assistSurfaceDamping * assistFactor * config.deltaSeconds)
  const targetRadius = Math.max(0, config.radius - PLAYER_COLLIDER_RADIUS)
  const targetNormalSpeed = THREE.MathUtils.clamp(
    (targetRadius - radialDistance) * config.assistRadialPull,
    -config.maxNormalSpeed,
    config.maxNormalSpeed
  )

  adjustedSurfaceVelocity.copy(surfaceRelativeVelocity).multiplyScalar(1 - surfaceBlend)
  adjustedRotatingVelocity
    .copy(outwardNormal)
    .multiplyScalar(THREE.MathUtils.lerp(signedNormalSpeed, targetNormalSpeed, normalBlend))
    .add(adjustedSurfaceVelocity)

  rotatingVelocityToInertial(
    reattachPosition,
    adjustedRotatingVelocity,
    config.omega,
    config.frameAngle,
    state.inertialVelocity
  )

  if (state.physics !== null) {
    state.physics.freeFlyBody.setLinvel(
      toRapierVectorScaled(state.inertialVelocity, state.physics.simScale),
      true
    )
  }

  return true
}

const syncAttachedInertialState = (
  state: PlayerTraversalState,
  radius: number,
  frameAngle: number,
  omega: number,
  currentRotatingVelocity: THREE.Vector3
) => {
  getSurfacePosition(state.surface, radius, nextRotatingPosition)
  rotatingPositionToInertial(nextRotatingPosition, frameAngle, state.inertialPosition)
  rotatingVelocityToInertial(
    nextRotatingPosition,
    currentRotatingVelocity,
    omega,
    frameAngle,
    state.inertialVelocity
  )
  syncFreeFlyBodyToState(state, false)
}

const syncFreeFlyBodyToState = (state: PlayerTraversalState, enabled: boolean) => {
  if (state.physics === null) {
    return
  }

  state.physics.freeFlyBody.setTranslation(
    toRapierVectorScaled(state.inertialPosition, state.physics.simScale),
    true
  )
  state.physics.freeFlyBody.setLinvel(
    toRapierVectorScaled(state.inertialVelocity, state.physics.simScale),
    true
  )
  state.physics.freeFlyBody.setEnabled(enabled)
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
