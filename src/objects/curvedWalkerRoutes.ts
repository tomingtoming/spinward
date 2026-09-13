import { curvedStreetPoint, type CurvedNeighborhood } from './curvedNeighborhood'
import type { StreetWalkerRoute, WalkerPathPoint } from './streetWalkerRoutes'

/** One walk on each footway, sharing the existing resident budget. Endpoints
 * stay inside the block: crossing the arterial requires a separate signal and
 * right-of-way policy. Keep the shoulder envelope clear of both kerbs. */
export function planCurvedWalkerRoutes(p: CurvedNeighborhood | null, radius: number): StreetWalkerRoute[] {
  if (!p || radius < 2000) return []
  const count = Math.ceil((p.knots[2].point[0] - p.knots[0].point[0]) / .4)
  return [-1, 1].map(side => {
    const path: WalkerPathPoint[] = []
    for (let i = 0; i <= count; i++) {
      const t = .03 + .94 * i / count, point = curvedStreetPoint(p, t, side * 4)
      const azimuth = p.azimuth + point.x / radius, axial = p.axial + point.y
      const previous = path.at(-1)
      const distance = previous ? previous.distance + Math.hypot(
        (azimuth - previous.azimuth) * radius, axial - previous.axial) : 0
      path.push({ azimuth, axial, height: .34, distance })
    }
    const length = path.at(-1)!.distance, speed = side < 0 ? .96 : 1.12
    const duration = length / speed
    return { id: `curve:${side}`, azimuth: path[0].azimuth, axial: path[0].axial,
      axis: 'tangent', tangentWidth: 1, axialLength: 1, height: .34,
      length, speed, phase: side < 0 ? duration * .44 : duration * 1.55 + 1.8,
      variant: side < 0 ? 1 : 4, path }
  })
}
