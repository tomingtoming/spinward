import type { CityRoad, RoadKind } from './cityLayout'
import { sampleRoadCurve, type RoadKnot } from './roadCurve'

/** Centreline coordinates are local surface metres, independent of cylinder
 * orientation. A level identifies connected decks, not a rendering height. */
export type StreetPath = {
  id: string; azimuth: number; axial: number; kind: RoadKind; width: number
  knots: RoadKnot[]; level: number; groundHeight: number
}
export type StreetPathSample = ReturnType<typeof sampleRoadCurve> & { t: number }

export function sampleStreetPath(path: Pick<StreetPath, 'knots'>, t: number, offset = 0) {
  const n = path.knots.length - 1
  if (n < 1) throw Error('A street needs at least two centreline knots')
  const along = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(along))
  return sampleRoadCurve(path.knots[i], path.knots[i + 1], along - i, offset)
}

/** Straight streets stay one segment. Curves subdivide by the error of both
 * kerb edges, so narrow chords cannot silently cut a wide curved carriageway. */
export function streetPathSamples(path: StreetPath, tolerance = .025): StreetPathSample[] {
  if (!(path.width > 0) || !(tolerance > 0) || path.knots.length < 2) throw Error('Invalid street dimensions')
  if (![path.azimuth,path.axial,path.width,path.groundHeight,path.level,...path.knots.flatMap(k=>[...k.point,...k.tangent])].every(Number.isFinite)) throw Error('Non-finite street coordinate')
  const out: StreetPathSample[] = [{ ...sampleStreetPath(path, 0), t: 0 }]
  if(path.knots.length===2){
    const [a,b]=path.knots, dx=b.point[0]-a.point[0],dy=b.point[1]-a.point[1]
    if(a.tangent[0]===dx&&b.tangent[0]===dx&&a.tangent[1]===dy&&b.tangent[1]===dy)
      return [...out,{...sampleStreetPath(path,1),t:1}]
  }
  const split = (a: number, b: number, depth: number) => {
    let error = 0
    for (const offset of [-path.width / 2, 0, path.width / 2]) {
      const start = sampleStreetPath(path, a, offset), end = sampleStreetPath(path, b, offset)
      for (const f of [.25, .5, .75]) {
        const p = sampleStreetPath(path, a + (b - a) * f, offset)
        error = Math.max(error, Math.hypot(p.x - start.x - (end.x - start.x) * f, p.y - start.y - (end.y - start.y) * f))
      }
    }
    if (error > tolerance) {
      if (depth >= 16) throw Error('Street curvature exceeds the subdivision budget')
      const middle = (a + b) / 2
      split(a, middle, depth + 1); split(middle, b, depth + 1)
    } else out.push({ ...sampleStreetPath(path, b), t: b })
  }
  for (let i = 0; i < path.knots.length - 1; i++) split(i / (path.knots.length - 1), (i + 1) / (path.knots.length - 1), 0)
  return out
}

/** Shared by visible ribbons, supported floors and route rasterisation. */
export function streetRibbon(path: Pick<StreetPath, 'knots'>, start: number, end: number, low: number, high: number) {
  return [sampleStreetPath(path, start, low), sampleStreetPath(path, end, low),
    sampleStreetPath(path, end, high), sampleStreetPath(path, start, high)]
}

export function legacyStreetPaths(roads: readonly CityRoad[]): StreetPath[] {
  return roads.map((road, index) => {
    const axial = road.axialLength > road.tangentWidth
    const dx = axial ? 0 : road.tangentWidth, dy = axial ? road.axialLength : 0
    return { id: road.id ?? `road-${index}`, azimuth: road.azimuth, axial: road.axial,
      width: axial ? road.tangentWidth : road.axialLength, kind: road.kind, level: 0, groundHeight: 0,
      knots: [{ point: [-dx / 2, -dy / 2], tangent: [dx, dy] },
        { point: [dx / 2, dy / 2], tangent: [dx, dy] }] }
  })
}
