import type { SidewalkSegment } from './sidewalks'
import { SIDEWALK_LIFT } from './streetProfile'

export type StreetWalkerRoute = {
  id: string; azimuth: number; axial: number; tangentWidth: number; axialLength: number
  axis: 'axial' | 'tangent'; length: number; height: number; speed: number; phase: number; variant: number
}
const hash = (n: number, salt: number) => {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Each walk remains inside a clipped pavement band. Small circuits stop
 * short of intersections and of neighbouring circuits; no invented crossing
 * or navigation line can pass through a building or active carriageway. */
export function planStreetWalkerRoutes(segments: readonly SidewalkSegment[], radius: number, sourceOffset = 0,
  focus?: { azimuth: number; axial: number; range: number }): StreetWalkerRoute[] {
  if (radius < 100) return []
  const routes: StreetWalkerRoute[] = []
  for (const [index, s] of segments.entries()) {
    const width = s.isAvenue ? s.tangentExtent : s.axialExtent
    const length = (s.isAvenue ? s.axialExtent : s.tangentExtent) - 6
    if (width < 1.9 || length < 14) continue
    const count = Math.ceil(length / 64), chunk = length / count
    const near = focus ? (s.isAvenue ? focus.axial - s.axial :
      Math.atan2(Math.sin(focus.azimuth - s.azimuth), Math.cos(focus.azimuth - s.azimuth)) * radius) : 0
    const first = focus ? Math.max(0, Math.floor((near - focus.range + length / 2) / chunk)) : 0
    const last = focus ? Math.min(count - 1, Math.floor((near + focus.range + length / 2) / chunk)) : count - 1
    for (let i = first; i <= last; i++) {
      const offset = -length / 2 + (i + .5) * chunk
      // Stay away from lamp poles and traffic at the kerb edge.
      const across = -s.roadSide * Math.min(.25, width / 2 - .7)
      const source = index + sourceOffset, id = `${source}:${i}`
      routes.push({ id, azimuth: s.azimuth + (s.isAvenue ? across : offset) / radius,
        axial: s.axial + (s.isAvenue ? offset : across), tangentWidth: s.isAvenue ? .8 : chunk - 3,
        axialLength: s.isAvenue ? chunk - 3 : .8, axis: s.isAvenue ? 'axial' : 'tangent',
        length: chunk - 3, height: SIDEWALK_LIFT + (s.isAvenue ? 0 : .01) + .02,
        speed: .85 + hash(source + i * .13, 1) * .4,
        phase: hash(source + i * .13, 2) * 100,
        variant: Math.floor(hash(source + i * .13, 3) * 6) })
    }
  }
  return routes
}

export function sampleStreetWalker(route: StreetWalkerRoute, radius: number, seconds: number) {
  const duration = route.length / route.speed, pause = 1.8, period = 2 * (duration + pause)
  const remainder = seconds % period, t = remainder < 0 ? remainder + period : remainder
  let offset: number, heading: number, walking: boolean
  if (t < duration) {
    offset = -.5 * route.length + t * route.speed; heading = 0; walking = true
  } else if (t < duration + pause) {
    offset = .5 * route.length; heading = Math.PI * smooth((t - duration) / pause); walking = false
  } else if (t < 2 * duration + pause) {
    offset = .5 * route.length - (t - duration - pause) * route.speed; heading = Math.PI; walking = true
  } else {
    offset = -.5 * route.length; heading = Math.PI + Math.PI * smooth((t - 2 * duration - pause) / pause); walking = false
  }
  return { azimuth: route.azimuth + (route.axis === 'tangent' ? offset / radius : 0),
    axial: route.axial + (route.axis === 'axial' ? offset : 0),
    heading: heading + (route.axis === 'tangent' ? Math.PI / 2 : 0), walking }
}
const smooth = (t: number) => t * t * (3 - 2 * t)

export const walkerDistance = (a: { azimuth: number; axial: number }, b: { azimuth: number; axial: number }, radius: number) =>
  Math.hypot(Math.atan2(Math.sin(a.azimuth - b.azimuth), Math.cos(a.azimuth - b.azimuth)) * radius, a.axial - b.axial)

export function walkerWouldApproach(current: { azimuth: number; axial: number }, next: { azimuth: number; axial: number },
  obstacle: { azimuth: number; axial: number }, radius: number, clearance: number) {
  const distance = walkerDistance(next, obstacle, radius)
  return distance < clearance && distance < walkerDistance(current, obstacle, radius) - 1e-6
}
