import type { CityBuilding, CityRoad } from './cityLayout'
import { FOOTPATH_WIDTH } from './streetProfile'

export type StreetAccess = {
  // Stable within a generated plan. Consumers must use that plan's roads.
  roadId: string
  roadIndex: number
  entrance: { azimuth: number; axial: number }
  roadEdge: { azimuth: number; axial: number }
  width: number
  length: number
}

type Rect = { azimuth: number; axial: number; tangentWidth: number; axialLength: number }
const TAU = Math.PI * 2
const wrap = (angle: number) => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI
export const roadId = (index: number) => `road-${index}`

// A cylindrical spatial index: queries wrap at the seam, long arterials are
// indexed across every cell they cross, not just by their centres.
export class SurfaceIndex {
  private readonly cells = new Map<string, number[]>()
  private readonly columns: number
  private readonly pitch: number
  constructor(private readonly radius: number) {
    this.columns = Math.max(1, Math.ceil(TAU * radius / 128))
    this.pitch = TAU * radius / this.columns
  }
  private keys(rect: Rect) {
    const x = ((rect.azimuth % TAU) + TAU) % TAU * this.radius
    const keys = new Set<string>()
    const start = Math.floor((x - rect.tangentWidth / 2) / this.pitch)
    const end = Math.min(start + this.columns - 1, Math.floor((x + rect.tangentWidth / 2) / this.pitch))
    for (let i = start; i <= end; i++) {
      const col = ((i % this.columns) + this.columns) % this.columns
      for (let j = Math.floor((rect.axial - rect.axialLength / 2) / 128);
        j <= Math.floor((rect.axial + rect.axialLength / 2) / 128); j++) keys.add(`${col}:${j}`)
    }
    return keys
  }
  insert(rect: Rect, id: number) {
    for (const key of this.keys(rect)) {
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(id)
      else this.cells.set(key, [id])
    }
  }
  query(rect: Rect) {
    const ids = new Set<number>()
    for (const key of this.keys(rect)) for (const id of this.cells.get(key) ?? []) ids.add(id)
    return ids
  }
}

const overlaps = (a: Rect, b: Rect, radius: number, tolerance = 0) =>
  Math.abs(wrap(a.azimuth - b.azimuth)) * radius < (a.tangentWidth + b.tangentWidth) / 2 + tolerance &&
  Math.abs(a.axial - b.axial) < (a.axialLength + b.axialLength) / 2 + tolerance
const footprint = (b: CityBuilding): Rect => ({ ...b, tangentWidth: b.width, axialLength: b.depth })
const roadsConnect = (a: Rect, b: Rect, radius: number) => {
  const dx = Math.abs(wrap(a.azimuth - b.azimuth)) * radius
  const dy = Math.abs(a.axial - b.axial)
  const x = Math.min(a.tangentWidth, b.tangentWidth, (a.tangentWidth + b.tangentWidth) / 2 - dx)
  const y = Math.min(a.axialLength, b.axialLength, (a.axialLength + b.axialLength) / 2 - dy)
  // Shared edges are valid, but a corner touch is not a usable junction.
  const clearance = Math.min(1.3, a.tangentWidth, a.axialLength, b.tangentWidth, b.axialLength)
  return x >= -1e-5 && y >= -1e-5 && Math.max(x, y) >= clearance - 1e-5
}

export type StreetAccessRejection = { building: CityBuilding; reason: 'missing-front' | 'road-overlap' | 'no-connected-frontage' | 'blocked-path' }

export const certifyStreetAccess = (
  buildings: CityBuilding[], roads: CityRoad[], radius: number, maxGap: number,
  fit: (building: CityBuilding) => CityBuilding = b => b
) => {
  const roadIndex = new SurfaceIndex(radius)
  const buildingIndex = new SurfaceIndex(radius)
  const parents = roads.map((_, i) => i)
  const root = (i: number): number => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i] }
    return i
  }
  roads.forEach((road, i) => {
    for (const other of roadIndex.query(road)) {
      if (roadsConnect(road, roads[other], radius)) parents[root(i)] = root(other)
    }
    roadIndex.insert(road, i)
  })
  const connected = new Set(roads.flatMap((r, i) => r.kind === 'arterial' ? [root(i)] : []))
  buildings.forEach((b, i) => buildingIndex.insert(footprint(b), i))
  const accepted: Array<CityBuilding & { front: NonNullable<CityBuilding['front']>; access: StreetAccess }> = []
  const rejected: StreetAccessRejection[] = []
  buildings.forEach((original, index) => {
    const b = fit(original)
    if (!b.front) { rejected.push({ building: original, reason: 'missing-front' }); return }
    const front = b.front
    const axis = front.axis
    const fittedGap = maxGap + Math.abs(wrap(b.azimuth - original.azimuth)) * radius +
      Math.abs(b.axial - original.axial) + Math.max(original.width - b.width, original.depth - b.depth, 0) / 2
    const candidates = roadIndex.query({ ...footprint(original), tangentWidth: original.width + maxGap * 2, axialLength: original.depth + maxGap * 2 })
    if ([...candidates].some(i => overlaps(footprint(original), roads[i], radius, -1e-5))) {
      rejected.push({ building: original, reason: 'road-overlap' }); return
    }
    let best: StreetAccess | null = null
    let blocked = false
    for (const i of candidates) {
      if (!connected.has(root(i))) continue
      const road = roads[i]
      const dt = wrap(road.azimuth - b.azimuth) * radius
      const da = road.axial - b.axial
      const along = (axis === 'tangent' ? dt : da) * front.side
      const half = (axis === 'tangent' ? b.width : b.depth) / 2
      const roadHalf = (axis === 'tangent' ? road.tangentWidth : road.axialLength) / 2
      const gap = along - half - roadHalf
      const width = Math.min(FOOTPATH_WIDTH, (axis === 'tangent' ? b.depth : b.width) * 0.5)
      const cross = axis === 'tangent' ? da : dt
      const roadCross = (axis === 'tangent' ? road.axialLength : road.tangentWidth) / 2
      // The full path width must meet the road, not just touch its corner.
      if (along <= 0 || gap < -1e-5 || gap > fittedGap || Math.abs(cross) + width / 2 > roadCross + 1e-5) continue
      const entry = { azimuth: b.azimuth + (axis === 'tangent' ? front.side * half / radius : 0),
        axial: b.axial + (axis === 'axial' ? front.side * half : 0) }
      const edge = { azimuth: entry.azimuth + (axis === 'tangent' ? front.side * gap / radius : 0),
        axial: entry.axial + (axis === 'axial' ? front.side * gap : 0) }
      const path: Rect = { azimuth: entry.azimuth + (axis === 'tangent' ? front.side * gap / (2 * radius) : 0),
        axial: (entry.axial + edge.axial) / 2,
        tangentWidth: axis === 'tangent' ? Math.max(0, gap) : width,
        axialLength: axis === 'axial' ? Math.max(0, gap) : width }
      if ([...buildingIndex.query(path)].some(other => other !== index && overlaps(path, footprint(buildings[other]), radius, -1e-5))) {
        blocked = true; continue
      }
      if (best === null || gap < best.length) best = { roadId: roadId(i), roadIndex: i, entrance: entry, roadEdge: edge, width, length: Math.max(0, gap) }
    }
    if (best) accepted.push({ ...original, front, access: best, streetKind: roads[best.roadIndex].kind })
    else rejected.push({ building: original, reason: blocked ? 'blocked-path' : 'no-connected-frontage' })
  })
  return { buildings: accepted, rejected }
}
