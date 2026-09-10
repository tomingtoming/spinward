import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity, buildCityCollisionIndex, getCityGroundHeight, type CityBuilding } from './cityLayout'
import { createBuildingInterior, interiorCollisionBuildings, interiorDistance, planBuildingInteriors, selectBuildingExperienceLod, type InteriorKind } from './buildingInteriors'
import { collideSphereWithBuildings } from '../sim/cityCollision'

const radius = 3200
const fixture = (front: NonNullable<CityBuilding['front']>): CityBuilding => ({
  azimuth: 0, axial: 0, width: 18, depth: 18, height: 24, kind: 'block', tone: 0.8, front
})

const point = (front: NonNullable<CityBuilding['front']>, x: number, altitude: number, z: number) => {
  const t = front.axis === 'tangent' ? front.side * z : -front.side * x
  const a = front.axis === 'tangent' ? front.side * x : front.side * z
  return new THREE.Vector3((radius - altitude) * Math.cos(t / radius), a, (radius - altitude) * Math.sin(t / radius))
}

for (const axis of ['axial', 'tangent'] as const) for (const side of [-1, 1] as const) {
  describe(`${axis} ${side} facade`, () => {
    for (const kind of ['cafe', 'passage', 'court'] as Exclude<InteriorKind, 'apartment'>[]) {
      test(`${kind}: continuous street-to-room route, walls and ceilings`, () => {
        const front = { axis, side }, interior = createBuildingInterior(fixture(front), kind)
        const boxes = interiorCollisionBuildings(interior, radius)
        const index = buildCityCollisionIndex(boxes, radius, 1000)
        const collide = (x: number, y: number, z: number) => collideSphereWithBuildings(point(front, x, y, z), new THREE.Vector3(), index,
          { habitatRadius: radius, sphereRadius: 0.3, restitution: 0.5 })
        // Dense sweep through the entire doorway, not just its centre sample.
        for (let z = 12; z >= -5; z -= 0.2) {
          expect(collide(0, 1.5, z)).toBe(false)
          expect(collide(0.9, 1.5, z)).toBe(false)
        }
        expect(collide(8.9, 1.5, 0)).toBe(true)
        expect(collide(0, 4.1, 0)).toBe(kind !== 'court')
        expect(collide(0, 1.5, -8.9)).toBe(kind !== 'passage')
        expect(getCityGroundHeight(index, radius, 0, 0, 0)).toBe(0)
        if (kind !== 'court') expect(getCityGroundHeight(index, radius, 0, 0, 24)).toBe(24)
      })
    }
  })
}

test('entry identity is deterministic, distributed and disabled in tiny drums', () => {
  expect(planBuildingInteriors(planCity({ radius: 18, length: 80 }).buildings, 18).size).toBe(0)
  const plan = planCity({ radius, length: 40000, maxBuildings: 16000 })
  const first = planBuildingInteriors(plan.buildings, radius)
  const second = planBuildingInteriors([...plan.buildings].reverse(), radius)
  expect(first.size).toBeGreaterThan(30)
  expect(new Set([...first.values()].map(i => i.kind)).size).toBe(3)
  for (const [building, interior] of first) {
    expect(second.get(building)?.kind).toBe(interior.kind)
    expect(building.access).toBeDefined()
    expect(interiorCollisionBuildings(interior, radius).every(b => b.height > 0 && (b.baseHeight ?? 0) >= 0)).toBe(true)
  }
  expect([...first.keys()].some(b => Math.abs(b.azimuth) > 1)).toBe(true)
  expect([...first.keys()].some(b => Math.abs(b.axial) > 3000)).toBe(true)
})

test('a roof flyover does not load a room, but corners and the cylinder seam do', () => {
  const b = fixture({ axis: 'axial', side: 1 })
  b.azimuth = Math.PI * 2 - 0.001
  const interior = createBuildingInterior(b, 'court')
  expect(interiorDistance(interior, radius, 0.001, 8.9, 1.8)).toBe(0)
  expect(selectBuildingExperienceLod(interiorDistance(interior, radius, b.azimuth, 0, 100))).toBe(2)
})

test('five experience levels have hysteresis and retain a room while occupied', () => {
  expect([0, 30, 100, 500, 5000].map(d => selectBuildingExperienceLod(d))).toEqual([0, 1, 2, 3, 4])
  expect(selectBuildingExperienceLod(11, 0)).toBe(0)
  expect(selectBuildingExperienceLod(13, 0)).toBe(1)
  expect(selectBuildingExperienceLod(11, 1)).toBe(1)
  expect(selectBuildingExperienceLod(0, 4)).toBe(0)
})

test('a passage never opens its rear exit into a neighbouring building', () => {
  const building: CityBuilding = {
    ...fixture({ axis: 'axial', side: 1 }), urban: 1, tone: 0.5,
    access: { roadId: 'road-0', roadIndex: 0, width: 2, length: 2,
      entrance: { azimuth: 0, axial: 9 }, roadEdge: { azimuth: 0, axial: 11 } }
  }
  expect(planBuildingInteriors([building], radius).get(building)?.kind).toBe('passage')
  const neighbour: CityBuilding = { ...fixture({ axis: 'axial', side: 1 }), axial: -18.5 }
  expect(planBuildingInteriors([building, neighbour], radius).get(building)?.kind).toBe('cafe')
})
