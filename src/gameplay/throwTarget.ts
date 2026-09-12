import * as THREE from 'three'

export const BALL_THROW_SPEEDS = { normal: 16, slow: 12 } as const
export type BallThrowStyle = keyof typeof BALL_THROW_SPEEDS

export type ThrowTargetLayout = {
  center: THREE.Vector3
  normal: THREE.Vector3
  azimuth: number
  start: THREE.Vector3
  openingRadius: number
}

// Axial throwing lane: the park supplies its start; small physics habitats use the origin.
export const getThrowTargetLayout = (radius: number, origin = { azimuth: 0, axial: 0 }): ThrowTargetLayout => {
  // Spawn view includes a +pi/2 yaw: forward is -Y along the axial avenue.
  const azimuth = origin.azimuth
  return {
    center: new THREE.Vector3(Math.cos(azimuth) * (radius - 1.8), origin.axial - 8, Math.sin(azimuth) * (radius - 1.8)),
    start: new THREE.Vector3(Math.cos(azimuth) * (radius - 1.8), origin.axial, Math.sin(azimuth) * (radius - 1.8)),
    normal: new THREE.Vector3(0, 1, 0),
    azimuth,
    openingRadius: 0.6
  }
}

// Sweep the whole frame segment so fast throws cannot tunnel through the goal.
// Only front-to-back passage counts, and the entire ball must fit in the hole.
export const crossThrowTarget = (
  previous: THREE.Vector3,
  current: THREE.Vector3,
  ballRadius: number,
  layout: ThrowTargetLayout
): { hit: boolean; offset: number } | null => {
  const from = previous.clone().sub(layout.center).dot(layout.normal)
  const to = current.clone().sub(layout.center).dot(layout.normal)
  if (from <= 0 || to > 0) return null
  const point = previous.clone().lerp(current, from / (from - to))
  const offset = point.distanceTo(layout.center)
  return { hit: offset + ballRadius <= layout.openingRadius, offset }
}
