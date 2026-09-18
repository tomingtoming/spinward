import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import raw from './colony-source'
import plan from '../../assets/blender/izma-neighbourhood-parcels.json'
import transport from '../../assets/blender/izma-transport.json'
import land from '../../assets/blender/izma-land-use.json'
import { readColonyManifest } from '../../src/worlds/authoredColony'
import { ColonyCollisionCache } from '../../src/worlds/colonyCollisionCache'
import { landscapeColliders } from '../../src/worlds/authoredLandscape'
import { buildCityCollisionIndex, collectCityCollidersNear, type CityBuilding } from '../../src/objects/cityLayout'

const m = readColonyManifest(raw), cache = new ColonyCollisionCache()
const bodies = [m.base, m.architecture!.fixed, m.publicRealm!.fixed, m.neighbourhoods!.fixed, ...(m.railways ? [m.railways.fixed] : []), ...(m.landUse ? [m.landUse.fixed] : [])].flatMap(p => cache.colliders(p, 3200))
bodies.push(...landscapeColliders({ surfaces: [], solids: [...m.structures!, ...m.architecture!.solids, ...m.neighbourhoods!.solids]
  .map(([x, y, z, width, depth, height, yaw]) => ({ x, y, z, width, depth, height, yaw })) }, 3200))
const index = buildCityCollisionIndex(bodies, 3200, 40000), near = new Set<CityBuilding>()
let samples = 0, maxBodies = 0, worst = { triangles: 0, x: 0, y: 0, scope: '' }
const check = (x: number, y: number, scope: string) => {
  collectCityCollidersNear(index, x / 3200, y, 1, near)
  const triangles = [...near].reduce((n, b) => n + (b.surfaceMesh?.length ?? 0) / 9, 0)
  samples++; maxBodies = Math.max(maxBodies, near.size)
  if (triangles > worst.triangles) worst = { triangles, x, y, scope }
}
for (const route of transport.profiles) for (let i = 0; i < route.points.length; i += 5) {
  const [x, y] = route.points[i]
  if (route.band === 0 && Math.abs(x) < 320 && Math.abs(y) < 400) continue
  check(x + route.band * Math.PI * 6400 / 3, y, route.id)
}
const transportSamples = samples
for (const n of plan.neighbourhoods) {
  const members = plan.parcels.filter(p => p.district === n.id), points = members.flatMap(p => p.lot.polygon)
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  for (let x = Math.min(...xs) - 64; x <= Math.max(...xs) + 64; x += 16)
    for (let y = Math.min(...ys) - 64; y <= Math.max(...ys) + 64; y += 16) check(x, y, n.id)
}
const neighbourhoodGridSamples = samples - transportSamples
for(const zone of land.zones) {
  const xs=zone.outline.map(p=>p[0]),ys=zone.outline.map(p=>p[1])
  for(let x=Math.min(...xs)-32;x<=Math.max(...xs)+32;x+=16)
    for(let y=Math.min(...ys)-32;y<=Math.max(...ys)+32;y+=16)check(x,y,zone.id)
}
const result = { samples, transportSamples, neighbourhoodGridSamples, landUseGridSamples: samples-transportSamples-neighbourhoodGridSamples,
  gridSpacing: 16, maxBodies, worst, collisionCache: cache.stats, scope: 'actual distance-refined Rapier set; full preserved triangles; no frame-time claim' }
const out = resolve(process.env.SPINWARD_EVIDENCE_DIR ?? 'qa/webxr/evidence/colony-neighbourhoods-20260918/verified')
await mkdir(out, { recursive: true }); await writeFile(resolve(out, 'local-cost.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (maxBodies > 32 || worst.triangles > 4096) throw Error('Local collider budget exceeded')
