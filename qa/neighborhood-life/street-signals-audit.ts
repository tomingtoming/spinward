import { planCity } from '../../src/objects/cityLayout'
import { StreetMarkingPlan } from '../../src/objects/streetMarkings'
import { StreetSignalPlan } from '../../src/objects/streetSignals'
import { createTrafficSignalIndex, isSignalledIntersection, routeTrafficSignals } from '../../src/objects/intersectionSignals'

const oldModule = process.env.OLD_MARKINGS
if (!oldModule) throw Error('OLD_MARKINGS must point to the pre-change StreetMarkingPlan module')
const OldMarkings = (await import(oldModule)).StreetMarkingPlan
const median = (a: number[]) => { const s = [...a].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 }
const report = []
for (const maxBuildings of [16000, 18000, 64000]) {
  const city = planCity({ radius: 3200, length: 40000, maxBuildings }), network = city.streetNetwork!
  const oldTimes: number[] = [], times: number[] = []
  let signals: StreetSignalPlan | undefined
  // Alternate after one warm run. Graph generation is already paid in both versions.
  for (let run = 0; run < 5; run++) {
    let start = performance.now()
    const old = new OldMarkings(network)
    createTrafficSignalIndex(city.intersections)
    if (!old) throw Error('Missing baseline')
    if (run) oldTimes.push(performance.now() - start)
    start = performance.now()
    signals = new StreetSignalPlan(new StreetMarkingPlan(network), city.intersections)
    createTrafficSignalIndex([], signals, city.roads)
    if (run) times.push(performance.now() - start)
  }
  const s = signals!, legacy = city.intersections.filter(isSignalledIntersection)
  const start = performance.now(), all = s.nearby(0, 0, 50000, 100000)
  const exhaustiveMs = performance.now() - start
  const index = createTrafficSignalIndex([], s, city.roads)
  const focus = [0, Math.PI * 2 / 3, Math.PI * 4 / 3].map(azimuth => {
    const first = performance.now(), approaches = s.nearby(azimuth, 321.29, 420)
    return { azimuth, heads: approaches.length, stopPieces: s.paint(approaches).length, queryMs: performance.now() - first }
  })
  if (legacy.some(c => !s.legacyFallbacks.includes(c) && !s.controlsJunction(c.azimuth, c.axial))) throw Error('Legacy traffic protection lost')
  const reference = city.roads.find(r => r.id === 'road-7')!
  const stops = routeTrafficSignals(index, reference, 3200, 250, 150)
  if (stops.length !== 2 || stops.some(s => !s.control)) throw Error('Reference intersection did not migrate')
  report.push({ maxBuildings, roads: network.streets.length, graphComponents: new Set(network.components).size,
    oldSetupMs: median(oldTimes), setupMs: median(times), oldSamples: oldTimes, samples: times,
    legacyJunctions: legacy.length, migratedLegacy: legacy.length - s.legacyFallbacks.length,
    legacyFallbacks: s.legacyFallbacks.map(c => ({ azimuth: c.azimuth, axial: c.axial })),
    nativeJunctions: new Set(all.map(a => a.crossing.node)).size, nativeApproaches: all.length,
    exhaustiveMs, focus, referenceStops: stops })
}
console.log(JSON.stringify(report, null, 2))
