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
for (const n of plan.neighbourhoods) {
  const street = plan.streets.find(s => s.district === n.id)
  const p = plan.parcels.find(p => p.district === n.id && (!street || p.lot.street === street.id))
  if (!p) throw Error('Street has no frontage: ' + n.id)
  const at = p.access.start
  views.push([n.id + '-frontage', pose(at, [at[0] + Math.cos(p.yaw) * 55, at[1] + Math.sin(p.yaw) * 55, at[2] + 2])])
  if (street) {
    const rows = street.profile, i = Math.floor(rows.length / 3)
    const a = rows[i], b = rows[Math.min(rows.length - 1, i + 7)]
    views.push([n.id + '-lane', pose(a, [b[0], b[1], b[2] + 1.8])])
  }
  views.push([n.id + '-overview', pose([at[0] + 110, at[1] - 180, at[2] + 180], at, true)])
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
