import { expect, test } from 'bun:test'
import raw from '../../qa/neighborhood-life/colony-source'
import transport from '../../assets/blender/izma-transport.json'
import interbandPlan from '../../assets/blender/izma-interband-plan.json'
import { IZMA_MASTER_PLAN } from './izmaMasterPlan'
import { colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { landscapeColliders } from './authoredLandscape'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'
import { readFile } from 'node:fs/promises'
import studyRaw from './generated/worldLandscapes.json'
import { unpackLandscapeLibrary } from './landscapeData'

type BuiltRoute = { id: string; band: number; kind: string; points: number[][]; replacement?: string }
type BuiltTransport = {
  sourceSha256: string; profiles: BuiltRoute[];
  replacements: { retiredAtGradeNode: string; newForks: string[] }[];
  laneGraph: {
    nodes: { id: string; band: number; position: number[]; role: string }[];
    edges: { id: string; from: string; to: string; points: number[][]; kind: string; bidirectional: boolean }[];
  }
}

const manifest = readColonyManifest(raw)
const decoded = decodeColonyMesh(manifest.base)
const built: BuiltTransport | null = manifest.motorway ? JSON.parse(await readFile(
  process.env.SPINWARD_MOTORWAY_ROUTES ?? new URL('../../assets/blender/izma-motorway-routes.json', import.meta.url), 'utf8')) : null
if (built) {
  const header = JSON.parse(await readFile(process.env.SPINWARD_AUDIT_SOURCE ?? new URL('./generated/izmaColony.json', import.meta.url), 'utf8'))
  if (built.sourceSha256 !== header.sourceSha256) throw Error('Built transport must match the tested colony source')
}
const profiles: BuiltRoute[] = built?.profiles ?? transport.profiles.map(r => ({ ...r,
  points: r.points.map(p => [p[0] + r.band * Math.PI * 6400 / 3, p[1], p[2]]) }))
const index = buildCityCollisionIndex([...colonyColliders(manifest, decoded.surfaces),
  ...(built ? landscapeColliders(unpackLandscapeLibrary(studyRaw).izma, 3200) : [])], 3200, 40000)

test('the original transport blockout has bounded grades and shared planned junction heights', () => {
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

const testBuilt = built ? test : test.skip
testBuilt('built IC lanes connect each district in both directions without restoring at-grade motorway junctions', () => {
  const graph = built!.laneGraph, nodes = new Map(graph.nodes.map(n => [n.id, n]))
  const adjacency = new Map(graph.nodes.map(n => [n.id, new Set<string>()]))
  expect(built!.profiles).toHaveLength(162)
  expect(built!.replacements).toHaveLength(18)
  expect(graph.edges.filter(e => e.kind === 'on-ramp')).toHaveLength(36)
  expect(graph.edges.filter(e => e.kind === 'off-ramp')).toHaveLength(36)
  for (const replacement of built!.replacements) {
    expect(nodes.has(replacement.retiredAtGradeNode)).toBe(false)
    expect(new Set(replacement.newForks).size).toBe(2)
    for (const id of replacement.newForks) expect(nodes.get(id)?.role).toBe('local-ramp-junction')
  }
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!
    expect(from).toBeDefined(); expect(to).toBeDefined()
    for (const [p, node] of [[edge.points[0], from], [edge.points.at(-1)!, to]] as const)
      expect(Math.hypot(...p.map((n, axis) => n - node.position[axis])), edge.id).toBeLessThan(.00001)
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], distance = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (distance > .00001) expect(Math.abs(b[2] - a[2]) / distance, edge.id).toBeLessThanOrEqual(.060001)
    }
    if (edge.kind === 'on-ramp') { expect(from.role).toBe('local-ramp-junction'); expect(to.role).toBe('merge') }
    if (edge.kind === 'off-ramp') { expect(from.role).toBe('exit'); expect(to.role).toBe('local-ramp-junction') }
    adjacency.get(edge.from)!.add(edge.to)
    if (edge.bidirectional) adjacency.get(edge.to)!.add(edge.from)
  }
  for (const entry of graph.nodes.filter(n => n.role === 'district-entry')) {
    const seen = new Set([entry.id]), pending = [entry.id]
    while (pending.length) for (const id of adjacency.get(pending.pop()!)!) if (!seen.has(id)) { seen.add(id); pending.push(id) }
    expect(graph.nodes.filter(n => n.role === 'district-entry' && seen.has(n.id)).map(n => n.band)).toEqual(Array(6).fill(entry.band))
  }
})

test('sampled road decks agree with the authored profiles across all three strips', () => {
  let count = 0
  for (const route of profiles) for (let i = 0; i < route.points.length; i += 5) {
    const [x, y, h] = route.points[i]
    if (!route.replacement && route.band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) continue
    const a = x / 3200
    const actual = getCityGroundHeight(index, 3200, a, y, h + .05, .08)
    expect(actual, `${route.id} ${i} at ${x},${y}: profile ${h}, actual ${actual}`).toBeGreaterThan(h - .03)
    expect(actual).toBeLessThan(h + .13)
    count++
  }
  expect(count).toBeGreaterThan(6000)
})

test('sampled transport collision windows stay within their local geometry budget', () => {
  const near = new Set<CityBuilding>()
  for (const route of profiles) for (let i = 0; i < route.points.length; i += 5) {
    const [x, y] = route.points[i]
    if (!route.replacement && route.band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) continue
    near.clear()
    collectCityCollidersNear(index, x / 3200, y, 1, near)
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
  // Test the original deck alone. Station and end-bridge crossing ramps sit
  // above it; their final physical/drawn surfaces have separate coverage.
  const roadIndex = buildCityCollisionIndex(landscapeColliders({ surfaces: decoded.surfaces, solids: [] }, 3200), 3200, 40000)
  for (const node of IZMA_MASTER_PLAN.nodes) {
    // These T nodes have become overpasses. The resolved graph and ramp-mouth
    // checks below verify their replacement; a level cap here would be a bug.
    if (built?.replacements.some(r => r.retiredAtGradeNode === node.id)) continue
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

test('raised end approaches retain matching drawn and physical floors over the original terminal caps', () => {
  expect(manifest.interband).toBeDefined()
  const road = decodeColonyMesh(manifest.interband!.fixed).meshes['interband-road']
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(citySurfaceVertices(road, 3200), 3))
  geometry.translate(3200, 0, 0)
  const material = new MeshBasicMaterial({ side: DoubleSide }), drawing = new Mesh(geometry, material)
  let raised = 0
  try {
    for (const gate of interbandPlan.approaches) {
      const [x, y, h] = gate.profile[0], sign = Math.sign(gate.profile.at(-1)![1] - y)
      for (const lane of [-3, 0, 3]) {
        let previous: number | undefined
        for (let distance = 1; distance <= 22; distance++) {
          const a = (x + lane) / 3200, axial = y + sign * distance
          const outward = new Vector3(Math.cos(a), 0, Math.sin(a))
          const origin = outward.clone().multiplyScalar(3200 - h - 2); origin.y = axial
          const hit = new Raycaster(origin, outward, 0, 4).intersectObject(drawing)[0]
          expect(hit, `${gate.id} road drawing at ${distance}m`).toBeDefined()
          const drawn = 3200 - Math.hypot(hit.point.x, hit.point.z)
          const physical = getCityGroundHeight(index, 3200, a, axial, h + 2, 0)
          expect(Math.abs(physical - drawn), gate.id).toBeLessThan(.025)
          if (previous !== undefined) expect(Math.abs(physical - previous), gate.id).toBeLessThan(.08)
          if (physical > gate.start[2] + .05) raised++
          previous = physical
        }
      }
    }
    expect(raised).toBeGreaterThan(20)
  } finally { geometry.dispose(); material.dispose() }
})

test('motorway parapets leave each ordinary road approach open', () => {
  const replacement = built ? decodeColonyMesh(manifest.motorway!.fixed).meshes['motorway-rail'] ?? [] : []
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(citySurfaceVertices(decoded.meshes.parapet.concat(replacement), 3200), 3))
  geometry.translate(3200, 0, 0)
  const material = new MeshBasicMaterial({ side: DoubleSide }), barriers = new Mesh(geometry, material)
  const point = (band: number, p: number[]) => {
    const a = band * Math.PI * 2 / 3 + p[0] / 3200
    return new Vector3(Math.cos(a) * (3200 - p[2] - .7), p[1], Math.sin(a) * (3200 - p[2] - .7))
  }
  let checked = 0
  try {
    if (built) {
      for (const edge of built.laneGraph.edges.filter(e => e.kind !== 'motorway')) {
        const points = edge.points
        const joints = new Set([...Array.from({ length: 6 }, (_, i) => i),
          ...Array.from({ length: 6 }, (_, i) => points.length - 2 - i)].filter(i => i >= 0 && i < points.length - 1))
        for (const i of joints) {
          const from = point(0, points[i]), to = point(0, points[i + 1])
          const ray = new Raycaster(from, to.clone().sub(from).normalize(), .01, from.distanceTo(to))
          expect(ray.intersectObject(barriers), `${edge.id} joint ${i}`).toHaveLength(0)
          checked++
        }
      }
      expect(checked).toBeGreaterThanOrEqual(72 * 10)
      return
    }
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
}, 60_000) // Full-city raycasts validate geometry, not a frame-time budget.

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
