import { expect, test } from 'bun:test'
import source from '../../assets/blender/izma-rail.json'
import type { ColonyRailData } from '../worlds/colonyRailData'
import { RailService } from './railService'

const data = source as unknown as ColonyRailData
test('all eighteen stops receive a continuous service with braking and doors only at rest', () => {
  const service = new RailService(data), visited = new Set<string>()
  expect(service.trains).toHaveLength(36)
  const previous = new Map(service.trains.map(t => [t.id, { position: [...t.position], speed: t.speed }]))
  const horizon = Math.ceil(Math.max(...service.tables.map(t => t.cycle)))
  let minimumSeparation = Infinity
  for (let second = 0; second < horizon; second++) {
    service.step(1)
    for (const train of service.trains) {
      const p = previous.get(train.id)!
      expect(train.position.every(Number.isFinite)).toBe(true)
      expect(Math.hypot(...train.position.map((n, i) => n - p.position[i])), train.id).toBeLessThan(34)
      expect(train.speed).toBeLessThanOrEqual(data.configuration.maxSpeed + 1e-6)
      expect(train.speed - p.speed, train.id).toBeLessThanOrEqual(data.configuration.acceleration + 1e-5)
      expect(p.speed - train.speed, train.id).toBeLessThanOrEqual(data.configuration.braking + 1e-5)
      if (train.station) { visited.add(train.station.id); expect(train.speed).toBe(0) }
      if (train.doorOpen > 0) { expect(train.station).not.toBeNull(); expect(train.speed).toBe(0) }
      p.position = [...train.position]; p.speed = train.speed
    }
    for (let i = 0; i < service.trains.length; i++) for (let j = i + 1; j < service.trains.length; j++) {
      const a = service.trains[i], b = service.trains[j]
      if (a.line !== b.line || Math.abs(a.s - b.s) > 20 || Math.abs(a.lane - b.lane) > data.configuration.carWidth) continue
      minimumSeparation = Math.min(minimumSeparation, Math.abs(a.s - b.s))
    }
  }
  expect([...visited].sort()).toEqual(data.stations.map(s => s.id).sort())
  expect(minimumSeparation, 'no overlapping vehicles through terminal crossovers').toBeGreaterThan(data.configuration.carLength)
})

test('boarding requires the open door, actual platform height and proximity on the correct strip', () => {
  const service = new RailService(data)
  service.step(2)
  for (const train of service.trains.filter(t => t.station)) {
    const station = train.station!, p = station.boarding[train.lane < 0 ? 0 : 1]
    expect(service.nearestBoarding(p[0] / 3200, p[1], p[2], 3200)).toBe(train)
    expect(service.nearestBoarding(p[0] / 3200 + Math.PI * 2, p[1], p[2], 3200)).toBe(train)
    expect(service.nearestBoarding(p[0] / 3200, p[1], p[2] + 3, 3200)).toBeNull()
    expect(service.nearestBoarding(p[0] / 3200, p[1] + 20, p[2], 3200)).toBeNull()
    expect(service.nearestBoarding(p[0] / 3200, p[1], p[2], 1600)).toBeNull()
  }
  const t = service.trains[0], p = t.station!.boarding[0]
  service.step(43)
  expect(service.nearestBoarding(p[0] / 3200, p[1], p[2], 3200)).toBeNull()
})

test('terminal reversal retains position and car orientation without a lane teleport', () => {
  const service = new RailService(data)
  for (const table of service.tables) for (const leg of table.legs.filter(l => l.to.id === table.line.stations[0] || l.to.id === table.line.stations.at(-1))) {
    const event = (leg.start + leg.duration - table.offset + table.cycle) % table.cycle
    service.time = event - .0001; service.step(0)
    const train = service.trains.find(t => t.line === table.line)!, p = [...train.position], tangent = [...train.tangent]
    service.step(.0002)
    expect(Math.hypot(...train.position.map((v, i) => v - p[i]))).toBeLessThan(.001)
    expect(Math.hypot(...train.tangent.map((v, i) => v - tangent[i]))).toBeLessThan(.01)
  }
})
