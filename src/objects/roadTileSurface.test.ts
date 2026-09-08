import { expect, test } from 'bun:test'
import { buildRoadTileSurface } from './roadTileSurface'
import { getStreetProfile, streetLaneCenters, streetLaneDividers } from './streetProfile'
import { planRoadTilePlacements } from './roadTiles'

test('lane counts, road width, dividers and traffic centres share one profile', () => {
  expect(getStreetProfile('arterial').carriageway).toBe(19.5)
  expect(streetLaneCenters('arterial', 1)).toEqual([1.625, 4.875, 8.125])
  expect(streetLaneCenters('arterial', -1)).toEqual([-1.625, -4.875, -8.125])
  expect(streetLaneDividers('arterial')).toEqual([3.25, 6.5])
  expect(streetLaneCenters('collector', 1)).toEqual([1.5, 4.5])
  expect(streetLaneCenters('local', 1)).toEqual([1.5])
  expect(streetLaneDividers('local')).toEqual([])
  expect(getStreetProfile('arterial', 18).carriageway).toBe(6)
  expect(streetLaneCenters('arterial', 1, 18)).toEqual([1.5])
})

for (const roadKind of ['arterial', 'collector', 'local'] as const) {
  test(`near ${roadKind} paint has the specified lane separation and sidewalk width`, () => {
    const p = getStreetProfile(roadKind)
    const cross = p.carriageway + 2 * p.sidewalk
    const geometry = buildRoadTileSurface({ kind: 'straight', roadKind,
      alongMeters: 24, crossMeters: cross, crossCarriagewayMeters: p.carriageway,
      azimuth: 0, axial: 0, quarterTurns: 0, distance: 0 })
    const positions = geometry.getAttribute('position')
    const dashCentres = new Set<number>()
    let outer = 0
    for (let i = 0; i < positions.count; i += 6) {
      const xs = [], zs = []
      for (let j = 0; j < 6; j++) {
        xs.push(positions.getX(i + j) * 24)
        zs.push(positions.getZ(i + j) * cross)
      }
      outer = Math.max(outer, ...zs.map(Math.abs))
      const width = Math.max(...zs) - Math.min(...zs)
      const length = Math.max(...xs) - Math.min(...xs)
      if (Math.abs(width - 0.12) < 1e-5 && Math.abs(length - 3) < 1e-5)
        dashCentres.add(Math.round((Math.max(...zs) + Math.min(...zs)) * 500) / 1000)
    }
    expect(outer).toBeCloseTo(cross / 2)
    expect([...dashCentres].sort((a, b) => a - b)).toEqual(roadKind === 'arterial' ? [-6.5, -3.25, 3.25, 6.5] : roadKind === 'collector' ? [-3, 3] : [0])
    geometry.dispose()
  })
}

test('junction and approach geometry remains finite for mixed lane counts', () => {
  const placements = planRoadTilePlacements({ radius: 3200, focusAzimuth: 0, focusAxial: 0,
    rangeMeters: 100, roads: [
      { azimuth: 0, axial: 0, tangentWidth: 12, axialLength: 400, kind: 'arterial' },
      { azimuth: 0, axial: 0, tangentWidth: 400, axialLength: 5.5, kind: 'local' }
    ] })
  const junction = placements.find(p => p.kind === 'crossroad')!
  expect(junction.alongMeters).toBe(18)
  expect(junction.crossMeters).toBe(9.5)
  for (const placement of placements) {
    const geometry = buildRoadTileSurface(placement)
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    geometry.dispose()
  }
})
