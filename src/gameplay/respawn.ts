import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { resetPlayerToAttached, resetPlayerToFreeFly } from '../app/playerTraversal'
import type { HabitatType } from '../sim/habitatConfig'

const axisEndRotatingPosition = new THREE.Vector3()

export const canRespawnAtAxisEnd = (type: HabitatType) => type === 'cylinder'

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
    Math.max(0, config.length * 0.5 - (config.endMargin ?? 50)),
    0
  )
  resetPlayerToFreeFly(state, {
    rotatingPosition: axisEndRotatingPosition,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  return true
}
