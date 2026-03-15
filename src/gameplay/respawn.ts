import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { resetPlayerToAttached, resetPlayerToFreeFly } from '../app/playerTraversal'
import type { HabitatType } from '../sim/habitatConfig'

const axisEndRotatingPosition = new THREE.Vector3()

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
  resetPlayerToAttached(state, {
    axialPosition: 0,
    azimuth: 0,
    radius: config.radius,
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

  axisEndRotatingPosition.set(
    0,
    config.type === 'cylinder'
      ? Math.max(0, config.length * 0.5 - getAxisEndMargin(config.length, config.endMargin))
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
