import { expect, test } from 'bun:test'
import catalog from './generated/metroEdges.json'
import { metroEdgeWallMeshes, EDGE_WALL } from './metroEdgeWalls'
import { metroBridgeOpenings } from './metroBridges'

const study = { radius: catalog.radius, span: catalog.span,
  samples: catalog.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }

// Each wall piece stores 4 vertices per end: floor, parapet top, cap, land face.
const pieces = (meshes: ReturnType<typeof metroEdgeWallMeshes>, x: number) => meshes.flatMap(m => {
  const p = m.attributes.position, out: number[][] = []
  for (let o = 0; o < p.length; o += 24) if (Math.abs(p[o] - x) < 1e-3) out.push(Array.from(p.subarray(o, o + 24)))
  return out
})

test('walls run the full length of both window-side edges from the floor to a parapet', () => {
  for (const band of ['east', 'central', 'west']) {
    const meshes = metroEdgeWallMeshes(study, band, -16)
    for (const edge of catalog.edges.filter(e => e.band === band)) {
      const own = pieces(meshes, edge.x)
      const covered = own.reduce((n, v) => n + (v[13] - v[1]), 0)
      expect(covered).toBeCloseTo((edge.top.length - 1) * catalog.spacing, 1)
      for (const v of own) for (const o of [0, 12]) {
        const ground = edge.top[Math.round((v[o + 1] - edge.y0) / catalog.spacing)] / 10
        expect(v[o]).toBeCloseTo(edge.x, 3); expect(v[o + 2]).toBe(-16)
        expect(v[o + 5]).toBeCloseTo(ground + EDGE_WALL.parapet, 3)
        // Cap and land face step inward, away from the window.
        expect(Math.sign(v[o + 6] - edge.x)).toBe(-edge.side)
        expect(v[o + 11]).toBeCloseTo(ground - EDGE_WALL.bury, 3)
      }
    }
  }
})

test('viaduct abutments open both walls exactly across their decks', () => {
  const openings = metroBridgeOpenings(study)
  expect(openings.length).toBe(4)
  for (const band of ['east', 'central']) {
    const meshes = metroEdgeWallMeshes(study, band, -16, openings)
    for (const edge of catalog.edges.filter(e => e.band === band)) {
      const cuts = openings.filter(o => o.band === band && o.side === edge.side), own = pieces(meshes, edge.x)
      const removed = cuts.reduce((n, c) => n + c.y1 - c.y0, 0)
      expect(own.reduce((n, v) => n + (v[13] - v[1]), 0)).toBeCloseTo((edge.top.length - 1) * catalog.spacing - removed, 1) // float32 sum over 40 km
      for (const v of own) for (const c of cuts) expect(v[13] <= c.y0 + 1e-3 || v[1] >= c.y1 - 1e-3).toBe(true)
      expect(cuts.length).toBe(edge.side === (band === 'east' ? 1 : -1) ? 2 : 0)
    }
  }
})

test('a different crop frame gets no walls', () => {
  const moved = { ...study, samples: study.samples.map(s => ({ ...s, frame: { ...(s.frame as object), angle: 0 } })) }
  expect(metroEdgeWallMeshes(moved, 'east', -16)).toEqual([])
})
