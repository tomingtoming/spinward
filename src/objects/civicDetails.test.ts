import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { CivicDetails } from './civicDetails'
import { getArterialRoadWidth, getCityGroundHeight, resolveCitySurfaceCollision, planCity, type CityPlan } from './cityLayout'

const emptyPlan = (): CityPlan => ({ buildings: [], roads: [], intersections: [], patches: [], trees: [], tower: null, expressway: null })

test('plaza furniture and signs leave both arterial carriageways clear', () => {
  const parent = new THREE.Group()
  const details = new CivicDetails(parent)
  try {
    details.rebuild(emptyPlan(), 3200)
    const roadHalfWidth = getArterialRoadWidth(3200) * 0.5
    details.group.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    details.group.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        // At azimuth zero local tangent is world Z and axial is world Y.
        const world = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
        expect(Math.abs(world.y)).toBeGreaterThan(roadHalfWidth)
        expect(Math.abs(world.z)).toBeGreaterThan(roadHalfWidth)
      }
    }
  } finally { details.dispose() }
})

test('city details have bounded draw calls and release geometry when switching habitats', () => {
  const parent = new THREE.Group()
  const details = new CivicDetails(parent)
  try {
    const plan = planCity({ radius: 3200, length: 40000, maxBuildings: 12000 })
    details.rebuild(plan, 3200)
    expect(details.group.children.length).toBeGreaterThan(0)
    const meshes: THREE.Mesh[] = []
    details.group.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    // Six merged civic materials plus the painted sign face and frame.
    expect(meshes.length).toBeLessThanOrEqual(8)
    let triangles = 0
    let disposed = 0
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingSphere()
      expect(Number.isFinite(mesh.geometry.boundingSphere!.radius)).toBe(true)
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
      mesh.geometry.addEventListener('dispose', () => { disposed++ })
    }
    expect(triangles).toBeLessThan(15000)
    const meshCount = meshes.length
    details.rebuild(emptyPlan(), 18)
    expect(disposed).toBe(meshCount)
    expect(details.group.children).toHaveLength(0)
    expect(details.seats).toHaveLength(0)
    expect(details.colliders).toHaveLength(0)
  } finally { details.dispose() }
  expect(parent.children).toHaveLength(0)
})

test('public seat anchors are supported by the visible wood and exit into a clear pavement', () => {
  const details = new CivicDetails(new THREE.Group())
  try {
    for (const radius of [3200, 5700, 30000]) {
      details.rebuild(emptyPlan(), radius); details.group.updateMatrixWorld(true)
      expect(details.seats).toHaveLength(2)
      for (const seat of details.seats) {
        const radial = new THREE.Vector3(Math.cos(seat.azimuth), 0, Math.sin(seat.azimuth))
        const above = radial.clone().multiplyScalar(radius - .8).setY(seat.axialPosition - .18)
        const hit = new THREE.Raycaster(above, radial, 0, 1).intersectObject(details.group, true)[0]
        expect(hit).toBeDefined()
        // Float32 world vertices have millimetre precision at a 30 km radius.
        expect(Math.abs(radius - Math.hypot(hit.point.x, hit.point.z) - seat.seatHeight!)).toBeLessThan(.003)
        expect(resolveCitySurfaceCollision({ ...seat.exit }, details.colliders, radius)).toBe(false)
        expect(getCityGroundHeight(details.colliders, radius, seat.exit.azimuth, seat.exit.axialPosition, 0)).toBe(0)
        expect(getCityGroundHeight(details.colliders, radius, seat.azimuth, seat.axialPosition - .18 + .45, .4)).toBe(0)
        expect(getCityGroundHeight(details.colliders, radius, seat.azimuth, seat.axialPosition - .18, .8)).toBeCloseTo(.53, 6)
        expect(Math.abs(seat.exit.axialPosition)).toBeGreaterThan(getArterialRoadWidth(radius) / 2 + .45)
      }
    }
  } finally { details.dispose() }
})
