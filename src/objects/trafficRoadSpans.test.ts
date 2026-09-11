import { expect, test } from 'bun:test'
import { mergeTrafficRoadSpans, type TrafficRoadSpan } from './trafficRoadSpans'

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
