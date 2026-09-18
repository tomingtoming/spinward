import { expect, test } from 'bun:test'
import raw from '../../qa/neighborhood-life/colony-source'
import transport from '../../assets/blender/izma-transport.json'
import { IZMA_MASTER_PLAN } from './izmaMasterPlan'
import { colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { landscapeColliders } from './authoredLandscape'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'

const manifest = readColonyManifest(raw)
const decoded = decodeColonyMesh(manifest.base)
const index = buildCityCollisionIndex(colonyColliders(manifest, decoded.surfaces), 3200, 40000)

test('all longitudinal transport profiles have bounded grades and shared junction heights', () => {
  const junctions = new Map<string, number[]>()
  for (const route of transport.profiles) {
    const limit = route.kind === 'rail' ? .025 : route.kind === 'expressway' ? .04 : .06
    const design = IZMA_MASTER_PLAN.routes.find(r => r.id === route.id)!
    expect(design).toBeDefined()
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (d > .01) expect(Math.abs(a[2] - b[2]) / d).toBeLessThanOrEqual(limit + 1e-6)
    }
    for (const id of design.nodes) {
      const node = IZMA_MASTER_PLAN.nodes.find(n => n.id === id)!
      const p = route.points.find(p => Math.hypot(p[0] - node.xy[0], p[1] - node.xy[1]) < .001)
      expect(p).toBeDefined()
      if (!junctions.has(id)) junctions.set(id, [])
      junctions.get(id)!.push(p![2])
    }
  }
  expect(transport.profiles.length).toBe(90)
  for (const heights of junctions.values()) expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(.001)
})

test('sampled road decks agree with the authored profiles across all three strips', () => {
  let count = 0
  for (const route of transport.profiles) for (let i = 0; i < route.points.length; i += 5) {
    const [x, y, h] = route.points[i]
    if (route.band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) continue
    const a = route.band * Math.PI * 2 / 3 + x / 3200
    const actual = getCityGroundHeight(index, 3200, a, y, h + .05, .08)
    expect(actual, `${route.id} ${i} at ${x},${y}: profile ${h}, actual ${actual}`).toBeGreaterThan(h - .03)
    expect(actual).toBeLessThan(h + .13)
    count++
  }
  expect(count).toBeGreaterThan(6000)
})

test('sampled transport collision windows stay within their local geometry budget', () => {
  const near = new Set<CityBuilding>()
  for (const route of transport.profiles) for (let i = 0; i < route.points.length; i += 5) {
    const [x, y] = route.points[i]
    if (route.band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) continue
    near.clear()
    collectCityCollidersNear(index, route.band * Math.PI * 2 / 3 + x / 3200, y, 1, near)
    expect(near.size, route.id).toBeLessThanOrEqual(32)
    let triangles = 0
    for (const body of near) triangles += (body.surfaceMesh?.length ?? 0) / 9
    expect(triangles, route.id).toBeLessThanOrEqual(4096)
  }
})

test('interior crossings join ordinary streets and carry rail above the road', () => {
  expect(transport.crossings.filter(c => !c.separated)).toHaveLength(7)
  expect(transport.crossings.filter(c => c.separated)).toHaveLength(1)
  for (const crossing of transport.crossings) {
    const a = crossing.band * Math.PI * 2 / 3 + crossing.xy[0] / 3200, y = crossing.xy[1]
    for (const h of crossing.heights) {
      const actual = getCityGroundHeight(index, 3200, a, y, h + .03, .03)
      expect(Math.abs(actual - h)).toBeLessThan(.02)
    }
    const difference = Math.abs(crossing.heights[0] - crossing.heights[1])
    if (crossing.separated) expect(difference - .9).toBeGreaterThanOrEqual(6.2)
    else expect(difference).toBeLessThan(.001)
  }
})

test('junction and terminal caps meet a level approach even on short sampled segments', () => {
  // This is the road-deck contract. Station crossing ramps intentionally sit
  // above it; their final walking surface is checked by izmaRail.test.ts.
  const roadIndex = buildCityCollisionIndex(colonyColliders(manifest, decoded.surfaces, [], [], [], []), 3200, 40000)
  for (const node of IZMA_MASTER_PLAN.nodes) {
    if (node.band === 0 && Math.abs(node.xy[0]) < 320 && Math.abs(node.xy[1]) < 400) continue
    const incident = IZMA_MASTER_PLAN.routes.filter(r => r.nodes.includes(node.id) && ['local', 'arterial', 'expressway'].includes(r.kind))
    if (!incident.some(r => r.kind === 'local' || r.kind === 'arterial')) continue
    const route = transport.profiles.find(p => p.id === incident[0].id)
    if (!route) continue
    const p = route.points.find(p => Math.hypot(p[0] - node.xy[0], p[1] - node.xy[1]) < .001)!
    const radius = Math.max(...incident.map(r => r.width)) / 2
    for (let i = 0; i < 16; i++) {
      const x = node.xy[0] + Math.cos(i * Math.PI / 8) * radius, y = node.xy[1] + Math.sin(i * Math.PI / 8) * radius
      const h = getCityGroundHeight(roadIndex, 3200, node.band * Math.PI * 2 / 3 + x / 3200, y, p[2] + .1, .05)
      expect(Math.abs(h - p[2]), node.id).toBeLessThan(.05)
    }
    for (const road of incident) for (let i = 0; i < road.nodes.length; i++) {
      if (road.nodes[i] !== node.id) continue
      for (const id of [road.nodes[i - 1], road.nodes[i + 1]].filter(Boolean)) {
        const other = IZMA_MASTER_PLAN.nodes.find(n => n.id === id)!
        if (other.band !== node.band) continue
        const dx = other.xy[0] - node.xy[0], dy = other.xy[1] - node.xy[1], length = Math.hypot(dx, dy)
        const x = node.xy[0] + dx / length * (radius + 1), y = node.xy[1] + dy / length * (radius + 1)
        const h = getCityGroundHeight(roadIndex, 3200, node.band * Math.PI * 2 / 3 + x / 3200, y, p[2] + .1, .05)
        expect(Math.abs(h - p[2]), `${node.id} approach ${road.id}`).toBeLessThan(.05)
      }
    }
  }
})

test('motorway parapets leave each ordinary road approach open', () => {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(citySurfaceVertices(decoded.meshes.parapet, 3200), 3))
  geometry.translate(3200, 0, 0)
  const material = new MeshBasicMaterial({ side: DoubleSide }), barriers = new Mesh(geometry, material)
  const point = (band: number, p: number[]) => {
    const a = band * Math.PI * 2 / 3 + p[0] / 3200
    return new Vector3(Math.cos(a) * (3200 - p[2] - .7), p[1], Math.sin(a) * (3200 - p[2] - .7))
  }
  let checked = 0
  try {
    for (const node of IZMA_MASTER_PLAN.nodes.filter(n => n.role === 'interchange')) {
      for (const design of IZMA_MASTER_PLAN.routes.filter(r => r.kind === 'arterial' && r.nodes.includes(node.id))) {
        const route = transport.profiles.find(p => p.id === design.id)
        if (!route) continue // Inter-strip links are still planning reservations.
        const i = route.points.findIndex(p => Math.hypot(p[0] - node.xy[0], p[1] - node.xy[1]) < .001)
        for (const near of [i - 4, i + 4].filter(n => n >= 0 && n < route.points.length)) {
          const from = point(node.band, route.points[near]), to = point(node.band, route.points[i])
          const ray = new Raycaster(from, to.clone().sub(from).normalize(), .01, from.distanceTo(to))
          expect(ray.intersectObject(barriers), `${node.id} approach ${design.id}`).toHaveLength(0)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(18)
  } finally { geometry.dispose(); material.dispose() }
})

test('concrete foundations reach the real terrain and parapets use collision meshes without becoming walking floors', () => {
  const groups = new Map<string, number[]>()
  const earth = decoded.meshes.earth
  for (let i = 0; i < earth.length; i += 9) {
    const key = `${Math.floor((earth[i] + earth[i + 3] + earth[i + 6]) / 768)}:${Math.floor((earth[i + 1] + earth[i + 4] + earth[i + 7]) / 768)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(...earth.slice(i, i + 9))
  }
  const surfaces = [...groups.values()].map(vertices => {
    const x = vertices.filter((_, i) => i % 3 === 0), y = vertices.filter((_, i) => i % 3 === 1)
    return { vertices, bounds: [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)] as [number, number, number, number] }
  })
  const ground = buildCityCollisionIndex(landscapeColliders({ surfaces, solids: [] }, 3200), 3200, 40000)
  for (const [x, y] of [[190.714, 421.429], [-350, -404]]) {
    const earthHeight = getCityGroundHeight(ground, 3200, x / 3200, y, 400)
    const roadHeight = getCityGroundHeight(index, 3200, x / 3200, y, 400)
    expect(roadHeight - earthHeight, `previously buried study join at ${x},${y}`).toBeGreaterThan(.08)
  }
  expect(manifest.structures!.length).toBeGreaterThan(3000)
  for (const [x, y, z, width, depth, , yaw] of manifest.structures!) {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const px = x + c * width / 2 * side - s * depth / 2 * end
      const py = y + s * width / 2 * side + c * depth / 2 * end
      const h = getCityGroundHeight(ground, 3200, px / 3200, py, 400)
      expect(z - h).toBeLessThan(.04)
    }
  }
  const walls = colonyColliders(manifest, decoded.surfaces).filter(b => b.groundSurface === false)
  expect(walls.length).toBeGreaterThan(500)
  expect(walls.every(b => b.surfaceMesh && b.surfaceMesh.length >= 9)).toBe(true)
})
