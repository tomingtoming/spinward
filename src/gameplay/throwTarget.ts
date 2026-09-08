import * as THREE from 'three'

export const BALL_THROW_SPEEDS = { normal: 16, slow: 12 } as const
export type BallThrowStyle = keyof typeof BALL_THROW_SPEEDS

export type ThrowTargetLayout = {
  center: THREE.Vector3
  normal: THREE.Vector3
  azimuth: number
  openingRadius: number
}

// Inside the spawn plaza, in the direction the surface camera initially faces.
export const getThrowTargetLayout = (radius: number): ThrowTargetLayout => {
  // Spawn view includes a +pi/2 yaw: forward is -Y along the axial avenue.
  const azimuth = 0
  return {
    center: new THREE.Vector3(radius - 1.8, -8, 0),
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
