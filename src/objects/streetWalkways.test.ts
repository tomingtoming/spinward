import { expect, test } from 'bun:test'
import type { CityRoad } from './cityLayout'
import { planStreetWalkways } from './streetWalkways'
import { buildRoadTileSurface } from './roadTileSurface'

const avenue: CityRoad = { azimuth: 0, axial: 0, tangentWidth: 6, axialLength: 100, kind: 'local' }
const street: CityRoad = { azimuth: 0, axial: 0, tangentWidth: 100, axialLength: 12, kind: 'collector' }

for (const layout of ['crossroad', 'tee', 'alley', 'seam'] as const) {
  test(`sidewalks stop at every carriageway: ${layout}`, () => {
    const radius = 3200, focus = layout === 'seam' ? Math.PI : 0
    const roads = [{ ...avenue, axial: layout === 'tee' ? 50 : 0, azimuth: focus - 0.001 },
      { ...street, azimuth: layout === 'seam' ? -Math.PI + 0.001 : 0,
        ...(layout === 'alley' ? { kind: 'alley' as const, axialLength: 4 } : {}) }]
    const pieces = planStreetWalkways(roads, radius, focus, 0, 60)
    expect(pieces.length).toBeGreaterThan(0)
    for (const p of pieces) {
      expect(p.t0).toBeGreaterThanOrEqual(-60)
      expect(p.t1).toBeLessThanOrEqual(60)
      expect(p.a0).toBeGreaterThanOrEqual(-60)
      expect(p.a1).toBeLessThanOrEqual(60)
      for (const r of roads) {
        const t = Math.atan2(Math.sin(r.azimuth - focus), Math.cos(r.azimuth - focus)) * radius
        const dt = Math.min(p.t1, t + r.tangentWidth / 2) - Math.max(p.t0, t - r.tangentWidth / 2)
        const da = Math.min(p.a1, r.axial + r.axialLength / 2) - Math.max(p.a0, r.axial - r.axialLength / 2)
        expect(dt > 1e-5 && da > 1e-5).toBe(false)
      }
    }
  })
}

for (const kind of ['crossroad', 'tee', 'bend', 'crossing'] as const) {
  test(`${kind} places zebra only on open junction arms, connecting sidewalk bands`, () => {
    for (const [along, cross, carriageX, carriageZ] of [[25.5, 17, 19.5, 12], [17, 10, 12, 6]]) {
      const g = buildRoadTileSurface({ kind, alongMeters: along, crossMeters: cross,
        alongCarriagewayMeters: carriageX, crossCarriagewayMeters: carriageZ,
        crossingAtStart: true, crossingAtEnd: true,
        azimuth: 0, axial: 0, quarterTurns: 0, distance: 0 })
      const p = g.getAttribute('position'), arms = new Set<string>()
      for (let i = 0; i < p.count; i += 6) {
        if (p.getY(i) < 0.025) continue
        const x = (p.getX(i) + p.getX(i + 2)) / 2 * along
        const z = (p.getZ(i) + p.getZ(i + 2)) / 2 * cross
        const onX = Math.abs(x) > carriageX / 2
        arms.add(onX ? (x < 0 ? '-x' : '+x') : (z < 0 ? '-z' : '+z'))
        for (let j = i; j < i + 6; j++) {
          const vx = Math.abs(p.getX(j) * along), vz = Math.abs(p.getZ(j) * cross)
          expect(vx).toBeLessThanOrEqual(along / 2 + 1e-5)
          expect(vz).toBeLessThanOrEqual(cross / 2 + 1e-5)
          expect(onX ? vz : vx).toBeLessThanOrEqual((onX ? carriageZ : carriageX) / 2 + 1e-5)
          expect(onX ? vx : vz).toBeGreaterThan((onX ? carriageX : carriageZ) / 2)
        }
      }
      const expected = kind === 'crossroad' ? ['-x', '+x', '-z', '+z']
        : kind === 'tee' ? ['-x', '+x', '+z'] : kind === 'bend' ? ['-x', '+z'] : []
      expect([...arms].sort()).toEqual(expected.sort())
      g.dispose()
    }
  })
}
