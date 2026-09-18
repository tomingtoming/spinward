import { expect, test } from 'bun:test'
import { ColonyMotionGate, type RegionalReadiness } from './colonyMotionGate'
import type { ColonyFocus } from '../worlds/colonyRegionStore'

const here: ColonyFocus = { azimuth: 0, axial: 0, distance: 256 }
const there: ColonyFocus = { azimuth: 2, axial: 12000, distance: 256 }
function source() {
  const status = { failed: [] as { attempts: number; message: string }[] }
  const requested: ColonyFocus[][] = [], ready = new Set<number>()
  let retries = 0
  return { status, requested, ready, get retries() { return retries },
    prepareRegions(foci: readonly ColonyFocus[]) {
      requested.push([...foci]); return foci.every(f => ready.has(f.axial))
    },
    getRegionalStatus: () => status,
    retryRegions() { retries++; status.failed.length = 0 }
  }
}

test('arrival waits for current and destination floors, then applies exactly once', () => {
  const world = source(), gate = new ColonyMotionGate(); let applied = 0
  gate.queue(world, there, () => { applied++ })
  expect(gate.step(world, [here])).toBe(false)
  expect(world.requested.at(-1)).toEqual([here, there])
  world.ready.add(there.axial)
  expect(gate.step(world, [here])).toBe(false)
  expect(applied).toBe(0)
  world.ready.add(here.axial)
  expect(gate.step(world, [here])).toBe(true)
  expect(applied).toBe(1)
  expect(gate.card).toBeNull()
  gate.step(world, [there]); expect(applied).toBe(1)
  expect(world.requested.at(-1)).toEqual([there])
})

test('another destination cancels the first even if its data becomes ready later', () => {
  const world = source(), gate = new ColonyMotionGate(), applied: string[] = []
  gate.queue(world, there, () => applied.push('first'))
  gate.step(world, [here])
  gate.queue(world, here, () => applied.push('second'))
  world.ready.add(there.axial)
  expect(gate.step(world, [here])).toBe(false)
  world.ready.add(here.axial); gate.step(world, [here])
  expect(applied).toEqual(['second'])
})

test('world identity cancels an old arrival while retaining the new readiness gate', () => {
  const oldWorld = source(), newWorld = source(), gate = new ColonyMotionGate(); let applied = false
  gate.queue(oldWorld, there, () => { applied = true })
  oldWorld.ready.add(there.axial)
  expect(gate.step(newWorld, [here])).toBe(false)
  newWorld.ready.add(here.axial)
  expect(gate.step(newWorld, [here])).toBe(true)
  expect(gate.pendingArrival).toBe(false); expect(applied).toBe(false)
  expect(newWorld.requested.at(-1)).toEqual([here])
})

test('failure pauses movement and explicit reselection retries without applying prematurely', () => {
  const world = source(), gate = new ColonyMotionGate(); let applied = 0
  gate.queue(world, there, () => { applied++ })
  world.status.failed.push({ attempts: 3, message: 'Corrupt colony data' })
  expect(gate.step(world, [here])).toBe(false)
  expect(gate.state).toBe('failed'); expect(gate.error).toContain('Corrupt')
  expect(gate.card?.title).toBe('Area unavailable'); expect(applied).toBe(0)
  gate.queue(world, there, () => { applied++ })
  expect(world.retries).toBe(2); expect(gate.state).toBe('loading')
  expect(gate.step(world, [here])).toBe(false)
  world.ready.add(here.axial); world.ready.add(there.axial)
  expect(gate.step(world, [here])).toBe(true); expect(applied).toBe(1)
})

test('resident worlds apply immediately and a switch to one cannot apply a stale arrival', () => {
  const world = source(), gate = new ColonyMotionGate(); let applied = 0
  const resident: RegionalReadiness = { getRegionalStatus: () => null,
    prepareRegions: () => true, retryRegions: () => { throw Error('Resident world has no retry') } }
  gate.queue(world, there, () => { applied += 100 })
  expect(gate.step(resident, [here])).toBe(true); expect(applied).toBe(0)
  gate.queue(resident, there, () => { applied++ })
  expect(applied).toBe(1); expect(gate.pendingArrival).toBe(false)
})

test('a rejected budget never applies an arrival; cancellation permits recovery', () => {
  const world = source(), gate = new ColonyMotionGate(); let applied = false
  world.prepareRegions = () => { throw Error('Colony arrival exceeds regional budget') }
  gate.queue(world, there, () => { applied = true })
  expect(gate.step(world, [here])).toBe(false)
  expect(gate.state).toBe('failed'); expect(applied).toBe(false)
  expect(gate.pendingArrival).toBe(true)
  gate.cancel(); expect(gate.pendingArrival).toBe(false); expect(gate.card).toBeNull()
})

test('a failed floor resolution remains unavailable instead of clearing the destination', () => {
  const world = source(), gate = new ColonyMotionGate()
  world.ready.add(here.axial); world.ready.add(there.axial)
  gate.queue(world, there, () => { throw Error('Arrival destination changed') })
  expect(gate.step(world, [here])).toBe(false)
  expect(gate.step(world, [here])).toBe(false)
  expect(gate.pendingArrival).toBe(true); expect(gate.state).toBe('failed')
})
