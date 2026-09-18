import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'

const source = process.env.SPINWARD_INTERIOR_SOURCE
  ? new URL(process.env.SPINWARD_INTERIOR_SOURCE, 'file:///')
  : new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url)
const plan = JSON.parse(await fs.readFile(source, 'utf8'))
const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
const pose = (at, aim, flying = false) => {
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(aim),
    new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  return flying ? `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}` : `m=g&a=${at[0] / 3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
const views = []
for (const district of [...new Set(plan.streets.filter(s => s.blockInterior).map(s => s.district))]) {
  const street = plan.streets.filter(s => s.district === district && s.blockInterior)
    .sort((a, b) => b.profile.length - a.profile.length)[0]
  const rows = street.profile, i = Math.floor(rows.length / 2), at = rows[i], aim = rows[Math.min(rows.length - 1, i + 12)]
  views.push([district + '-interior-lane', pose(at, [aim[0], aim[1], aim[2] + 1.8])])
  views.push([district + '-interior-overview', pose([at[0] + 150, at[1] - 220, at[2] + 210], at, true)])
}
for (const n of plan.neighbourhoods ?? []) {
  if (plan.streets.some(s => s.district === n.id && s.blockInterior)) continue
  const p = plan.parcels.find(p => p.district === n.id), at = p.access.start
  views.push([n.id + '-retained-frontage', pose(at, [at[0] + Math.cos(p.yaw) * 45, at[1] + Math.sin(p.yaw) * 45, at[2] + 1.8])])
  views.push([n.id + '-retained-overview', pose([at[0] + 150, at[1] - 220, at[2] + 210], at, true)])
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
