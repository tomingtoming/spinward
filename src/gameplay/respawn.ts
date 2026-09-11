import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { resetPlayerToGrounded, resetPlayerToFreeFly } from '../app/playerTraversal'
import { getArrivalSquare, getOverlookAltitude } from '../objects/cityLayout'
import type { HabitatType } from '../sim/habitatConfig'

const axisEndRotatingPosition = new THREE.Vector3()
const overlookRotatingPosition = new THREE.Vector3()
const exteriorRotatingPosition = new THREE.Vector3()
const exteriorRotatingVelocity = new THREE.Vector3()

export type ExteriorView = { aspect?: number; verticalFovDegrees?: number }

/** Fit the hull in the smaller viewport dimension. A fixed multiple of radius
 * clips long cylinders and shows an edge-on ring. Mirror wings can extend
 * beyond this framing; the inhabited hull is the visual anchor. */
export const getExteriorVantage = (config: { type: HabitatType; radius: number; length: number } & ExteriorView) => {
  const halfVertical = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(config.verticalFovDegrees ?? 70, 25, 110) / 2)
  const aspect = THREE.MathUtils.clamp(config.aspect ?? 1, .3, 4)
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect)
  const envelope = Math.hypot(config.radius * 1.12, config.length * .5)
  const distance = envelope * 1.08 / Math.sin(Math.min(halfVertical, halfHorizontal))
  return new THREE.Vector3(1, config.type === 'ring' ? -.8 : -.7, .32).normalize().multiplyScalar(distance)
}

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

// The old-town arrival square at the port end — where a traveller down from
// the spaceport hub first stands on spin gravity. Only exists on habitats
// long enough to hold distinct districts (getArrivalSquare returns null on
// small drums and rings), so callers use the return value to gate the UI.
export const canRespawnAtOldTown = (radius: number, length: number) =>
  getArrivalSquare(radius, length) !== null

export const respawnOldTown = (
  state: PlayerTraversalState,
  config: {
    radius: number
    length: number
    frameAngle: number
    omega: number
  }
) => {
  const square = getArrivalSquare(config.radius, config.length)

  if (square === null) {
    return false
  }

  resetPlayerToGrounded(state, {
    axialPosition: square.axial,
    azimuth: 0,
    radius: config.radius,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  return true
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
// radially clear of the wall, with an oblique view sized for the whole hull.
export const respawnExterior = (
  state: PlayerTraversalState,
  config: ExteriorView & {
    type: HabitatType
    radius: number
    length: number
    frameAngle: number
    omega: number
  }
) => {
  exteriorRotatingPosition.copy(getExteriorVantage(config))
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
