import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { resetPlayerToGrounded, resetPlayerToFreeFly } from '../app/playerTraversal'
import { getOverlookAltitude } from '../objects/cityLayout'
import type { HabitatType } from '../sim/habitatConfig'

const axisEndRotatingPosition = new THREE.Vector3()
const overlookRotatingPosition = new THREE.Vector3()
const exteriorRotatingPosition = new THREE.Vector3()
const exteriorRotatingVelocity = new THREE.Vector3()

// How far outside the hull the exterior vantage sits, as a multiple of the hull
// radius — far enough to read the whole cylinder and the mirror end, close
// enough that the colony still fills the view.
const EXTERIOR_RADIUS_FACTOR = 1.6

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

// Drop the player into space OUTSIDE the hull to admire the colony. Free-fly,
// radially clear of the wall and (for a cylinder) hung off the -Y mirror end so
// the petals and the long hull read at a glance.
export const respawnExterior = (
  state: PlayerTraversalState,
  config: {
    type: HabitatType
    radius: number
    length: number
    frameAngle: number
    omega: number
  }
) => {
  const outward = config.radius * EXTERIOR_RADIUS_FACTOR
  const axial = config.type === 'cylinder' ? -config.length * 0.3 : 0
  exteriorRotatingPosition.set(outward, axial, 0)
  // INERTIAL rest: the rotating-frame velocity -(omega x r) cancels the spin,
  // so the observer hangs still in space and the colony visibly rotates past.
  // This has flip-flopped once, so both options for the record:
  //  - co-rotating (zero rotating velocity, like interior respawns) keeps the
  //    colony still in view, but an unpowered body cannot orbit: it is really
  //    on a tangent line and drifts outward — and it hides the spin, which is
  //    the whole reason the exterior vantage exists.
  //  - inertial rest (this) shows the megastructure turning; the surface
  //    sweeps past, so reattaching means matching its speed, as it should.
  exteriorRotatingVelocity.set(
    -config.omega * exteriorRotatingPosition.z,
    0,
    config.omega * exteriorRotatingPosition.x
  )
  resetPlayerToFreeFly(state, {
    rotatingPosition: exteriorRotatingPosition,
    rotatingVelocity: exteriorRotatingVelocity,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  return true
}
