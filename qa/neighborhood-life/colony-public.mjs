import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
const places = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-public-spaces.json', import.meta.url), 'utf8')).places
const views = places.map(p => [p.id, 'visit=public-' + p.id])
const pose = (at, target) => {
  const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(target),
    new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  return `m=g&a=${at[0] / 3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
for (const id of ['a-river', 'b-campus', 'c-fields']) {
  const p = places.find(p => p.id === id)
  views.push([id + '-street', pose(p.target, [p.entry[0], p.entry[1], p.entry[2] + .5])])
  views.push([id + '-shelter', pose(p.target, [p.shelter[0], p.shelter[1], p.shelter[2] + 1])])
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
