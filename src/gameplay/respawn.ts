import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { resetPlayerToGrounded, resetPlayerToFreeFly } from '../app/playerTraversal'
import { getOverlookAltitude } from '../objects/cityLayout'
import type { HabitatType } from '../sim/habitatConfig'

const axisEndRotatingPosition = new THREE.Vector3()
const overlookRotatingPosition = new THREE.Vector3()

const getAxisEndMargin = (length: number, explicitMargin?: number) => {
  if (explicitMargin !== undefined) {
    return explicitMargin
  }

  return Math.min(50, Math.max(5, length * 0.1))
}

export const canRespawnAtAxisEnd = (_type: HabitatType) => true

export const respawnInnerWall = (
  state: PlayerTraversalState,
  config: {
    radius: number
    frameAngle: number
    omega: number
  }
) => {
  resetPlayerToGrounded(state, {
    axialPosition: 0,
    azimuth: 0,
    radius: config.radius,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
}

// Overlook altitude above the surface: high enough to feel the weaker spin
// gravity, short enough that the fall back to the plaza stays comfortable.
// Defined in cityLayout so the observation tower tops out just below it.
export { getOverlookAltitude }

export const respawnOverlook = (
  state: PlayerTraversalState,
  config: {
    radius: number
    frameAngle: number
    omega: number
  }
) => {
  const overlookRadius = Math.max(1, config.radius - getOverlookAltitude(config.radius))
  overlookRotatingPosition.set(overlookRadius, 0, 0)
  resetPlayerToFreeFly(state, {
    rotatingPosition: overlookRotatingPosition,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
}

export const respawnAxisEnd = (
  state: PlayerTraversalState,
  config: {
    type: HabitatType
    length: number
    frameAngle: number
    omega: number
    endMargin?: number
  }
) => {
  if (!canRespawnAtAxisEnd(config.type)) {
    return false
  }

  // The -Y end: where the spaceport hub and the mirror hinges live, so the
  // axis traveller arrives with the port and petals in view.
  axisEndRotatingPosition.set(
    0,
    config.type === 'cylinder'
      ? -Math.max(0, config.length * 0.5 - getAxisEndMargin(config.length, config.endMargin))
      : 0,
    0
  )
  resetPlayerToFreeFly(state, {
    rotatingPosition: axisEndRotatingPosition,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  return true
}
