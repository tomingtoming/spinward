import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { planBandRail } from './transitPlan'
import { RailService, railPoint } from '../../gameplay/railService'

const asset = JSON.parse(readFileSync(new URL('../../../public/assets/transit/three-band-tram.json', import.meta.url), 'utf8'))
test('existing rail service visits all three band terminals and returns with bounded acceleration', () => {
  const terminals = ['tokyo', 'tama', 'azumino'].map((region, band) => ({ region, label: region,
    sample: { band, anchor: { local: [0, 1500] } }, point: [20, 18370], ground: band * 6 + 10 }))
  const data = planBandRail(terminals, asset), service = new RailService(data)
  service.time = -service.tables[0].offset; service.step(0)
  const visits: string[] = [], clock = service.time
  let previousSpeed = 0
  for (let t = 0; t < service.tables[0].cycle + 1; t += .25) {
    service.step(.25)
    const train = service.trains[0]
    if (train.station && visits.at(-1) !== train.station.id) visits.push(train.station.id)
    expect(Math.abs(train.speed - previousSpeed) / .25).toBeLessThanOrEqual(.90001)
    previousSpeed = train.speed
    expect(train.position.every(Number.isFinite)).toBe(true)
    expect(train.speed).toBeLessThanOrEqual(32.001)
  }
  expect(visits).toEqual(['tokyo', 'tama', 'azumino', 'tama', 'tokyo'])
  for (const station of data.stations) {
    expect(railPoint(data.lines[0], station.s)).toEqual(station.position)
    expect(station.entry[1]).toBe(19870)
  }
  service.time = clock + 3; service.step(0)
  const station = data.stations[0], train = service.trains[0]
  const board = station.boarding[train.lane < 0 ? 0 : 1]
  expect(service.nearestBoarding(board[0] / 3200, board[1], board[2], 3200)?.id).toBe(train.id)
  expect(service.nearestBoarding(board[0] / 3200, board[1] + 20, board[2], 3200)).toBeNull()
})
