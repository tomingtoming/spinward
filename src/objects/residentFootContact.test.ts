import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { fitResidentFeet } from './residentFootContact'
import { poseResident, placeResident } from './residentModel'
import { planCity } from './cityLayout'
import { planRiverDistrict } from './riverDistrictPlan'
import { planRiverWalkerRoutes } from './riverWalkerRoutes'
import { sampleStreetWalker } from './streetWalkerRoutes'
import { sampleCitySurface } from './citySurfaceMesh'

async function load() {
  const b = readFileSync(new URL('../../public/assets/people/resident.glb', import.meta.url))
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene.getObjectByName('resident')!
}
function shoeBottom(root: THREE.Object3D, gap: (point: THREE.Vector3) => number) {
  root.updateMatrixWorld(true)
  let lowest = Infinity
  const point = new THREE.Vector3()
  for (const side of ['left', 'right']) {
    const shoe = root.getObjectByName(`${side}_shoe`) as THREE.Mesh, vertices = shoe.geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) lowest = Math.min(lowest, gap(point.fromBufferAttribute(vertices, i).applyMatrix4(shoe.matrixWorld)))
  }
  return lowest
}

test('actual resident shoes retain support throughout walking and stopping, independent of scale and colony orientation', async () => {
  const root = await load(), up = new THREE.Vector3()
  for (const azimuth of [0, 1.2, Math.PI - .01]) for (const scale of [.94, 1.05]) for (const walking of [false, true]) for (let phase = 0; phase < 72; phase++) {
    placeResident(root, azimuth, 15, 3200, .7, .22)
    root.scale.set(scale * 1.04, scale, scale)
    poseResident(root, phase / 72 * 2 * Math.PI / 7.5, walking, false)
    const pelvis = root.getObjectByName('pelvis')!, before = pelvis.position.y
    fitResidentFeet(root)
    up.set(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    const bottom = shoeBottom(root, v => v.sub(root.position).dot(up))
    expect(bottom).toBeCloseTo(0, 8)
    expect(Math.abs(pelvis.position.y - before)).toBeLessThan(.09)
  }
})

test('both directions and turns keep the actual shoes close to river terrain across walking phases', async () => {
  const root = await load(), radius = 3200
  const p = planRiverDistrict(planCity({ radius, length: 40000, maxBuildings: 18000 }), radius)!
  const routes = planRiverWalkerRoutes(p, radius)
  let min = Infinity, max = -Infinity
  for (const route of routes) {
    const duration = route.length / route.speed, scale = .94 + route.variant * .022
    const times = Array.from({ length: 41 }, (_, i) => i / 40 * duration)
    times.push(...times.map(t => duration + 1.8 + t), duration + .9, 2 * duration + 2.7)
    for (const time of times) for (let phase = 0; phase < 16; phase++) {
      const at = sampleStreetWalker(route, radius, time)
      placeResident(root, at.azimuth, at.axial, radius, at.heading, at.height + .02)
      root.scale.set(scale * (route.variant % 2 ? 1.04 : .98), scale, scale)
      poseResident(root, phase / 16 * 2 * Math.PI / 7.5, at.walking, false)
      fitResidentFeet(root, at.slopeX * root.scale.x / scale, at.slopeZ)
      const bottom = shoeBottom(root, v => {
        const azimuth = Math.atan2(v.z, v.x), h = radius - Math.hypot(v.x, v.z)
        let floor = 0
        for (const s of p.surfaces) {
          if (s.material !== 'stone' && s.material !== 'earth') continue
          const c = s.collider, x = (azimuth - c.azimuth) * radius, y = v.y - c.axial
          if (Math.abs(x) > c.width / 2 + 1e-6 || Math.abs(y) > c.depth / 2 + 1e-6) continue
          floor = Math.max(floor, sampleCitySurface(c.surfaceMesh!, x, y, at.height + .3))
        }
        return h - floor
      })
      min = Math.min(min, bottom); max = Math.max(max, bottom)
      expect(bottom).toBeGreaterThan(-.012)
      expect(bottom).toBeLessThan(.045)
    }
  }
  console.log('river shoe clearance across 2688 poses', { min, max })
})
