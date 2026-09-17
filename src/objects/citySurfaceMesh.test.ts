import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { citySurfaceVertices, sampleCitySurface, sampleProjectedCitySurface } from './citySurfaceMesh'
import { buildCityCollisionIndex, getCityGroundHeight, type CityBuilding } from './cityLayout'

test('coarse authored floor sampling matches the actual projected triangles at all three strips', () => {
  const radius = 3200
  // Deliberately large faces: their curved hull projection lifts the centre
  // by metres, which was invisible to the former planar height interpolation.
  const surface = [-350, -400, 20, 350, -400, 30, 350, 400, 40, -350, -400, 20, 350, 400, 40, -350, 400, 25]
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(citySurfaceVertices(surface, radius), 3))
  geometry.translate(radius, 0, 0)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  for (let band = 0; band < 3; band++) {
    const angle = band * Math.PI * 2 / 3, axial = -17000 + band * 8000
    const building: CityBuilding = { azimuth: angle, axial, width: 700, depth: 800, height: 40,
      surfaceMesh: surface, groundSurface: true, kind: 'block', tone: .5 }
    const index = buildCityCollisionIndex([building], radius, 40000)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.y = -angle; mesh.position.y = axial; mesh.updateMatrixWorld(true)
    for (const [x, y] of [[0, 0], [-280, 160], [170, -140]]) {
      const a = angle + x / radius
      const direction = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const ray = new THREE.Raycaster(new THREE.Vector3(0, axial + y, 0), direction)
      const hit = ray.intersectObject(mesh)[0]
      expect(hit).toBeDefined()
      const actual = radius - Math.hypot(hit.point.x, hit.point.z)
      const sampled = getCityGroundHeight(index, radius, a, axial + y, 100)
      expect(Math.abs(actual - sampled)).toBeLessThan(.002)
      expect(Math.abs(actual - sampleCitySurface(surface, x, y))).toBeGreaterThan(1)
    }
  }
  geometry.dispose(); material.dispose()
})

test('projected ground respects overpass ceilings, vertical faces and cylinder-radius changes', () => {
  const plane = (h: number) => [-20, -20, h, 20, -20, h, 20, 20, h, -20, -20, h, 20, 20, h, -20, 20, h]
  const mesh = [...plane(2), ...plane(18), 30, -20, 0, 30, 20, 0, 30, 20, 30]
  expect(sampleProjectedCitySurface(mesh, 3200, 0, 0, 4)).toBeCloseTo(2.062, 2)
  expect(sampleProjectedCitySurface(mesh, 3200, 0, 0, 25)).toBeCloseTo(18.062, 2)
  expect(sampleProjectedCitySurface(mesh, 3200, 100, 100)).toBe(0)
  expect(sampleProjectedCitySurface(mesh, 3200, 0, 0, 1)).toBe(0)
  const a = sampleProjectedCitySurface(mesh, 1800, 0, 0, 4)
  expect(a).toBeGreaterThan(2.1)
  expect(sampleProjectedCitySurface(mesh, 3200, 0, 0, 4)).toBeCloseTo(2.062, 2)
})

test('projected triangle edges tolerate millimetre rounding without extending the walking floor', () => {
  for (const size of [8, 256, 800]) {
    const mesh = [0, 0, 18, size, 0, 18, 0, size, 18]
    // A shared edge can be rounded on opposite sides by two collider origins.
    expect(sampleProjectedCitySurface(mesh, 3200, size / 4, -.001)).toBeGreaterThan(17)
    expect(sampleProjectedCitySurface(mesh, 3200, -.001, size / 4)).toBeGreaterThan(17)
    expect(sampleProjectedCitySurface(mesh, 3200, size / 4, -.004)).toBe(0)
    expect(sampleProjectedCitySurface(mesh, 3200, -.004, size / 4)).toBe(0)
  }
})
