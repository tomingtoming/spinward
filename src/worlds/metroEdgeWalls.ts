import catalog from './generated/metroEdges.json'
import { matchesMetroFrames, type MetroStudyFrame } from './metroPlaces'

// Retaining walls close the open window-side edges of the Tokyo terrain
// sheet (toming, 2026-09-30). Each wall runs from the structural floor to a
// parapet above the edge, with a cap and a short inner face on the land side.
export const EDGE_WALL = { parapet: 1.1, cap: .3, bury: .5, colour: '#b3b5ad', roughness: .94, panel: 6, course: 3 }
const CHUNK = 200 // stations per mesh: 2 km at 10 m spacing

export type EdgeWallMesh = { name: string; colour: string; roughness: number; solid: true
  attributes: { position: Float32Array; index: Uint32Array } }

/** Source-metre wall meshes for one strip, or none if the crop differs. */
export function metroEdgeWallMeshes(study: MetroStudyFrame, bandId: string, floorHeight: number): EdgeWallMesh[] {
  if (!matchesMetroFrames(study, catalog)) return []
  const meshes: EdgeWallMesh[] = []
  for (const edge of catalog.edges) {
    if (edge.band !== bandId) continue
    const inner = edge.x - edge.side * EDGE_WALL.cap, last = edge.top.length - 1
    for (let start = 0; start < last; start += CHUNK) {
      const end = Math.min(last, start + CHUNK), count = end - start + 1
      const position = new Float32Array(count * 4 * 3), index: number[] = []
      for (let i = 0; i < count; i++) {
        const y = edge.y0 + (start + i) * catalog.spacing, ground = edge.top[start + i] / 10, top = ground + EDGE_WALL.parapet
        position.set([edge.x, y, floorHeight, edge.x, y, top, inner, y, top, inner, y, ground - EDGE_WALL.bury], i * 12)
        if (!i) continue
        // Outer face (floor to parapet), cap, then the parapet's land face.
        for (let k = 0; k < 3; k++) {
          const a = (i - 1) * 4 + k, b = i * 4 + k
          index.push(a, b, a + 1, a + 1, b, b + 1)
        }
      }
      meshes.push({ name: 'edge-walls', colour: EDGE_WALL.colour, roughness: EDGE_WALL.roughness, solid: true,
        attributes: { position, index: Uint32Array.from(index) } })
    }
  }
  return meshes
}

/** Concrete panel UVs: 6 m panels along the wall, 3 m courses up from the floor. */
export function edgeWallUV(position: ArrayLike<number>, floorHeight: number) {
  const uv = new Float32Array(position.length / 3 * 2)
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = position[i * 3 + 1] / EDGE_WALL.panel
    uv[i * 2 + 1] = (position[i * 3 + 2] - floorHeight) / EDGE_WALL.course
  }
  return uv
}

/** Light concrete tile: a formwork joint on two edges, grain and faint streaks. */
export function edgeWallCanvas(size = 256) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
  const c = canvas.getContext('2d')!, image = c.createImageData(size, size)
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const streaks = Array.from({ length: 9 }, () => [Math.floor(random() * size), 2 + random() * 5, .04 + random() * .06])
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 214 + (random() - .5) * 14
    for (const [sx, w, d] of streaks) if (Math.abs(x - sx) < w) v *= 1 - d * (y / size)
    if (x < 3 || y > size - 4) v *= .62
    const o = (y * size + x) * 4
    image.data.set([v, v * 1.005, v * .975, 255], o)
  }
  c.putImageData(image, 0, 0)
  return canvas
}
