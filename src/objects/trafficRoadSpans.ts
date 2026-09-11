import type { CityRoad } from './cityLayout'

export type TrafficRoadSpan = {
  road: CityRoad
  isAvenue: boolean
  spanStart: number
  spanLength: number
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
