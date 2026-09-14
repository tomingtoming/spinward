import { expect, test } from 'bun:test'
import { StreetMarkingPlan } from './streetMarkings'
import { StreetNetwork } from './streetNetwork'
import { legacyStreetPaths, sampleStreetPath, type StreetPath } from './streetPath'
import { buildStreetSurfaceGeometry } from './streetSurfaceGeometry'
import { polygonArea, intersectStreetPolygons } from './streetPolygon'
import { relativeStreetPolygon } from './streetSurfacePlan'
import { planCity } from './cityLayout'
import { IntersectionFurniture, layoutIntersection } from './intersectionFurniture'
import { StreetSurfacePlan } from './streetSurfacePlan'
import * as THREE from 'three'

const R = 3200
const line = (id: string, a: [number, number], b: [number, number], width = 6): StreetPath => {
  const tangent: [number, number] = [b[0] - a[0], b[1] - a[1]]
  return { id, azimuth: 0, axial: 0, kind: 'local', level: 0, groundHeight: 0, width,
    knots: [{ point: a, tangent }, { point: b, tangent }] }
}
const plan = (paths: StreetPath[]) => new StreetMarkingPlan(new StreetNetwork(paths, R))

test('skew crossings follow all four arms and clear the entire other carriageway', () => {
  for (const angle of [.4, .9, Math.PI / 2, 2.2]) {
    const paths = [line('main', [-100, 0], [100, 0]),
      line('skew', [-100 * Math.cos(angle), -100 * Math.sin(angle)], [100 * Math.cos(angle), 100 * Math.sin(angle)], 12)]
    const p = plan(paths), crossings = p.crossings(0, 0, 100)
    expect(crossings).toHaveLength(4)
    for (const c of crossings) {
      const other = paths.find(s => s !== c.source)!, a = other.knots[0].point, b = other.knots[1].point
      const dx = b[0] - a[0], dy = b[1] - a[1]
      for (const s of p.paint([c])) for (const v of s.polygon)
        expect(Math.abs((v.x - a[0]) * dy - (v.y - a[1]) * dx) / Math.hypot(dx, dy)).toBeGreaterThan(other.width / 2)
      expect(c.start).toBeLessThan(c.end)
    }
  }
})

test('T junctions, multiway nodes, duplicate roads and decks do not invent closed arms', () => {
  const main = line('main', [-100, 0], [100, 0]), stem = line('stem', [0, 0], [40, 80])
  expect(plan([main, stem]).crossings(0, 0, 100)).toHaveLength(3)
  expect(plan([main, stem, { ...main, id: 'duplicate' }]).crossings(0, 0, 100)).toHaveLength(3)
  expect(plan([main, stem, line('extra', [0, 0], [-40, 80])]).crossings(0, 0, 100)).toHaveLength(4)
  expect(plan([main, { ...stem, level: 1 }]).crossings(0, 0, 100)).toHaveLength(0)
  expect(plan([main, { ...stem, surfaceOwner: 'authored' }]).crossings(0, 0, 100)).toHaveLength(0)
  expect(plan([main, { ...stem, kind: 'alley', width: 4 }]).crossings(0, 0, 100)).toHaveLength(0)
})

test('a bending through road keeps crossings on both approaches of its side junction', () => {
  for (const bend of [-.35, -.15, .15, .35]) for (const width of [6, 12, 19.5]) for (const rotation of [0, .7]) {
    const turn = ([x, y]: [number, number]): [number, number] =>
      [x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation)]
    const roads = [line('south', turn([0, -200]), [0, 0], width),
      line('north', [0, 0], turn([200 * Math.sin(bend), 200 * Math.cos(bend)]), width),
      line('branch', [0, 0], turn([200, 0]), 12)]
    const p = plan(roads), crossings = p.crossings(0, 0, 100)
    expect(crossings).toHaveLength(3)
    expect(new Set(crossings.map(c => c.source.id)).size).toBe(3)
    for (const c of crossings) {
      expect(p.clearOfOtherRoads(c)).toBe(true)
      for (const stripe of p.paint([c])) for (const other of roads.filter(r => r !== c.source)) {
        const surfaces = new StreetSurfacePlan([other], R).roadSurfaces()
        for (const surface of surfaces)
          expect(polygonArea(intersectStreetPolygons(stripe.polygon, relativeStreetPolygon(surface, stripe.source, R)))).toBeLessThan(1e-6)
      }
    }
  }
})

test('nearby crossings are separated on short blocks and follow curves across the seam', () => {
  const main = line('main', [-100, 0], [100, 0])
  const short = plan([main, line('a', [-4, -50], [-4, 50]), line('b', [4, -50], [4, 50])])
  for (const c of short.crossings(0, 0, 100).filter(c => c.source === main)) {
    const a = sampleStreetPath(main, c.start), b = sampleStreetPath(main, c.end)
    expect(a.x >= 4 || b.x <= -4).toBe(true)
  }
  const curve: StreetPath = { ...main, knots: [{ point: [-100, 0], tangent: [200, 75] }, { point: [100, 0], tangent: [200, 75] }] }
  for (const azimuth of [0, Math.PI]) {
    const p = plan([{ ...curve, azimuth }, { ...line('cross', [0, -100], [0, 100]), azimuth: -azimuth }])
    const crossings = p.crossings(azimuth, 0, 60)
    expect(crossings).toHaveLength(4)
    expect(p.crossings(azimuth, 0, 60, 2)).toHaveLength(2)
    expect(p.crossings(azimuth + .5, 0, 20)).toHaveLength(0)
    expect(p.paint(crossings).every(s => polygonArea(s.polygon) > 0)).toBe(true)
  }
})

test('unequal junction angles share a short block without overlapping crossings or stops', () => {
  const link = line('link', [0, 0], [48, 0], 19.5)
  const p = plan([link, line('west', [-200, 0], [0, 0], 19.5), line('east', [48, 0], [250, 0], 19.5),
    line('skew', [0, 0], [200, 200], 19.5), line('north', [48, 0], [48, 200], 19.5)])
  const crossings = p.crossings(0, 0, 100).filter(c => c.source === link).sort((a, b) => a.start - b.start)
  expect(crossings).toHaveLength(2)
  expect(crossings[0].end * 48).toBeGreaterThan(24)
  expect((crossings[1].start - crossings[0].end) * 48).toBeGreaterThan(1.9)
  for (const c of crossings) {
    expect(p.clearOfOtherRoads(c)).toBe(true)
    expect(Math.abs(p.distanceAt(c.street, c.sign === 1 ? c.end : c.start) - c.station) + .95).toBeLessThanOrEqual(c.limit)
  }
  expect(crossings[0].limit + crossings[1].limit).toBeCloseTo(48, 8)
})

test('paint stays inside its road, does not overlap other zebra and follows the cylindrical floor', () => {
  const p = plan([line('a', [-100, -30], [100, 30]), line('b', [-20, -100], [20, 100], 12)])
  const paint = p.paint(p.crossings(0, 0, 100)), stripes = paint
  for (let i = 0; i < stripes.length; i++) for (let j = i + 1; j < stripes.length; j++)
    expect(Math.abs(polygonArea(intersectStreetPolygons(stripes[i].polygon, relativeStreetPolygon(stripes[j], stripes[i].source, R))))).toBeLessThan(1e-6)
  for (const s of paint) {
    const [a, b] = s.source.knots.map(k => k.point), dx = b[0] - a[0], dy = b[1] - a[1]
    for (const v of s.polygon) expect(Math.abs((v.x - a[0]) * dy - (v.y - a[1]) * dx) / Math.hypot(dx, dy)).toBeLessThanOrEqual(s.source.width / 2 + 1e-6)
  }
  const mesh = buildStreetSurfaceGeometry(paint, R, 1)!
  const pos = mesh.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    expect(Array.from(pos.array.slice(i * 3, i * 3 + 3)).every(Number.isFinite)).toBe(true)
    const height = R - Math.hypot(pos.getX(i), pos.getZ(i))
    expect(height).toBeGreaterThan(.234); expect(height).toBeLessThan(.261)
  }
  mesh.dispose()
})

test('an adjacent unconnected carriageway cannot run through a painted crossing', () => {
  const roads = [line('main', [-100, 0], [100, 0]), line('cross', [0, -100], [0, 100])]
  const intrusion = line('intrusion', [5, 2.8], [8, 2.8], 2)
  const crossings = plan([...roads, intrusion]).crossings(0, 0, 100)
  expect(crossings).toHaveLength(3)
  expect(crossings.some(c => c.source === roads[0] && sampleStreetPath(c.source, c.start).x > 0)).toBe(false)
  expect(plan([...roads, { ...intrusion, level: 1 }]).crossings(0, 0, 100)).toHaveLength(4)
})

test('full-city native markings remain local and retain the established signal crossing', () => {
  const city = planCity({ radius: R, length: 40000, maxBuildings: 18000 })
  const p = plan(legacyStreetPaths(city.roads)), crossings = p.crossings(0, 321.29, 160)
  expect(crossings.length).toBeGreaterThan(4); expect(crossings.length).toBeLessThanOrEqual(512)
  expect(crossings.every(c => c.distance <= 160)).toBe(true)
  const near = crossings.find(c => { const v = sampleStreetPath(c.source, (c.start + c.end) / 2)
    return Math.abs(c.source.azimuth + v.x / R) * R < 1 && Math.abs(c.source.axial + v.y - 313.39) < 4 })
  expect(near).toBeDefined()
  const crossing = city.intersections.reduce((best, x) => Math.hypot(x.azimuth * R, x.axial - 321.29) < Math.hypot(best.azimuth * R, best.axial - 321.29) ? x : best)
  const atNode = crossings.filter(c => { const n = p.network.nodes[c.node]
    return Math.hypot(n.azimuth * R - crossing.azimuth * R, n.axial - crossing.axial) < 1e-4 })
  const native = p.paint(atNode).map(s => {
    const x = s.polygon.reduce((n, v) => n + v.x, 0) / s.polygon.length, y = s.polygon.reduce((n, v) => n + v.y, 0) / s.polygon.length
    return [s.source.azimuth * R + x, s.source.axial + y]
  })
  const old = layoutIntersection(crossing, R).stripes
  expect(native).toHaveLength(old.length)
  for (const stripe of old) expect(native.some(([x, y]) => Math.hypot(x - crossing.azimuth * R - stripe.t, y - crossing.axial - stripe.a) < 1e-5)).toBe(true)
}, 30000)

test('rendered native stripe tops clear road triangles and support one-sided rendering', () => {
  for (const radius of [18, 180, 3200]) {
    const paths = [line('a', [-40, -10], [40, 10]), line('b', [0, -40], [0, 40])]
    const network = new StreetNetwork(paths, radius), markings = new StreetMarkingPlan(network)
    const geometry = buildStreetSurfaceGeometry(new StreetSurfacePlan(paths, radius).roadSurfaces(), radius, 1)!
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), road = new THREE.Mesh(geometry, material)
    road.updateMatrixWorld(true)
    const furniture = new IntersectionFurniture()
    furniture.setPlan([], radius, markings); furniture.update(0, 0, 0); furniture.group.updateMatrixWorld(true)
    const mesh = furniture.group.getObjectByName('street-junction-markings') as THREE.Mesh
    expect(mesh).toBeDefined()
    const p = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!, ray = new THREE.Raycaster()
    for (let i = 0; i < indices.count; i += 3) {
      const centre = new THREE.Vector3()
      for (let j = 0; j < 3; j++) centre.add(new THREE.Vector3().fromBufferAttribute(p, indices.getX(i + j)))
      centre.multiplyScalar(1 / 3)
      const outward = new THREE.Vector3(centre.x, 0, centre.z).normalize()
      ray.set(centre.clone().addScaledVector(outward, -1), outward)
      const top = ray.intersectObject(mesh)[0], floor = ray.intersectObject(road)[0]
      expect(top).toBeDefined(); expect(floor).toBeDefined()
      expect(floor.distance - top.distance).toBeGreaterThan(.019)
      expect(floor.distance - top.distance).toBeLessThan(.071)
    }
    furniture.setPlan([], radius)
    expect(furniture.group.getObjectByName('street-junction-markings')).toBeUndefined()
    furniture.dispose(); geometry.dispose(); material.dispose()
  }
})
