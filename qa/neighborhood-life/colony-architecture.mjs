import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'

const { parcels } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-parcels.json', import.meta.url), 'utf8'))
const pose = (at, aim) => {
  const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point(at), point(aim), new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  return `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`
}
const views = [], selected = []
for (const family of [...new Set(parcels.map(p => p.family))]) {
  const p = parcels.filter(p => p.family === family && p.floors <= 7).sort((a, b) => a.size[0] - b.size[0])[Math.floor(parcels.filter(p => p.family === family && p.floors <= 7).length / 2)]
  const [x, y] = p.position, c = Math.cos(p.yaw), s = Math.sin(p.yaw), distance = p.size[1] / 2 + Math.max(20, p.size[0] * 1.4)
  views.push(['architecture-' + family, pose([x + s * distance + c * 6, y - c * distance + s * 6, p.floor + Math.min(9, p.size[2] * .4)], [x, y, p.floor + p.size[2] * .4])])
  selected.push({ family, id: p.id, district: p.district, position: p.position, floor: p.floor })
}
const plan = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-colony-plan.json', import.meta.url), 'utf8'))
for (const district of plan.districts) {
  const cx = district.centre[0] + district.band * Math.PI * 6400 / 3, cy = district.centre[1]
  const p = parcels.filter(p => p.district === district.id).sort((a, b) => Math.hypot(a.position[0] - cx, a.position[1] - cy) - Math.hypot(b.position[0] - cx, b.position[1] - cy))[0]
  views.push(['district-' + district.id, pose([p.position[0] + 125, p.position[1] - 170, p.floor + 85], [...p.position, p.floor + 6])])
}
const stairs = [...parcels].sort((a, b) => Math.abs(b.access.end[2] - b.access.start[2]) - Math.abs(a.access.end[2] - a.access.start[2]))[0]
const [sx, sy, sh] = stairs.access.start
views.push(['entrance-stairs', pose([sx - 3, sy - 2, sh + 1.8], stairs.doors[0].map((n, i) => n + (i === 2 ? 1.5 : 0)))])
process.env.SPINWARD_EVIDENCE_DIR ??= fileURLToPath(new URL('../webxr/evidence/colony-architecture-20260918/', import.meta.url))
await fs.mkdir(process.env.SPINWARD_EVIDENCE_DIR, { recursive: true })
await fs.writeFile(process.env.SPINWARD_EVIDENCE_DIR + '/selected-buildings.json', JSON.stringify(selected, null, 2) + '\n')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
