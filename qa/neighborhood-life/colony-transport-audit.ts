import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import raw from '../../src/worlds/generated/izmaColony.json'
import { IZMA_MASTER_PLAN as plan } from '../../src/worlds/izmaMasterPlan'
import { decodeColonyMesh, readColonyManifest } from '../../src/worlds/authoredColony'
import { landscapeColliders } from '../../src/worlds/authoredLandscape'
import { buildCityCollisionIndex, getCityGroundHeight } from '../../src/objects/cityLayout'

// This is a diagnosis of the current massing model, not a pass/fail test of
// finished transport. Keep route IDs and measured defects for the next edit.
const manifest = readColonyManifest(raw), data = decodeColonyMesh(manifest.base)
function surfaceIndex(vertices: number[]) {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < vertices.length; i += 9) {
    const x = (vertices[i] + vertices[i + 3] + vertices[i + 6]) / 3
    const y = (vertices[i + 1] + vertices[i + 4] + vertices[i + 7]) / 3
    const key = `${Math.floor(x / 256)}:${Math.floor(y / 256)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(...vertices.slice(i, i + 9))
  }
  const surfaces = [...groups.values()].map(vertices => {
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1)
    return { vertices, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] }
  })
  return buildCityCollisionIndex(landscapeColliders({ surfaces, solids: [] }, plan.radius), plan.radius, plan.span)
}
const earth = surfaceIndex(data.meshes.earth)
const routes = Object.fromEntries(['local', 'arterial', 'expressway', 'rail'].map(kind => [kind, surfaceIndex(data.meshes[kind] ?? [])]))
const nodes = new Map(plan.nodes.map(n => [n.id, n]))
const results = plan.routes.map(route => {
  const ns = route.nodes.map(id => nodes.get(id)!)
  if (new Set(ns.map(n => n.band)).size > 1) return { id: route.id, kind: route.kind, status: 'reserved connection; no runtime structure' }
  const band = ns[0].band, index = routes[route.kind]
  if (!index) return { id: route.id, kind: route.kind, status: 'no runtime route material' }
  const water = plan.water[band], samples: { xy: number[]; ground: number; road: number; gap: number; nearWater: boolean }[] = []
  let skippedStudy = 0, missing = 0
  for (let segment = 0; segment < ns.length - 1; segment++) {
    const a = ns[segment].xy, b = ns[segment + 1].xy, count = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 100))
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t
      if (band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) { skippedStudy++; continue }
      const azimuth = band * Math.PI * 2 / 3 + x / plan.radius
      const ground = getCityGroundHeight(earth, plan.radius, azimuth, y, 400)
      const road = getCityGroundHeight(index, plan.radius, azimuth, y, 400)
      if (road === 0) { missing++; continue }
      const reach = water.reach.findIndex((p, j) => j > 0 && y <= p[1]), k = reach < 0 ? water.reach.length - 1 : reach
      const lo = water.reach[Math.max(0, k - 1)], hi = water.reach[k]
      const u = Math.max(0, Math.min(1, (y - lo[1]) / (hi[1] - lo[1] || 1))), riverX = lo[0] + (hi[0] - lo[0]) * u
      samples.push({ xy: [x, y], ground, road, gap: road - ground, nearWater: Math.abs(x - riverX) < water.bankWidth })
    }
  }
  const dry = samples.filter(s => !s.nearWater), gaps = samples.map(s => s.gap).sort((a, b) => a - b)
  return { id: route.id, kind: route.kind, band, samples: samples.length, skippedStudy, missing,
    medianGap: gaps[Math.floor(gaps.length / 2)] ?? null, minGap: gaps[0] ?? null, maxGap: gaps.at(-1) ?? null,
    drySamples: dry.length, dryRaisedOverHalfMetre: dry.filter(s => s.gap > .5).length,
    buriedOverTenCentimetres: samples.filter(s => s.gap < -.1),
    worst: samples.sort((a, b) => b.gap - a.gap).slice(0, 3) }
})
const out = fileURLToPath(new URL('../webxr/evidence/colony-runtime-20260917/transport-audit.json', import.meta.url))
await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify({ note: 'Actual exported surface heights; dry raised ribbon is not proof of a supported viaduct. Interval samples are not continuous route certification.', results }, null, 2) + '\n')
console.log(JSON.stringify({ out, routes: results.length, unbuiltConnections: results.filter(r => 'status' in r).length,
  samples: results.reduce((n, r) => n + ('samples' in r ? r.samples ?? 0 : 0), 0),
  missing: results.reduce((n, r) => n + ('missing' in r ? r.missing ?? 0 : 0), 0),
  buried: results.reduce((n, r) => n + ('buriedOverTenCentimetres' in r ? r.buriedOverTenCentimetres?.length ?? 0 : 0), 0) }))
