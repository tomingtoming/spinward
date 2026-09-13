import { riverLocalRoute } from '../app/riverWalkRoute'
import { riverCentre, type RiverDistrict } from './riverDistrictPlan'
import { sampleCitySurface } from './citySurfaceMesh'
import type { StreetWalkerRoute, WalkerPathPoint } from './streetWalkerRoutes'

/** Two quiet out-and-back walks use the existing upper path, end ramp and
 * lower bank. No road crossing or new population/batch allocation is added. */
export function planRiverWalkerRoutes(p: RiverDistrict | null, radius: number): StreetWalkerRoute[] {
  if (!p) return []
  const routes: StreetWalkerRoute[] = []
  for (const bank of [-1, 1]) {
    const startY = -bank * 70, endY = bank * 40
    const start = { azimuth: p.azimuth + (riverCentre(startY) + bank * 21) / radius, axial: p.axial + startY, groundHeight: 5.14 }
    const end = { azimuth: p.azimuth + (riverCentre(endY) + bank * 13.5) / radius, axial: p.axial + endY, groundHeight: 1.2 }
    const route = riverLocalRoute(p, radius, start, end)
    if (!route) continue
    const path: WalkerPathPoint[] = []
    // Sample the actual terrain once, including the short bevel across the
    // verge. Runtime needs only a binary lookup, not a scan of river triangles.
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], dx = (b.azimuth - a.azimuth) * radius, dy = b.axial - a.axial
      const length = Math.hypot(dx, dy), count = Math.ceil(length / .25)
      if (length < 1e-6) continue
      for (let j = 0; j <= count; j++) {
        if (j === 0 && path.length) continue
        const t = j / count, azimuth = a.azimuth + dx * t / radius, axial = a.axial + dy * t
        const hint = a.groundHeight! + (b.groundHeight! - a.groundHeight!) * t
        let height = 0
        for (const s of p.surfaces) {
          if (s.material !== 'stone' && s.material !== 'earth') continue
          const c = s.collider, x = (azimuth - c.azimuth) * radius, y = axial - c.axial
          if (Math.abs(x) > c.width / 2 + 1e-6 || Math.abs(y) > c.depth / 2 + 1e-6) continue
          height = Math.max(height, sampleCitySurface(c.surfaceMesh!, x, y, hint + .3))
        }
        if (Math.abs(height - hint) > .3) throw Error('Unsupported resident river path')
        const previous = path.at(-1)
        const distance = previous ? previous.distance + Math.hypot((azimuth - previous.azimuth) * radius, axial - previous.axial, height - previous.height) : 0
        path.push({ azimuth, axial, height, distance })
      }
    }
    if (path.length < 2) continue
    const length = path.at(-1)!.distance, speed = bank < 0 ? .95 : 1.08
    routes.push({ id: `river:${bank}`, ...start, axial: start.axial, axis: 'axial', tangentWidth: 1, axialLength: 1,
      height: 5.14, length, speed, phase: length / speed * (bank < 0 ? .45 : .72), variant: bank < 0 ? 2 : 5, path })
  }
  return routes
}
