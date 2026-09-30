import catalog from './generated/metroBridges.json'
import { matchesMetroFrames, type MetroStudyFrame } from './metroPlaces'
import type { EdgeWallMesh } from './metroEdgeWalls'

// Short-span viaducts over the windows (toming, 2026-09-30). All geometry is
// in a strip's source metres; the curved-tile path bends it onto the cylinder
// vertex by vertex. Window upkeep robots roam between the piers (windowRobots).
export const VIADUCT = { girder: 1.6, parapet: 1.1, wall: .3, segment: 25, pier: 1.4, capDepth: 1.2,
  deck: '#a9aca5', rail: '#6b7275' }
const GAUGE = 1.435, TRACK_CENTRES = 3.6

type Box = [number, number, number, number, number, number] // x0 x1 y0 y1 h0 h1
function mesh(name: string, colour: string, boxes: Box[]): EdgeWallMesh {
  const position = new Float32Array(boxes.length * 24), index = new Uint32Array(boxes.length * 36)
  boxes.forEach(([x0, x1, y0, y1, h0, h1], b) => {
    const corners = [[x0, y0, h0], [x1, y0, h0], [x1, y1, h0], [x0, y1, h0], [x0, y0, h1], [x1, y0, h1], [x1, y1, h1], [x0, y1, h1]]
    corners.forEach((c, i) => position.set(c, b * 24 + i * 3))
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    faces.forEach(([p, q, r, s], f) => index.set([p, q, r, p, r, s].map(v => b * 8 + v), b * 36 + f * 6))
  })
  return { name, colour, roughness: .9, solid: true, attributes: { position, index } }
}
/** Split [a, b] into pieces no longer than step so the curve can follow. */
const pieces = (a: number, b: number, step: number) => {
  const n = Math.max(1, Math.ceil((b - a) / step))
  return Array.from({ length: n }, (_, i) => [a + (b - a) * i / n, a + (b - a) * (i + 1) / n] as const)
}

export type MetroBridge = (typeof catalog.bridges)[number]
export function metroBridges(study: MetroStudyFrame): MetroBridge[] {
  return matchesMetroFrames(study, catalog) ? catalog.bridges : []
}

/** Deck, parapets and piers collide; rails are drawn only. */
export function metroBridgeMeshes(study: MetroStudyFrame, bandId: string, floorHeight: number) {
  const solid: Box[] = [], rails: Box[] = []
  for (const b of metroBridges(study)) {
    if (b.band !== bandId) continue
    const w = b.width / 2, top = b.height, under = top - VIADUCT.girder
    for (const [x0, x1] of pieces(b.x0, b.x1, VIADUCT.segment)) {
      solid.push([x0, x1, b.y - w, b.y + w, under, top])
      for (const side of [-1, 1]) {
        const outer = b.y + side * w, inner = outer - side * VIADUCT.wall
        solid.push([x0, x1, Math.min(inner, outer), Math.max(inner, outer), top, top + VIADUCT.parapet])
      }
      for (let t = 0; t < b.tracks; t++) {
        const centre = b.y + (t - (b.tracks - 1) / 2) * TRACK_CENTRES
        for (const g of [-GAUGE / 2, GAUGE / 2]) rails.push([x0, x1, centre + g - .035, centre + g + .035, top, top + .15])
      }
    }
    for (let x = b.x0 + catalog.pierSpacing; x < b.x1 - 10; x += catalog.pierSpacing) {
      solid.push([x - VIADUCT.pier, x + VIADUCT.pier, b.y - VIADUCT.pier, b.y + VIADUCT.pier, floorHeight, under])
      solid.push([x - 1, x + 1, b.y - w * .85, b.y + w * .85, under - VIADUCT.capDepth, under])
    }
  }
  return {
    solid: solid.length ? [mesh('window-viaducts', VIADUCT.deck, solid)] : [],
    detail: rails.length ? [mesh('viaduct-rails', VIADUCT.rail, rails)] : []
  }
}

/** Wall openings where viaducts meet both strips (source y ranges per edge). */
export function metroBridgeOpenings(study: MetroStudyFrame) {
  return metroBridges(study).flatMap(b => {
    const y0 = b.y - b.width / 2 - .05, y1 = b.y + b.width / 2 + .05
    return [{ band: b.band, side: 1, y0, y1 }, { band: b.far, side: -1, y0, y1 }]
  })
}
