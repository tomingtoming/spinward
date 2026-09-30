import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import catalog from './generated/metroTransit.json'
import places from './generated/metroPlaces.json'
import { metroRailData, METRO_TRAM, type TramAsset } from './metroTransit'
import { metroSurfaceLocation } from './metroPlacement'
import { RailService, railPoint } from '../gameplay/railService'

const asset: TramAsset = JSON.parse(readFileSync(new URL('../../public/assets/transit/three-band-tram.json', import.meta.url), 'utf8'))
const study = { radius: catalog.radius, span: catalog.span,
  samples: catalog.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }

test('Arakawa line maps source metres through the same placement as the city', () => {
  const data = metroRailData(study, asset)!
  expect(data.lines.map(l => l.name)).toEqual(['都電荒川線'])
  const line = data.lines[0], source = catalog.lines[0], band = study.samples.find(s => s.id === 'east')!.band
  for (const i of [0, 400, source.points.length - 1]) {
    const [, x, y, h] = source.points[i], { azimuth, axial } = metroSurfaceLocation(band, x, y, study.radius)
    expect(line.points[i][1]).toBeCloseTo(azimuth * study.radius, 6)
    expect(line.points[i][2]).toBeCloseTo(axial, 6)
    expect(line.points[i][3]).toBe(h)
  }
  for (let i = 1; i < line.points.length; i++) expect(line.points[i][0]).toBeGreaterThan(line.points[i - 1][0])
  expect(source.maxGrade).toBeLessThanOrEqual(.08)
  const stops = data.stations
  expect(stops.length).toBeGreaterThanOrEqual(4) // RailService schedules from its fourth leg.
  for (let i = 1; i < stops.length; i++) expect(stops[i].s).toBeGreaterThan(stops[i - 1].s + asset.configuration.carLength)
  expect(stops.map(s => s.name)).toContain('王子駅前')
})

test('the line crosses the east–central window level on the viaduct and continues to Waseda', () => {
  const line = catalog.lines[0], [crossing] = line.crossings
  expect(crossing.x0).toBeCloseTo(1675.516, 3); expect(crossing.x1 - crossing.x0).toBeCloseTo(Math.PI / 3 * study.radius, 2)
  const over = line.points.filter(p => p[1] > crossing.x0 + 1e-3 && p[1] < crossing.x1 - 1e-3)
  expect(over.length).toBeGreaterThan(800)
  for (const p of over) { expect(p[3]).toBeCloseTo(crossing.height, 3); expect(p[2]).toBeCloseTo(crossing.y, 3) }
  for (let i = 1; i < line.points.length; i++) expect(Math.hypot(line.points[i][1] - line.points[i - 1][1], line.points[i][2] - line.points[i - 1][2])).toBeLessThan(4.01)
  expect(line.stations.map(s => s.band)).toEqual([...Array(12).fill('east'), ...Array(7).fill('central')])
  expect(line.stations.at(-1)!.name).toBe('早稲田')
})

test('a different crop frame never receives Tokyo track coordinates', () => {
  const moved = { ...study, samples: study.samples.map(s => s.id === 'east' ? { ...s, frame: { ...(s.frame as object), angle: 0 } } : s) }
  expect(metroRailData(moved, asset)).toBeNull()
  expect(metroRailData({ ...study, radius: 3100 }, asset)).toBeNull()
})

test('street tram service stops at every island and boards from its edge', () => {
  const data = metroRailData(study, asset)!, service = new RailService(data)
  expect(service.trains.length).toBe(METRO_TRAM.trainsPerLine)
  expect(data.configuration.maxSpeed).toBe(METRO_TRAM.maxSpeed)
  const visited = new Set<string>()
  for (let t = 0; t < service.tables[0].cycle; t += 1) {
    service.step(1)
    for (const train of service.trains) {
      expect(Number.isFinite(train.position[0] + train.position[1] + train.position[2])).toBe(true)
      const station = train.station
      if (!station || train.doorOpen < .95 || train.departureIn < 2) continue
      visited.add(station.id)
      const door = station.boarding[train.lane < 0 ? 0 : 1]
      // The door side faces the centreline: the island edge lies between the car and the other track.
      const track = railPoint(data.lines[0], station.s, train.lane)
      expect(Math.hypot(door[0] - station.position[0], door[1] - station.position[1])).toBeCloseTo(METRO_TRAM.islandEdge, 3)
      expect(Math.hypot(track[0] - door[0], track[1] - door[1])).toBeCloseTo(data.configuration.trackCentres - METRO_TRAM.islandEdge, 3)
      expect(service.nearestBoarding(door[0] / study.radius, door[1], door[2], study.radius)).not.toBeNull()
      expect(service.nearestBoarding(door[0] / study.radius, door[1], door[2] + .5, study.radius)).toBeNull()
    }
  }
  expect(visited.size).toBe(data.stations.length)
})

test('the Oji arrival is a short walk from its tram stop', () => {
  const oji = places.places.find(p => p.id === 'oji')!, stop = catalog.lines[0].stations.find(s => s.name === '王子駅前')!
  expect(Math.hypot(oji.spawn[0] - stop.center[0], oji.spawn[1] - stop.center[1])).toBeLessThan(60)
})
