import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'

const plan = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-transport.json', import.meta.url), 'utf8'))
const pose = (at, aim) => {
  const r = 3200, point = ([x, y, h]) => new Vector3(Math.cos(x / r) * (r - h), y, Math.sin(x / r) * (r - h))
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(aim), new Vector3(-Math.cos(at[0] / r), 0, -Math.sin(at[0] / r))))
  return `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`
}
const views = []
const vergeRoute = plan.profiles.find(p => p.id === 'a-river-neighbourhood-road')
const vergePoint = [...vergeRoute.points].sort((a, b) => Math.hypot(a[0] - 206.5, a[1] - 446.5) - Math.hypot(b[0] - 206.5, b[1] - 446.5))[0]
views.push(['street-verge', pose([vergePoint[0] + 13, vergePoint[1] - 16, vergePoint[2] + 4], vergePoint)])
for (const crossing of plan.crossings) {
  if (!crossing.separated && !crossing.routes.includes('b-station-access')) continue
  const x = crossing.xy[0] + crossing.band * Math.PI * 6400 / 3, y = crossing.xy[1], h = Math.min(...crossing.heights)
  views.push([crossing.separated ? 'rail-crossing' : 'street-crossing', pose([x - 42, y - 48, h + 24], [x, y, h])])
}
for (let band = 0; band < 3; band++) {
  const road = plan.profiles.find(p => p.id === `band-${band}-expressway`)
  const p = road.points[Math.floor(road.points.length * .37)]
  const x = p[0] + band * Math.PI * 6400 / 3
  views.push([`highway-${band}`, pose([x - 65, p[1] - 65, p[2] - 12], [x, p[1], p[2] - 2])])
  const bridge = plan.bridgeSamples.find(b => b.band === band && b.route.includes('station-road'))
  if (bridge) {
    const [bx, by, h] = bridge.position, globalX = bx + band * Math.PI * 6400 / 3
    views.push([`bridge-${band}`, pose([globalX - 70, by - 75, h + 30], [globalX, by, h])])
  }
}
process.env.SPINWARD_EVIDENCE_DIR ??= fileURLToPath(new URL('../webxr/evidence/colony-transport-20260917/', import.meta.url))
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
