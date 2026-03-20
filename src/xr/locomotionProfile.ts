import * as THREE from 'three'

import type {
  AttachedClutchConfig,
  FreeFlyClutchConfig,
  RotationClutchConfig
} from './handClutchLocomotion'

export type LocomotionProfileId = 'beginner' | 'sim' | 'expert'

export type LocomotionProfile = {
  id: LocomotionProfileId
  attached: AttachedClutchConfig
  freeFly: FreeFlyClutchConfig
  rotation: RotationClutchConfig
  rollDeadzone: number
  rollGain: number
  stickDeadzone: number
  angularAcceleration: number
  comfortDeadzone: number
}

export const BEGINNER_PROFILE: LocomotionProfile = {
  id: 'beginner',
  attached: {
    moveDeadzone: 0.04,
    moveMaxDistance: 0.2,
    detachLiftDistance: 0.38,
    detachLiftSpeed: 0.65,
    minLaunchSpeed: 1.8,
    maxLaunchSpeed: 4.5
  },
  freeFly: {
    thrustDeadzone: 0.05,
    thrustMaxDistance: 0.25
  },
  rotation: {
    angleDeadzoneRadians: THREE.MathUtils.degToRad(10),
    maxAngleRadians: THREE.MathUtils.degToRad(50)
  },
  rollDeadzone: 0.38,
  rollGain: 0.3,
  stickDeadzone: 0.2,
  angularAcceleration: Math.PI * 0.7,
  comfortDeadzone: 0.25
}

export const SIM_PROFILE: LocomotionProfile = {
  id: 'sim',
  attached: {
    moveDeadzone: 0.025,
    moveMaxDistance: 0.16,
    detachLiftDistance: 0.3,
    detachLiftSpeed: 0.5,
    minLaunchSpeed: 2.2,
    maxLaunchSpeed: 6
  },
  freeFly: {
    thrustDeadzone: 0.03,
    thrustMaxDistance: 0.2
  },
  rotation: {
    angleDeadzoneRadians: THREE.MathUtils.degToRad(6.5),
    maxAngleRadians: THREE.MathUtils.degToRad(45)
  },
  rollDeadzone: 0.24,
  rollGain: 0.55,
  stickDeadzone: 0.14,
  angularAcceleration: Math.PI * 1.1,
  comfortDeadzone: 0.18
}

export const EXPERT_PROFILE: LocomotionProfile = {
  id: 'expert',
  attached: {
    moveDeadzone: 0.015,
    moveMaxDistance: 0.12,
    detachLiftDistance: 0.25,
    detachLiftSpeed: 0.4,
    minLaunchSpeed: 2.5,
    maxLaunchSpeed: 7
  },
  freeFly: {
    thrustDeadzone: 0.02,
    thrustMaxDistance: 0.15
  },
  rotation: {
    angleDeadzoneRadians: THREE.MathUtils.degToRad(4),
    maxAngleRadians: THREE.MathUtils.degToRad(40)
  },
  rollDeadzone: 0.14,
  rollGain: 0.85,
  stickDeadzone: 0.1,
  angularAcceleration: Math.PI * 1.5,
  comfortDeadzone: 0.12
}

export const LOCOMOTION_PROFILES: Record<LocomotionProfileId, LocomotionProfile> = {
  beginner: BEGINNER_PROFILE,
  sim: SIM_PROFILE,
  expert: EXPERT_PROFILE
}

export const DEFAULT_LOCOMOTION_PROFILE_ID: LocomotionProfileId = 'sim'

export const getLocomotionProfile = (id: LocomotionProfileId) =>
  LOCOMOTION_PROFILES[id]
