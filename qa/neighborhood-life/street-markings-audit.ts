import { planCity } from '../../src/objects/cityLayout'
import { legacyStreetPaths, type StreetPath } from '../../src/objects/streetPath'
import { StreetNetwork } from '../../src/objects/streetNetwork'
import { StreetMarkingPlan } from '../../src/objects/streetMarkings'
import { StreetSurfacePlan } from '../../src/objects/streetSurfacePlan'
import { buildStreetSurfaceGeometry } from '../../src/objects/streetSurfaceGeometry'
import { layoutIntersection, selectNearbyIntersections } from '../../src/objects/intersectionFurniture'
import { writeFileSync, mkdirSync } from 'node:fs'

const radius = 3200, root = new URL('../webxr/evidence/street-markings-20260913/', import.meta.url)
mkdirSync(root, { recursive: true })
const city = planCity({ radius, length: 40000, maxBuildings: 18000 }), network = new StreetNetwork(legacyStreetPaths(city.roads), radius)
const runs = []
for (let run = 0; run < 5; run++) {
  const t = performance.now(), plan = new StreetMarkingPlan(network), indexMs = performance.now() - t
  const views = []
  for (const [azimuth, axial] of [[0, 300], [.0194, -17432.8], [2.094, 300]]) {
    const start = performance.now(), crossings = plan.crossings(azimuth, axial, 420), paint = plan.paint(crossings)
    const geometry = buildStreetSurfaceGeometry(paint, radius, 1), nativeMs = performance.now() - start
    const before = performance.now(), old = selectNearbyIntersections(city.intersections, radius, azimuth, axial).map(x => layoutIntersection(x, radius))
    const oldPlanMs = performance.now() - before, oldStripes = old.reduce((n, l) => n + l.stripes.length, 0)
    views.push({ azimuth, axial, nativeMs, oldPlanMs, crossings: crossings.length, pieces: paint.length,
      nativeTriangles: (geometry?.index?.count ?? 0) / 3, oldZebraTriangles: oldStripes * 12,
      oldStopLineTriangles: old.reduce((n, l) => n + l.stopLines.length * 12, 0) })
    geometry?.dispose()
  }
  if (run) runs.push({ indexMs, views })
}
writeFileSync(new URL('cost.json', root), JSON.stringify({ runtime: Bun.version, runs }, null, 2))
console.log(JSON.stringify({ runs }))

const line = (id: string, a: [number, number], b: [number, number], width = 6): StreetPath => {
  const tangent: [number, number] = [b[0] - a[0], b[1] - a[1]]
  return { id, azimuth: 0, axial: 0, width, kind: 'local', level: 0, groundHeight: 0, knots: [{ point: a, tangent }, { point: b, tangent }] }
}
const fixtures: Record<string, StreetPath[]> = {
  skew: [line('a', [-60, 0], [60, 0], 12), line('b', [-45, -38], [45, 38])],
  tee: [line('a', [-60, 0], [60, 0], 12), line('b', [0, 0], [40, 50])],
  curve: [{ ...line('a', [-60, 0], [60, 0]), knots: [{ point: [-60, 0], tangent: [120, 70] }, { point: [60, 0], tangent: [120, 70] }] }, line('b', [0, -55], [0, 55], 12)]
}
for (const [name, paths] of Object.entries(fixtures)) {
  const pavement = new StreetSurfacePlan(paths, radius), markings = new StreetMarkingPlan(new StreetNetwork(paths, radius))
  const polygons = (surfaces: ReturnType<StreetSurfacePlan['roadSurfaces']>, fill: string) => surfaces.map(s =>
    `<polygon fill="${fill}" points="${s.polygon.map(p => `${p.x},${-p.y}`).join(' ')}"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="840" viewBox="-65 -65 130 130"><rect x="-65" y="-65" width="130" height="130" fill="#728473"/>${polygons(pavement.sidewalks(), '#aaa99f')}${polygons(pavement.roadSurfaces(), '#30343b')}${polygons(markings.paint(markings.crossings(0, 0, 100)), '#e9ecef')}</svg>`
  writeFileSync(new URL(`${name}.svg`, root), svg)
}

if (process.argv.includes('--render')) {
  const { chromium } = await import('@playwright/test')
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 840, height: 840 } })
    for (const name of Object.keys(fixtures)) {
      await page.setContent(`<style>body{margin:0}</style>${readFileSync(new URL(`${name}.svg`, root), 'utf8')}`)
      await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, root)) })
    }
  } finally { await browser.close() }
}
