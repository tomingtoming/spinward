import { expect, test } from 'bun:test'
import { advanceTraffic } from './trafficMotion'
import { createTrafficSignalIndex, routeTrafficSignals, signalAspect, signalPhaseOffset, signalStopLineOffset, trafficSignalGap, type SignalRoad } from './intersectionSignals'
import type { CityIntersection } from './cityLayout'

const crossing: CityIntersection = { azimuth: 0, axial: 0, avenueKind: 'arterial', streetKind: 'local', avenueWidth: 18, streetWidth: 10 }

test('opposite roads never share a green and get clearance after each amber', () => {
  for (const offset of [0, .3, 17, -53]) for (let time = -64; time < 96; time += .05) {
    const avenue = signalAspect(time, offset, 'avenue'), street = signalAspect(time, offset, 'street')
    expect(avenue === 0 && street === 0).toBe(false)
    expect(avenue === 1 && street !== 2).toBe(false)
    expect(street === 1 && avenue !== 2).toBe(false)
  }
  for (const time of [13, 14, 15.99, 29, 30, 31.99]) {
    expect(signalAspect(time, 0, 'avenue')).toBe(2)
    expect(signalAspect(time, 0, 'street')).toBe(2)
  }
})

test('both road directions stop their noses behind the painted line and resume on green', () => {
  for (const kind of ['avenue', 'street'] as SignalRoad[]) for (const direction of [-1, 1]) {
    const lineOffset = signalStopLineOffset(crossing, kind)
    const stops = [{ along: 0, lineOffset, phase: 0, crossing }]
    const start = -direction * 65
    let motion = { progress: 0, speed: 12 }
    const red = kind === 'avenue' ? 20 : 4, green = kind === 'avenue' ? 4 : 20
    for (let frame = 0; frame < 900; frame++) {
      const along = start + direction * motion.progress
      motion = advanceTraffic(motion, 1/60, 12, trafficSignalGap(stops, kind, along, direction, motion.speed, red))
    }
    const centreDistance = 65 - motion.progress
    expect(centreDistance - lineOffset).toBeCloseTo(2.7, 5)
    expect(motion.speed).toBeLessThan(.01)
    const stopped = motion.progress
    for (let frame = 0; frame < 300; frame++) motion = advanceTraffic(motion, 1/60, 12, trafficSignalGap(stops, kind, start + direction * motion.progress, direction, motion.speed, green))
    expect(motion.progress - stopped).toBeGreaterThan(15)
  }
})

test('amber permits nearby moving cars to clear, while a distant car brakes and a stopped car stays put', () => {
  const lineOffset = signalStopLineOffset(crossing, 'avenue')
  const stops = [{ along: 0, lineOffset, phase: 0, crossing }]
  expect(trafficSignalGap(stops, 'avenue', -lineOffset-10, 1, 12, 11)).toBe(Infinity)
  expect(trafficSignalGap(stops, 'avenue', -lineOffset-50, 1, 12, 11)).toBeLessThan(Infinity)
  expect(trafficSignalGap(stops, 'avenue', -lineOffset-2.7, 1, 0, 11)).toBeCloseTo(3.2)
  expect(trafficSignalGap(stops, 'avenue', -lineOffset+1, 1, 12, 20)).toBe(Infinity)
})

test('route indexing selects its own crossings and handles the cylindrical seam', () => {
  const radius = 3200
  const same = { ...crossing, azimuth: Math.PI, axial: 120 }
  const distant = { ...crossing, azimuth: .2, axial: 120 }
  const quiet = { ...same, axial: 240, avenueKind: 'local' as const }
  const index = createTrafficSignalIndex([same, distant, quiet, { ...same, axial: 900 }])
  const avenue = routeTrafficSignals(index, { azimuth: -Math.PI, axial: 0, tangentWidth: 18, axialLength: 400, kind: 'arterial' }, radius, -200, 400)
  expect(avenue.map(s => s.crossing)).toEqual([same])
  expect(avenue[0].phase).toBe(signalPhaseOffset(same))
  const street = routeTrafficSignals(index, { azimuth: Math.PI-.02, axial: 120, tangentWidth: 300, axialLength: 10, kind: 'local' }, radius, -150, 300)
  expect(street.map(s => s.crossing)).toEqual([same])
  const circumference = 2 * Math.PI * radius
  const stop = { along: -circumference/2+6, lineOffset: 14, phase: 0, crossing }
  expect(trafficSignalGap([stop], 'street', circumference/2-40, 1, 10, 4, circumference)).toBeCloseTo(46-14-2.7+3.2)
})
