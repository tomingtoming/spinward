import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity, type CityBuilding, type CityRoad } from './cityLayout'
import { fitSuburbanHouse, suburbanLotBoundary } from './buildingAssets'
import { certifyStreetAccess } from './streetAccess'
import { StreetAccessLayer } from './streetAccessLayer'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const building = (extra: Partial<CityBuilding> = {}): CityBuilding => ({
  azimuth: 0, axial: 0, width: 4, depth: 4, height: 10, tone: 0.5,
  kind: 'block', front: { axis: 'axial', side: 1 }, ...extra
})
const road = (extra: Partial<CityRoad> = {}): CityRoad => ({
  azimuth: 0, axial: 6, tangentWidth: 20, axialLength: 4, kind: 'arterial', ...extra
})

describe('certified street access', () => {
  test('records exact entrance and road edge, not a nearest-road guess', () => {
    const result = certifyStreetAccess([building()], [road()], 100, 3)
    expect(result.rejected).toHaveLength(0)
    expect(result.buildings[0].access).toEqual({ roadId: 'road-0', roadIndex: 0,
      entrance: { azimuth: 0, axial: 2 }, roadEdge: { azimuth: 0, axial: 4 }, width: 2, length: 2 })
  })
  test('rejects missing fronts, wrong-side roads, corner-only frontage and road overlaps', () => {
    for (const [b, r, reason] of [
      [building({ front: undefined }), road(), 'missing-front'],
      [building(), road({ axial: -6 }), 'no-connected-frontage'],
      [building(), road({ azimuth: 0.105 }), 'no-connected-frontage'],
      [building(), road({ axial: 1 }), 'road-overlap']
    ] as const) {
      const result = certifyStreetAccess([b], [r], 100, 3)
      expect(result.buildings).toHaveLength(0)
      expect(result.rejected[0].reason).toBe(reason)
    }
  })
  test('an isolated alley is not access; a connector makes it access', () => {
    const roads = [road({ kind: 'alley' }), road({ axial: 30 })]
    expect(certifyStreetAccess([building()], roads, 100, 3).buildings).toHaveLength(0)
    roads.push(road({ azimuth: 0.08, axial: 18, tangentWidth: 3, axialLength: 24, kind: 'local' }))
    expect(certifyStreetAccess([building()], roads, 100, 3).buildings).toHaveLength(1)
  })
  test('rejects a path crossing another footprint', () => {
    const blocker = building({ axial: 3, width: 1, depth: 0.5 })
    const result = certifyStreetAccess([building(), blocker], [road()], 100, 3)
    expect(result.rejected.some(r => r.reason === 'blocked-path' && r.building.axial === 0)).toBe(true)
  })
  test('road rectangles touching only at a corner are not connected', () => {
    const roads = [road({ kind: 'alley' }), road({ azimuth: 0.2, axial: 10 })]
    expect(certifyStreetAccess([building()], roads, 100, 3).buildings).toHaveLength(0)
  })
  test('works across the cylinder seam', () => {
    const b = building({ azimuth: Math.PI - 0.03, front: { axis: 'tangent', side: 1 } })
    const r = road({ azimuth: -Math.PI + 0.03, axial: 0, tangentWidth: 4, axialLength: 20 })
    expect(certifyStreetAccess([b], [r], 100, 3).buildings[0].access.length).toBeCloseTo(2)
  })
  for (const [radius, length] of [[18, 120], [3200, 40000], [30000, 2000]]) {
    test(`every generated building has a fitted, forward, full-width road connection (${radius})`, () => {
      for (const seed of [42, 73]) {
        const plan = planCity({ radius, length, seed })
        expect(plan.buildings.length).toBeGreaterThan(0)
        for (const b of plan.buildings) {
          expect(b.access).toBeDefined()
          expect(b.front).toBeDefined()
          const a = b.access!, f = b.front!, r = plan.roads[a.roadIndex]
          expect(r.id).toBe(a.roadId)
          const fit = fitSuburbanHouse(b)
          const x = b.azimuth + (fit?.tangentOffset ?? 0) / radius
          const y = b.axial + (fit?.axialOffset ?? 0)
          const w = fit?.tangentExtent ?? b.width, d = fit?.axialExtent ?? b.depth
          expect(wrap(a.entrance.azimuth - x) * radius).toBeCloseTo(f.axis === 'tangent' ? f.side * w / 2 : 0, 5)
          expect(a.entrance.axial - y).toBeCloseTo(f.axis === 'axial' ? f.side * d / 2 : 0, 5)
          const dx = wrap(a.roadEdge.azimuth - a.entrance.azimuth) * radius
          const dy = a.roadEdge.axial - a.entrance.axial
          expect((f.axis === 'tangent' ? dx : dy) * f.side).toBeCloseTo(a.length, 5)
          expect(f.axis === 'tangent' ? dy : dx).toBeCloseTo(0, 5)
          const rx = wrap(a.roadEdge.azimuth - r.azimuth) * radius
          const ry = a.roadEdge.axial - r.axial
          expect(Math.abs(f.axis === 'tangent' ? rx : ry)).toBeCloseTo((f.axis === 'tangent' ? r.tangentWidth : r.axialLength) / 2, 5)
          expect(Math.abs(f.axis === 'tangent' ? ry : rx) + a.width / 2).toBeLessThanOrEqual((f.axis === 'tangent' ? r.axialLength : r.tangentWidth) / 2 + 1e-5)
          if (fit) {
            const pathX = wrap(a.entrance.azimuth - b.azimuth) * radius + dx / 2
            const pathY = a.entrance.axial - b.axial + dy / 2
            for (const segment of suburbanLotBoundary(b, fit).segments) {
              const overlapX = Math.abs(pathX - segment.tangentOffset) <
                ((f.axis === 'tangent' ? a.length : a.width) + segment.tangentExtent) / 2 - 1e-5
              const overlapY = Math.abs(pathY - segment.axialOffset) <
                ((f.axis === 'axial' ? a.length : a.width) + segment.axialExtent) / 2 - 1e-5
              expect(overlapX && overlapY).toBe(false)
            }
          }
        }
      }
    })
  }
  test('pavement and diagnostics rebuild without accumulating geometry', () => {
    const parent = new THREE.Group(), layer = new StreetAccessLayer(parent, true)
    const plan = planCity({ radius: 3200, length: 40000 })
    layer.rebuild(plan, 3200, 0, 0)
    const count = layer.group.children.length
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(4)
    layer.rebuild(plan, 3200, 0, 0)
    expect(layer.group.children.length).toBe(count)
    for (const child of layer.group.children as THREE.Mesh[]) {
      const positions = child.geometry.getAttribute('position').array
      expect(Array.from(positions).every(Number.isFinite)).toBe(true)
    }
    layer.dispose()
    expect(parent.children).toHaveLength(0)
  })
})
