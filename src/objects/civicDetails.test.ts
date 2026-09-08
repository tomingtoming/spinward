import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { CivicDetails } from './civicDetails'
import { getArterialRoadWidth, planCity, type CityPlan } from './cityLayout'

const emptyPlan = (): CityPlan => ({ buildings: [], roads: [], intersections: [], patches: [], trees: [], tower: null, landmark: null, expressway: null })

test('plaza furniture leaves both arterial carriageways and the throwing lane clear', () => {
  const parent = new THREE.Group()
  const details = new CivicDetails(parent)
  try {
    details.rebuild(emptyPlan(), 3200)
    const roadHalfWidth = getArterialRoadWidth(3200) * 0.5
    for (const mesh of details.group.children as THREE.Mesh[]) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        // At azimuth zero local tangent is world Z and axial is world Y.
        expect(Math.abs(positions.getY(i))).toBeGreaterThan(roadHalfWidth)
        expect(Math.abs(positions.getZ(i))).toBeGreaterThan(roadHalfWidth)
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
    expect(details.group.children.length).toBeLessThanOrEqual(6)
    let triangles = 0
    let disposed = 0
    for (const mesh of details.group.children as THREE.Mesh[]) {
      mesh.geometry.computeBoundingSphere()
      expect(Number.isFinite(mesh.geometry.boundingSphere!.radius)).toBe(true)
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
      mesh.geometry.addEventListener('dispose', () => { disposed++ })
    }
    expect(triangles).toBeLessThan(15000)
    const meshCount = details.group.children.length
    details.rebuild(emptyPlan(), 18)
    expect(disposed).toBe(meshCount)
    expect(details.group.children).toHaveLength(0)
  } finally { details.dispose() }
  expect(parent.children).toHaveLength(0)
})
