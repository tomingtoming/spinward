import { expect, test } from 'bun:test'
import { colonyPoint, IZMA_MASTER_PLAN as p } from './izmaMasterPlan'
import { ISLAND_THREE_TOPOLOGY } from '../sim/habitatConfig'

test('whole-colony envelope matches the actual three inhabited arcs', () => {
  expect(p.radius).toBe(3200); expect(p.span).toBe(40000)
  for (const band of p.bands) {
    const arc = ISLAND_THREE_TOPOLOGY.landArcs[band.id]
    expect(arc.centerAzimuth).toBeCloseTo(band.azimuth, 9)
    expect(arc.arcRadians).toBeCloseTo(p.landArcRadians, 9)
    const xyz = colonyPoint(band.id, 270, 12100, 48)
    expect(Math.hypot(xyz[0], xyz[2])).toBeCloseTo(3152, 6)
    expect(xyz[1]).toBe(12100)
  }
})

test('every strip is allocated from end reserve to end reserve, without overlapping districts', () => {
  for (const band of p.bands) {
    const districts = p.districts.filter(d => d.band === band.id).sort((a, b) => a.axial[0] - b.axial[0])
    expect(districts.length).toBe(6)
    expect(districts[0].axial[0]).toBe(-p.span / 2 + p.endReserve)
    expect(districts.at(-1)!.axial[1]).toBe(p.span / 2 - p.endReserve)
    districts.forEach((d, i) => {
      if (i) expect(d.axial[0]).toBe(districts[i - 1].axial[1])
      expect(d.centre[1]).toBeGreaterThan(d.axial[0]); expect(d.centre[1]).toBeLessThan(d.axial[1])
      expect(Object.values(d.mix).reduce((n, v) => n + v, 0)).toBeCloseTo(1, 9)
      expect(d.mix.housing).toBeGreaterThan(0); expect(d.mix.employment).toBeGreaterThan(0)
    })
  }
})

test('street and transit reservations stay on land except explicit inter-band transfers', () => {
  const lookup = new Map(p.nodes.map(n => [n.id, n]))
  expect(lookup.size).toBe(p.nodes.length)
  expect(new Set(p.routes.map(r => r.id)).size).toBe(p.routes.length)
  for (const node of p.nodes) {
    expect(Math.abs(node.xy[0])).toBeLessThan(p.radius * p.landArcRadians / 2 - p.edgeReserve)
    expect(Math.abs(node.xy[1])).toBeLessThan(p.span / 2)
  }
  for (const route of p.routes) {
    expect(route.width).toBeGreaterThan(0); expect(route.nodes.length).toBeGreaterThan(1)
    for (let i = 1; i < route.nodes.length; i++) {
      const a = lookup.get(route.nodes[i - 1])!, b = lookup.get(route.nodes[i])!
      expect(a).toBeDefined(); expect(b).toBeDefined()
      expect(a.id).not.toBe(b.id)
      if (a.band !== b.band) {
        expect(['transfer', 'expressway']).toContain(route.kind)
        expect(a.xy[1]).toBe(b.xy[1])
        expect([-19000, 6500, 19000]).toContain(a.xy[1])
      }
    }
  }
})

test('each centre reaches all other centres through named roads, stations and inter-band links', () => {
  // Test the connected graph, not geometric line intersections: a crossing
  // which is not a shared node must never silently become an interchange.
  const graph = new Map(p.nodes.map(n => [n.id, new Set<string>()]))
  for (const route of p.routes) for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1], b = route.nodes[i]
    graph.get(a)!.add(b); graph.get(b)!.add(a)
  }
  const visited = new Set<string>(), queue = [p.districts[0].id]
  while (queue.length) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id); queue.push(...graph.get(id)!)
  }
  expect(visited.size).toBe(p.nodes.length)
  for (const d of p.districts) {
    expect(visited.has(d.id)).toBe(true)
    expect(p.routes.some(r => r.kind === 'local' && r.nodes.includes(d.id + '-station') && r.nodes.includes(d.id))).toBe(true)
  }
  // Each strip has its own rail and motorway, both connected at all three
  // transfer stations; local roads are not substituted for transport lines.
  for (let band = 0; band < 3; band++) for (const mode of ['rail', 'expressway']) {
    const r = p.routes.find(r => r.id === `band-${band}-${mode}`)!
    expect(r.nodes.length).toBe(9)
  }
})

test('three different urban fabrics preserve the existing riverside neighbourhood', () => {
  const district = p.districts.find(d => d.id === 'a-river')!
  const [, y0, , y1] = p.protectedStudy.bounds
  expect(district.axial[0]).toBeLessThan(y0); expect(district.axial[1]).toBeGreaterThan(y1)
  expect(p.protectedStudy.routeMetres).toBeGreaterThan(420)
  expect(new Set(p.districts.map(d => d.fabric)).size).toBeGreaterThanOrEqual(7)
  expect(new Set(p.districts.filter(d => d.band === 0).map(d => d.axial[0]))).not.toEqual(
    new Set(p.districts.filter(d => d.band === 1).map(d => d.axial[0])))
})

test('rivers have downhill reaches and reserve their intake and recovery plants', () => {
  for (const water of p.water) {
    expect(water.reach[0][1]).toBe(-18200)
    expect(water.reach.at(-1)![1]).toBe(18200)
    for (let i = 1; i < water.reach.length; i++) {
      const a = water.reach[i - 1], b = water.reach[i]
      expect(b[1]).toBeGreaterThan(a[1])
      expect(b[2]).toBeGreaterThanOrEqual(a[2])
      expect(Math.abs(b[0]) + water.bankWidth).toBeLessThan(p.radius * p.landArcRadians / 2 - p.edgeReserve)
    }
  }
})
