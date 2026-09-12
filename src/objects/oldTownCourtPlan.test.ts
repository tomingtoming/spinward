import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { planCity } from './cityLayout'
import { planOldTownBlock, planOldTownCourt } from './oldTownBlockPlan'
import { COURT_GROUND, planOldTownCourtLife, oldTownCourtLod } from './oldTownCourtPlan'
import { collideSphereWithBuildings } from '../sim/cityCollision'

const radius = 3200
const city = planCity({ radius, length: 40000, maxBuildings: 64000 })
const paving = planOldTownCourt(planOldTownBlock(city.buildings, city.roads, radius, 40000), city.buildings, city.roads, radius, 40000)
const plan = planOldTownCourtLife(paving, radius)

test('court furniture and standing areas stay on certified paving outside the through corridor', () => {
  expect(plan.props).toHaveLength(6); expect(plan.seats).toHaveLength(2); expect(plan.colliders).toHaveLength(8)
  expect(planOldTownCourtLife(paving, radius)).toEqual(plan)
  const [court, path] = paving
  for (const p of plan.props) {
    const x = (p.azimuth - court.azimuth) * radius, y = p.axial - court.axial
    expect(Math.abs(x) + p.width / 2).toBeLessThan(court.tangentWidth / 2 - .3)
    expect(Math.abs(y) + p.depth / 2).toBeLessThan(court.axialLength / 2 - .3)
    expect(Math.abs(x) - p.width / 2).toBeGreaterThan(path.tangentWidth / 2 + .5)
    for (const b of city.buildings) expect(Math.abs(p.azimuth - b.azimuth) * radius > (p.width + b.width) / 2 + .25 || Math.abs(p.axial - b.axial) > (p.depth + b.depth) / 2 + .25).toBe(true)
  }
  const free = (a: number, ax: number, h: number) => {
    const p = new THREE.Vector3(Math.cos(a) * (radius - h), ax, Math.sin(a) * (radius - h))
    return !collideSphereWithBuildings(p, new THREE.Vector3(), plan.colliders, { habitatRadius: radius, sphereRadius: .32, restitution: 0 })
  }
  // Full ground-level route and chair approach have a real body-sized clearance.
  for (let y = -court.axialLength / 2; y < court.axialLength / 2; y += .2)
    expect(free(court.azimuth, court.axial + y, COURT_GROUND + .4)).toBe(true)
  for (const seat of plan.seats) {
    expect(free(seat.exit.azimuth, seat.exit.axialPosition, COURT_GROUND + .4)).toBe(true)
    for (let t = 0; t <= 1; t += .05)
      expect(free(THREE.MathUtils.lerp(court.azimuth, seat.exit.azimuth, t), seat.exit.axialPosition, COURT_GROUND + .4)).toBe(true)
    const chair = plan.props.find(p => p.kind === 'chair' && p.azimuth === seat.azimuth)!
    expect(seat.axialPosition - .18).toBeCloseTo(chair.axial, 8)
    expect(seat.seatHeight).toBe(COURT_GROUND + .44)
    expect(plan.colliders.some(c => c.azimuth === chair.azimuth && c.axial === chair.axial && c.baseHeight! + c.height === seat.seatHeight)).toBe(true)
  }
})

test('no court or insufficient space produces no furniture, phantom seats or collision', () => {
  expect(planOldTownCourtLife([], radius)).toEqual({ props: [], seats: [], colliders: [] })
  for (const width of [0, 3, 6]) expect(planOldTownCourtLife([{ ...paving[0], tangentWidth: width }, paving[1]], radius).props).toHaveLength(0)
  expect(planOldTownCourtLife([paving[0], { ...paving[1], azimuth: paving[1].azimuth + .001 }], radius).props).toHaveLength(0)
  for (const maxBuildings of [16000, 18000]) {
    const c = planCity({ radius, length: 40000, maxBuildings })
    const site = planOldTownCourt(planOldTownBlock(c.buildings, c.roads, radius, 40000), c.buildings, c.roads, radius, 40000)
    expect(site).toHaveLength(0)
    expect(planOldTownCourtLife(site, radius).seats).toHaveLength(0)
  }
})

test('both reused Blender chair LODs support the seated pelvis and keep the torso clear', async () => {
  const bytes = readFileSync(new URL('../../public/assets/buildings/balcony-life.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  for (const lod of [0, 1]) {
    const mesh = gltf.scene.getObjectByName('balcony_chair_lod' + lod)!
    const hit = new THREE.Raycaster(new THREE.Vector3(0, .55, 0), new THREE.Vector3(0, -1, 0), 0, .2).intersectObject(mesh, true)
    expect(hit.length).toBeGreaterThan(0); expect(hit[0].point.y).toBeCloseTo(.44, 6)
    // Above the seat, the back does not cross the body's central volume.
    for (const x of [-.1, 0, .1]) expect(new THREE.Raycaster(new THREE.Vector3(x, .46, 0), new THREE.Vector3(0, 1, 0), 0, .7).intersectObject(mesh, true)).toHaveLength(0)
  }
})

test('court LOD retains a visible solid at approach distance with hysteresis', () => {
  expect(oldTownCourtLod(21, 2)).toBe(0); expect(oldTownCourtLod(25, 0)).toBe(0)
  expect(oldTownCourtLod(27, 0)).toBe(1); expect(oldTownCourtLod(100, 1)).toBe(1)
  expect(oldTownCourtLod(100, 2)).toBe(2); expect(oldTownCourtLod(111, 1)).toBe(2)
  expect(oldTownCourtLod(94, 2)).toBe(1)
})
