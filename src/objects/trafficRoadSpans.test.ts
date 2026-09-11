import { expect, test } from 'bun:test'
import { mergeTrafficRoadSpans, planTrafficRoadSpans, remapTrafficMotion, trafficRoadKey, trafficRoadSeed, type TrafficRoadSpan } from './trafficRoadSpans'

const avenue = (start: number, end: number, width = 10): TrafficRoadSpan => ({
  road: { azimuth: .12, axial: (start + end) / 2, axialLength: end - start, tangentWidth: width, kind: 'local' },
  isAvenue: true, spanStart: start, spanLength: end - start
})

test('contiguous and overlapping block segments form one traffic route without changing the road plan', () => {
  const spans = [avenue(320, 640), avenue(0, 320), avenue(630, 900)]
  const before = JSON.stringify(spans)
  const merged = mergeTrafficRoadSpans(spans)
  expect(merged).toHaveLength(1)
  expect(merged[0].spanStart).toBe(0)
  expect(merged[0].spanLength).toBe(900)
  expect(merged[0].road.axial).toBe(450)
  expect(merged[0].road.axialLength).toBe(900)
  expect(JSON.stringify(spans)).toBe(before)
})

test('real gaps, different lane widths/roads and circumferential spans stay separate', () => {
  const street = { ...avenue(0, 320), isAvenue: false }
  expect(mergeTrafficRoadSpans([avenue(0, 320), avenue(321, 640)])).toHaveLength(2)
  expect(mergeTrafficRoadSpans([avenue(0, 320), avenue(320, 640, 18)])).toHaveLength(2)
  expect(mergeTrafficRoadSpans([avenue(0, 320), { ...avenue(320, 640), road: { ...avenue(320, 640).road, azimuth: .13 } }])).toHaveLength(2)
  expect(mergeTrafficRoadSpans([street, { ...street, spanStart: 320 }])).toHaveLength(2)
})

test('physical route identity survives reordered input, before visibility clipping', () => {
  const roads = [avenue(-900, 0).road, avenue(0, 900).road]
  const a = planTrafficRoadSpans(roads, 1000)[0]
  const b = planTrafficRoadSpans([...roads].reverse(), 1000)[0]
  expect(a.spanStart).toBe(-900)
  expect(a.spanLength).toBe(1800)
  expect(trafficRoadKey(a.road)).toBe(trafficRoadKey(b.road))
  expect(trafficRoadSeed(trafficRoadKey(a.road))).toBe(trafficRoadSeed(trafficRoadKey(b.road)))
  expect(trafficRoadSeed('other-road')).not.toBe(trafficRoadSeed(trafficRoadKey(a.road)))
})

test('moving visibility windows retain world position and velocity in both directions after multiple laps', () => {
  for (const direction of [1, -1] as const) {
    const previous = { spanStart: -1000, spanLength: 2000, direction, phaseMeters: 0, motion: { progress: 4370, speed: 8 } }
    const next = { ...previous, spanStart: -970, spanLength: 1940, motion: undefined }
    const motion = remapTrafficMotion(previous, next)!
    expect(motion.speed).toBe(8)
    const world = (start: number, length: number, progress: number) => start + (direction === 1 ? progress : length-progress)
    expect(world(next.spanStart, next.spanLength, motion.progress)).toBeCloseTo(world(-1000, 2000, 370), 8)
    expect(remapTrafficMotion(previous, { ...next, spanStart: 5000 })).toBeUndefined()
  }
})

test('span endpoints respect direction so remapping never wraps to the other end', () => {
  const span = { spanStart: 0, spanLength: 100, direction: 1 as const, phaseMeters: 0, motion: { progress: 0, speed: 8 } }
  expect(remapTrafficMotion(span, span)?.progress).toBe(0)
  expect(remapTrafficMotion({ ...span, direction: -1 }, { ...span, direction: -1 })?.progress).toBe(0)
  expect(remapTrafficMotion({ ...span, motion: { progress: 50, speed: 8 } }, { ...span, spanStart: 50, direction: -1 })).toBeUndefined()
})
