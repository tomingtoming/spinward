export type TrafficMotion = { progress: number; speed: number }
export type TrafficLaneMember = { index: number; along: number }

/** Routes repeat at their endpoint. Keep the last car behind the first car's
 * next lap too, so crossing a span boundary cannot spawn it inside a queue. */
export function fillLaneLeaderGaps(lane: TrafficLaneMember[], period: number, gaps: Map<number, number>) {
  if (lane.length < 2) return
  lane.sort((a, b) => a.along - b.along)
  for (let i = 0; i < lane.length; i++) {
    const leader = lane[(i + 1) % lane.length]
    const distance = leader.along - lane[i].along + (i === lane.length - 1 ? period : 0)
    gaps.set(lane[i].index, Math.max(0, distance - 2))
  }
}
/** Comfortable braking to a centre stop, including a fixed bumper allowance. */
export function advanceTraffic(state: TrafficMotion, dt: number, cruise: number, gap = Infinity) {
  const step = Math.min(.1, Math.max(0, dt))
  const usable = Math.max(0, gap - 3.2)
  const target = Math.min(cruise, Math.sqrt(2 * 3 * usable))
  const speed = Math.max(0, Math.min(target, state.speed + 1.8 * step))
  const distance = Math.min(usable, (state.speed + speed) * .5 * step)
  return { progress: state.progress + distance, speed: distance === 0 ? 0 : speed }
}
export type CrossingGate = { azimuth: number; axial: number; axis: 'axial'|'tangent'; halfWidth: number; closed: boolean }
export function crossingGap(gate: CrossingGate, radius: number, kind: 'avenue'|'street', azimuth: number, axial: number, direction: number) {
  if (!gate.closed || (kind === 'avenue') !== (gate.axis === 'axial')) return Infinity
  const tangent = Math.atan2(Math.sin(gate.azimuth-azimuth), Math.cos(gate.azimuth-azimuth))*radius
  const across = kind === 'avenue' ? tangent : gate.axial-axial
  const along = (kind === 'avenue' ? gate.axial-axial : tangent)*direction
  // Vehicles already on the crossing clear it; never reverse or snap backwards.
  return Math.abs(across) <= gate.halfWidth && along > 0 ? Math.max(0, along-2) : Infinity
}
