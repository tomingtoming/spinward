import { expect, test } from 'bun:test'
import catalog from './generated/metroEdges.json'
import { metroEdgeWallMeshes, EDGE_WALL } from './metroEdgeWalls'

const study = { radius: catalog.radius, span: catalog.span,
  samples: catalog.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }

test('walls run the full length of both window-side edges from the floor to a parapet', () => {
  for (const band of ['east', 'central', 'west']) {
    const meshes = metroEdgeWallMeshes(study, band, -16)
    const edges = catalog.edges.filter(e => e.band === band)
    expect(edges.map(e => e.side).sort()).toEqual([-1, 1])
    for (const edge of edges) {
      const own = meshes.filter(m => Math.abs(m.attributes.position[0] - edge.x) < 1e-3)
      let y = edge.y0, samples = 0
      for (const mesh of own) {
        const p = mesh.attributes.position, stations = p.length / 12
        // Chunks join without a gap: each starts where the previous ended.
        expect(p[1]).toBeCloseTo(y, 3)
        for (let i = 0; i < stations; i++) {
          const o = i * 12, ground = edge.top[Math.round((p[o + 1] - edge.y0) / catalog.spacing)] / 10
          expect(p[o]).toBeCloseTo(edge.x, 3); expect(p[o + 2]).toBe(-16)
          expect(p[o + 5]).toBeCloseTo(ground + EDGE_WALL.parapet, 3)
          // Cap and land face step inward, away from the window.
          expect(Math.sign(p[o + 6] - edge.x)).toBe(-edge.side)
          expect(p[o + 11]).toBeCloseTo(ground - EDGE_WALL.bury, 3)
        }
        y = p[p.length - 11]; samples += stations - 1
        expect(mesh.attributes.index.length).toBe((stations - 1) * 18)
      }
      expect(samples).toBe(edge.top.length - 1)
      expect(y).toBeCloseTo(edge.y0 + (edge.top.length - 1) * catalog.spacing, 3)
    }
  }
})

test('a different crop frame gets no walls', () => {
  const moved = { ...study, samples: study.samples.map(s => ({ ...s, frame: { ...(s.frame as object), angle: 0 } })) }
  expect(metroEdgeWallMeshes(moved, 'east', -16)).toEqual([])
})
