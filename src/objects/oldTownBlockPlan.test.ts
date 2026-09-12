import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { planCity, getArrivalSquare } from './cityLayout'
import { colonyRoofSurface, colonyRoofUnits } from './colonyRoofs'
import { colonyBuildingDesign } from './colonyBuildingDesign'
import { oldTownColliders, oldTownPavingColliders, oldTownLod, planOldTownBlock, planOldTownCourt, OLD_TOWN_LOT_LIMIT } from './oldTownBlockPlan'
import { collideSphereWithBuildings } from '../sim/cityCollision'

describe('Old Town services', () => {
  for (const maxBuildings of [16000, 18000, 64000]) test(`keeps access, roofs and equipment clear at budget ${maxBuildings}`, () => {
    const radius = 3200, length = 40000, plan = planCity({ radius, length, maxBuildings })
    const before = JSON.stringify(plan)
    const lots = planOldTownBlock(plan.buildings, plan.roads, radius, length)
    expect(lots.length).toBeGreaterThan(0); expect(lots.length).toBeLessThanOrEqual(OLD_TOWN_LOT_LIMIT)
    expect(JSON.stringify(plan)).toBe(before)
    expect(lots).toEqual(planOldTownBlock(plan.buildings, plan.roads, radius, length))
    expect(planOldTownBlock(plan.buildings, plan.roads, radius, length, new Map(lots.map(l => [l.spec.building, true]))).every(l => !lots.some(x => x.spec.building === l.spec.building))).toBe(true)
    let tanks = 0
    for (const lot of lots) {
      const b = lot.spec.building, roof = colonyRoofSurface(lot.spec), roofParts = lot.parts.filter(p => p.range === 'roof')
      expect(b.oldTown).toBeGreaterThan(.5)
      expect(b.axial).toBeLessThan(getArrivalSquare(radius, length)!.axial)
      for (const p of roofParts) {
        expect(roof).not.toBeNull()
        expect(p.y).toBeCloseTo(roof!.y + roof!.h / 2, 8)
        expect(Math.abs(p.x - roof!.x) + p.w / 2).toBeLessThanOrEqual(roof!.w / 2 - 1)
        expect(Math.abs(p.z - roof!.z) + p.d / 2).toBeLessThanOrEqual(roof!.d / 2 - 1)
        expect(Math.abs(p.x - roof!.x) >= p.w / 2 + 1.1 || Math.abs(p.z - roof!.z) >= p.d / 2 + 1.1).toBe(true)
        for (const other of [...colonyRoofUnits(lot.spec, colonyBuildingDesign(b)).map(u => ({ ...u, w: u.yaw ? u.d : u.w, d: u.yaw ? u.w : u.d })), ...roofParts.filter(o => o !== p)])
          expect(Math.abs(p.x - other.x) >= (p.w + other.w) / 2 + .8 - 1e-8 || Math.abs(p.z - other.z) >= (p.d + other.d) / 2 + .8 - 1e-8).toBe(true)
        if (p.solid) tanks++
      }
      // Details live on the rear wall, below sills or on the corner. They do
      // not extend into an entrance on the +Z frontage.
      for (const p of lot.parts.filter(p => p.range === 'street')) {
        expect(p.z).toBeLessThan(0)
        expect(p.w).toBeGreaterThan(0); expect(p.h).toBeGreaterThan(0)
      }
      const door = lot.parts.find(p => p.module === 'box' && p.h === 2.06)
      if (door) for (const pipe of lot.parts.filter(p => p.h === .035))
        expect(Math.abs(pipe.x - door.x) - pipe.w / 2).toBeGreaterThan(door.w / 2 + .1)
      const canopy = lot.parts.find(p => p.module === 'entry_canopy')
      if (canopy) {
        expect(door).toBeDefined()
        expect(canopy.y).toBeGreaterThan(2.1)
        expect(canopy.y + canopy.h).toBeLessThan(colonyBuildingDesign(b).use.groundHeight)
        const wallBack = door!.z + .065
        expect(canopy.z + canopy.d / 2).toBeGreaterThanOrEqual(wallBack)
        expect(canopy.x).toBe(door!.x)
      }
      for (const light of lot.parts.filter(p => p.light)) {
        expect(door).toBeDefined()
        expect(light.y + light.h / 2).toBeLessThan(colonyBuildingDesign(b).use.groundHeight)
        expect(light.range).toBe('street')
        if (light.light === 'wash') expect(light.x - light.w / 2).toBeGreaterThan(door!.x + .53)
      }
      const solid = lot.parts.filter(p => p.solid), colliders = oldTownColliders([lot], radius)
      solid.forEach((p, i) => {
        const c = colliders[i], side = b.front!.side, tangent = b.front!.axis === 'tangent'
        const h = p.y + p.h / 2, across = side * (tangent ? p.z : -p.x)
        const expected = new THREE.Vector3(Math.cos(b.azimuth) * (radius - h) - Math.sin(b.azimuth) * across,
          b.axial + side * (tangent ? p.x : p.z), Math.sin(b.azimuth) * (radius - h) + Math.cos(b.azimuth) * across)
        const r = radius - c.baseHeight - c.height / 2
        const centre = new THREE.Vector3(Math.cos(c.azimuth) * r, c.axial, Math.sin(c.azimuth) * r)
        expect(centre.distanceTo(expected)).toBeLessThan(1e-8)
      })
    }
    const colliders = oldTownColliders(lots, radius)
    expect(colliders.length).toBe(tanks); expect(tanks).toBeGreaterThan(0)
    for (const b of colliders) {
      const r = radius - b.baseHeight! - b.height / 2
      const p = new THREE.Vector3(Math.cos(b.azimuth) * r, b.axial, Math.sin(b.azimuth) * r)
      expect(collideSphereWithBuildings(p, new THREE.Vector3(), [b], { habitatRadius: radius, sphereRadius: .18, restitution: 0 })).toBe(true)
      const ground = new THREE.Vector3(Math.cos(b.azimuth) * (radius - 1.8), b.axial, Math.sin(b.azimuth) * (radius - 1.8))
      expect(collideSphereWithBuildings(ground, new THREE.Vector3(), [b], { habitatRadius: radius, sphereRadius: .18, restitution: 0 })).toBe(false)
    }
  })
  test('small habitats do not get a forced Old Town', () => {
    const plan = planCity({ radius: 250, length: 2000, maxBuildings: 4000 })
    expect(planOldTownBlock(plan.buildings, plan.roads, 250, 2000)).toEqual([])
  })
  test('the service court joins the street through a clear gap and declines blocked sites', () => {
    const radius = 3200, length = 40000, plan = planCity({ radius, length, maxBuildings: 64000 })
    const lots = planOldTownBlock(plan.buildings, plan.roads, radius, length)
    const paving = planOldTownCourt(lots, plan.buildings, plan.roads, radius, length)
    expect(paving.length).toBe(2)
    const [court, path] = paving
    const slabs = oldTownPavingColliders(paving)
    expect(slabs.length).toBe(2)
    expect(slabs.every(b => b.height === .12 && b.baseHeight === 0 && b.groundMargin === 0)).toBe(true)
    expect(path.azimuth).toBe(court.azimuth)
    expect(path.axial - path.axialLength / 2).toBeCloseTo(court.axial + court.axialLength / 2, 6)
    for (const p of paving) for (const b of plan.buildings)
      expect(Math.abs(p.azimuth - b.azimuth) * radius >= (p.tangentWidth + b.width) / 2 + .25 - 1e-7 || Math.abs(p.axial - b.axial) >= (p.axialLength + b.depth) / 2 + .25 - 1e-7).toBe(true)
    const obstacle = { ...lots[0].spec.building, azimuth: path.azimuth, axial: path.axial, width: 2, depth: path.axialLength, height: 1 }
    expect(planOldTownCourt(lots, plan.buildings, plan.roads, radius, length, [obstacle])).toEqual([])
  })
  test('LOD keeps rooftop silhouettes after wall details leave, without threshold chatter', () => {
    expect(oldTownLod(86, 0)).toBe(0); expect(oldTownLod(101, 0)).toBe(1)
    expect(oldTownLod(90, 1)).toBe(1); expect(oldTownLod(84, 1)).toBe(0)
    expect(oldTownLod(260, 1)).toBe(1); expect(oldTownLod(281, 1)).toBe(2)
    expect(oldTownLod(701, 2)).toBe(2); expect(oldTownLod(781, 2)).toBe(3)
    expect(oldTownLod(750, 3)).toBe(3)
  })
  test('Blender export has metric-origin modules, vertex colours and a bounded mesh budget', () => {
    const bytes = readFileSync(new URL('../../public/assets/buildings/old-town-services.glb', import.meta.url))
    expect(bytes.length).toBeLessThan(100_000)
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
    const names = ['water_tank', 'water_tank_lod', 'header_tank', 'meter_bank', 'laundry', 'entry_canopy']
    for (const name of names) {
      const node = json.nodes.find((n: { name: string }) => n.name === name)
      expect(node).toBeDefined()
      const primitives = json.meshes[node.mesh].primitives
      expect(primitives.length).toBe(1)
      const p = primitives[0], position = json.accessors[p.attributes.POSITION]
      expect(p.attributes.COLOR_0).toBeDefined()
      for (let i = 0; i < 3; i++) {
        expect(position.min[i]).toBeCloseTo(i === 1 ? 0 : -.5, 5)
        expect(position.max[i]).toBeCloseTo(i === 1 ? 1 : .5, 5)
      }
      expect(json.accessors[p.indices].count / 3).toBeLessThanOrEqual(650)
    }
  })
})
