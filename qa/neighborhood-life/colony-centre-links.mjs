import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'

const plan = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url), 'utf8'))
const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
const pose = (at, target, flying = false) => {
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(target),
    new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  return flying ? `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}` : `m=g&a=${at[0] / 3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
const views = []
for (const district of [...new Set(plan.streets.filter(s => s.role === 'district-link').map(s => s.district))]) {
  const street = plan.streets.filter(s => s.district === district && s.role === 'district-link')
    .sort((a, b) => plan.parcels.filter(p => p.lot.street === b.id).length - plan.parcels.filter(p => p.lot.street === a.id).length)[0]
  const rows = street.profile, i = Math.floor(rows.length / 2), at = rows[i], aim = rows[Math.min(rows.length - 1, i + 12)]
  views.push([district + '-centre-lane', pose(at, [aim[0], aim[1], aim[2] + 1.8])])
  views.push([district + '-centre-overview', pose([at[0] + 150, at[1] - 220, at[2] + 210], at, true)])
}
for (const n of plan.neighbourhoods.filter(n => !plan.streets.some(s => s.district === n.id && s.role === 'district-link'))) {
  const p = plan.parcels.find(p => p.district === n.id), at = p.access.start
  views.push([n.id + '-retained-frontage', pose(at, [at[0] + Math.cos(p.yaw) * 45, at[1] + Math.sin(p.yaw) * 45, at[2] + 1.8])])
  views.push([n.id + '-retained-overview', pose([at[0] + 150, at[1] - 220, at[2] + 210], at, true)])
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
