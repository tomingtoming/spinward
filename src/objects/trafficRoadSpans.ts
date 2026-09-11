import type { CityRoad } from './cityLayout'
import type { TrafficMotion } from './trafficMotion'

export type TrafficRoadSpan = {
  road: CityRoad
  isAvenue: boolean
  spanStart: number
  spanLength: number
}

/** Compile physical roads before clipping the moving visibility window. This
 * keeps a road's identity independent of the player's current street position. */
export function planTrafficRoadSpans(roads: readonly CityRoad[], radius: number) {
  return mergeTrafficRoadSpans(roads.filter(road => road.kind !== 'alley').map(road => {
    const isAvenue = road.axialLength > road.tangentWidth
    const spanLength = isAvenue ? road.axialLength : Math.min(road.tangentWidth, 2 * Math.PI * radius)
    return { road, isAvenue, spanStart: (isAvenue ? road.axial : 0) - spanLength / 2, spanLength }
  }))
}

export function trafficRoadKey(road: CityRoad) {
  return [road.kind, road.azimuth, road.axial, road.axialLength, road.tangentWidth].join(':')
}

export function trafficRoadSeed(key: string) {
  let seed = 0x811c9dc5
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 0x01000193)
  return seed >>> 0
}

type MovingSpan = { spanStart: number; spanLength: number; direction: 1 | -1; phaseMeters: number; motion?: TrafficMotion }
/** Retain the world coordinate and velocity when a visibility window shifts.
 * Cars outside the new window can retire; they must not wrap back through it. */
export function remapTrafficMotion(previous: MovingSpan, next: MovingSpan): TrafficMotion | undefined {
  const progress = ((previous.motion?.progress ?? previous.phaseMeters) % previous.spanLength + previous.spanLength) % previous.spanLength
  const along = previous.spanStart + (previous.direction === 1 ? progress : previous.spanLength - progress)
  const end = next.spanStart + next.spanLength
  if (next.direction === 1 ? along < next.spanStart || along >= end : along <= next.spanStart || along > end) return undefined
  return {
    progress: next.direction === 1 ? along - next.spanStart : next.spanStart + next.spanLength - along,
    speed: previous.motion?.speed ?? 0
  }
}

/** Road artwork is split at block boundaries. Cars should travel along the
 * continuous avenue, not repeat each short block and reappear in its neighbour's
 * queue. Keep real gaps and lane-profile changes as separate spans. */
export function mergeTrafficRoadSpans(spans: readonly TrafficRoadSpan[]): TrafficRoadSpan[] {
  const groups = new Map<string, TrafficRoadSpan[]>()
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    const key = span.isAvenue
      ? [span.road.azimuth, span.road.kind, span.road.tangentWidth].join(':')
      : `street:${i}`
    const group = groups.get(key) ?? []
    group.push(span); groups.set(key, group)
  }
  const result: TrafficRoadSpan[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.spanStart - b.spanStart)
    let merged: TrafficRoadSpan | undefined
    for (const span of group) {
      if (merged && span.isAvenue && span.spanStart <= merged.spanStart + merged.spanLength + .01) {
        merged.spanLength = Math.max(merged.spanStart + merged.spanLength, span.spanStart + span.spanLength) - merged.spanStart
        merged.road.axial = merged.spanStart + merged.spanLength / 2
        merged.road.axialLength = merged.spanLength
      } else {
        merged = { ...span, road: { ...span.road } }
        result.push(merged)
      }
    }
  }
  return result
}
