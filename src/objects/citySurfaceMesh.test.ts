import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { citySurfaceVertices, sampleCitySurface, sampleProjectedCitySurface } from './citySurfaceMesh'
import { buildCityCollisionIndex, getCityGroundHeight, type CityBuilding } from './cityLayout'

test('surface bounds retain a shared deck edge despite far-coordinate rounding', () => {
  // Observed at the retained motorway y=16320: both adjacent bounds excluded
  // the same seam by 9.1e-13 m even though their actual triangles support it.
  const halfDepth = 31.90430000000015 / 2, h = 80.18323804036936
  const plane = [-12,-halfDepth,h,12,-halfDepth,h,12,halfDepth,h,
    -12,-halfDepth,h,12,halfDepth,h,-12,halfDepth,h]
  for (const [axial, outside] of [[16304.047849999999,16320.005],[16335.952150000001,16319.995]]) {
    const body: CityBuilding = { azimuth:5382.06445/3200, axial, width:24, depth:halfDepth*2,
      height:h, surfaceMesh:plane, groundSurface:true, groundMargin:0, kind:'block', tone:.5 }
    for (const source of [[body],buildCityCollisionIndex([body],3200,40000)]) {
      expect(getCityGroundHeight(source,3200,5388.064327658226/3200,16320,h+.05,0)).toBeGreaterThan(80)
      expect(getCityGroundHeight(source,3200,5388.064327658226/3200,outside,h+.05,0)).toBe(0)
    }
  }
})

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

test('a curved vertical foundation remains a wall even when a radial ray intersects its upper edge', () => {
  // Saved campus foundation: projection bows its long face over the entrance.
  const wall = [16.234457927525, 12.402121718749186, 12.24939,
    -13.308622072474463, 15.451161718750882, 12.88479,
    16.234457927525, 12.402121718749186, 12.88479]
  const x = 1.462920761309, y = 13.92664178737
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(citySurfaceVertices(wall, 3200), 3))
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(true)
  try {
    const hit = new THREE.Raycaster(new THREE.Vector3(-3200, y, 0),
      new THREE.Vector3(Math.cos(x / 3200), 0, Math.sin(x / 3200))).intersectObject(mesh)[0]
    expect(hit).toBeDefined()
    expect(3200 - hit.distance).toBeGreaterThan(12.9)
    const floor = [x - 2, y - 2, 12.4, x + 2, y - 2, 12.4, x + 2, y + 2, 12.4,
      x - 2, y - 2, 12.4, x + 2, y + 2, 12.4, x - 2, y + 2, 12.4]
    const expected = sampleProjectedCitySurface(floor, 3200, x, y, 13)
    expect(expected).toBeCloseTo(12.4, 2)
    for (const face of [wall, [...wall.slice(6), ...wall.slice(3, 6), ...wall.slice(0, 3)]]) {
      expect(sampleProjectedCitySurface(face, 3200, x, y, 13)).toBe(0)
      expect(sampleProjectedCitySurface([...floor, ...face], 3200, x, y, 13)).toBe(expected)
    }
  } finally { geometry.dispose(); material.dispose() }
})
