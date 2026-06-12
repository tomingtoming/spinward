import * as THREE from 'three'

export const JUMP_SPEED = 3
// The player must rise clear of the surface before landing detection arms,
// otherwise the takeoff frame would immediately re-attach.
export const JUMP_ARM_CLEARANCE = 0.3
export const JUMP_LAND_TOLERANCE = 0.25

export type JumpPhase = 'grounded' | 'launching' | 'airborne'

export type JumpState = {
  phase: JumpPhase
}

export const createJumpState = (): JumpState => ({ phase: 'grounded' })

// Launch velocity in the rotating frame: straight "up" (toward the axis)
// from the player's current surface azimuth.
export const computeJumpLaunchVelocity = (
  azimuth: number,
  speed: number,
  target = new THREE.Vector3()
) => target.set(-Math.cos(azimuth), 0, -Math.sin(azimuth)).multiplyScalar(speed)

export const beginJump = (state: JumpState) => {
  state.phase = 'launching'
}

export const resetJumpState = (state: JumpState) => {
  state.phase = 'grounded'
}

// Returns true exactly when the airborne player has come back within landing
// tolerance of the surface and should be re-grounded. `descending` gates the
// snap to players actually sinking toward the wall — thrusting along or away
// from the surface (e.g. left-grip flight after a jump) must not force a
// landing just because the wall is close.
export const stepJumpState = (
  state: JumpState,
  input: {
    mode: 'grounded' | 'free-fly'
    radialError: number
    descending: boolean
  }
): boolean => {
  if (input.mode === 'grounded') {
    state.phase = 'grounded'
    return false
  }

  switch (state.phase) {
    case 'grounded':
      return false
    case 'launching':
      if (input.radialError > JUMP_ARM_CLEARANCE) {
        state.phase = 'airborne'
      }
      return false
    case 'airborne':
      if (input.radialError <= JUMP_LAND_TOLERANCE && input.descending) {
        state.phase = 'grounded'
        return true
      }
      return false
    default: {
      const exhaustive: never = state.phase
      return exhaustive
    }
  }
}
