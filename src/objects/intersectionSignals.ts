import type { CityIntersection, CityRoad } from './cityLayout'

export type SignalRoad = 'avenue' | 'street'
export type SignalAspect = 0 | 1 | 2 // green, amber, red
export const SIGNAL_CYCLE_SECONDS = 32
export const CROSSWALK_SETBACK_METERS = 1.2
export const CROSSWALK_LENGTH_METERS = 2.6
const STOP_LINE_GAP_METERS = .8
// The longest traffic body is 5 m, with up to 3% instance scale and lights
// just beyond its envelope. Keep that nose clear of the painted line too.
const VEHICLE_NOSE_METERS = 2.7
const BRAKING_ACCELERATION = 3
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const modulo = (value: number, period: number) => (value % period + period) % period

export const isSignalledIntersection = (crossing: CityIntersection) =>
  crossing.avenueKind === 'arterial' || crossing.streetKind === 'arterial'

export const signalPhaseOffset = (crossing: CityIntersection) =>
  modulo(crossing.azimuth * 1000 + crossing.axial * .37, SIGNAL_CYCLE_SECONDS)

/** Each road has ten seconds of green, three of amber and three of all-red
 * clearance. The opposite approach shares its phase, never a conflicting green. */
export function signalAspect(seconds: number, phaseOffset: number, road: SignalRoad = 'avenue'): SignalAspect {
  const phase = modulo(seconds + phaseOffset - (road === 'street' ? 16 : 0), SIGNAL_CYCLE_SECONDS)
  return phase < 10 ? 0 : phase < 13 ? 1 : 2
}

/** Centre of the painted line, outside the crossing and its zebra stripes. */
export const signalStopLineOffset = (crossing: CityIntersection, road: SignalRoad) =>
  (road === 'avenue' ? crossing.streetWidth : crossing.avenueWidth) / 2 +
  CROSSWALK_SETBACK_METERS + CROSSWALK_LENGTH_METERS + STOP_LINE_GAP_METERS

export type TrafficSignalStop = {
  along: number
  lineOffset: number
  phase: number
  crossing: CityIntersection
}
export type TrafficSignalIndex = {
  avenues: Map<number, CityIntersection[]>
  streets: Map<number, CityIntersection[]>
}
const avenueKey = (azimuth: number) => Math.round(modulo(azimuth, Math.PI * 2) * 1e9)
const streetKey = (axial: number) => Math.round(axial * 1e4)

/** Index the full plan once. Each local traffic route then keeps only its own
 * junctions instead of scanning the whole colony for every vehicle/frame. */
export function createTrafficSignalIndex(crossings: readonly CityIntersection[]): TrafficSignalIndex {
  const index: TrafficSignalIndex = { avenues: new Map(), streets: new Map() }
  for (const crossing of crossings) {
    if (!isSignalledIntersection(crossing)) continue
    for (const [map, key] of [[index.avenues, avenueKey(crossing.azimuth)], [index.streets, streetKey(crossing.axial)]] as const) {
      const list = map.get(key) ?? []
      list.push(crossing); map.set(key, list)
    }
  }
  return index
}

export function routeTrafficSignals(index: TrafficSignalIndex, road: CityRoad, radius: number, spanStart: number, spanLength: number): TrafficSignalStop[] {
  const kind: SignalRoad = road.axialLength > road.tangentWidth ? 'avenue' : 'street'
  const crossings = kind === 'avenue' ? index.avenues.get(avenueKey(road.azimuth)) : index.streets.get(streetKey(road.axial))
  const loop = kind === 'street' && spanLength >= Math.PI * 2 * radius - 1
  const stops: TrafficSignalStop[] = []
  for (const crossing of crossings ?? []) {
    const along = kind === 'avenue' ? crossing.axial : wrap(crossing.azimuth - road.azimuth) * radius
    if (!loop && (along < spanStart || along > spanStart + spanLength)) continue
    stops.push({ along, lineOffset: signalStopLineOffset(crossing, kind), phase: signalPhaseOffset(crossing), crossing })
  }
  return stops
}

/** Return the centre gap expected by advanceTraffic (which subtracts 3.2 m).
 * A car already over its line clears the junction. During amber, a vehicle
 * too close for the normal braking distance also clears before the all-red. */
export function trafficSignalGap(stops: readonly TrafficSignalStop[], road: SignalRoad, along: number, direction: number, speed: number, seconds: number, loopLength = 0) {
  let gap = Infinity
  for (const stop of stops) {
    let ahead = (stop.along - along) * direction
    if (loopLength > 0) ahead = modulo(ahead, loopLength)
    const lineAhead = ahead - stop.lineOffset
    if (lineAhead < 0) continue
    const aspect = signalAspect(seconds, stop.phase, road)
    if (aspect === 0) continue
    const stoppingRoom = Math.max(0, lineAhead - VEHICLE_NOSE_METERS)
    if (aspect === 1 && stoppingRoom < speed * speed / (2 * BRAKING_ACCELERATION) + speed * .1) continue
    gap = Math.min(gap, stoppingRoom + 3.2)
  }
  return gap
}
