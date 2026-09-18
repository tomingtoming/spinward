import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'

const { parcels } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url), 'utf8'))
const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
const views = []
for (const [district, family] of [['a-old-town', 'shop-house'], ['a-river', 'house'], ['b-housing', 'apartment'],
  ['b-station', 'office'], ['c-market', 'shop-house'], ['c-fields', 'farmhouse']]) {
  const p = parcels.find(p => p.district === district && p.family === family)
  if (!p) throw Error('Missing facade example ' + district + '/' + family)
  const [u, v, z, , depth] = p.volumes[0], c = Math.cos(p.yaw), s = Math.sin(p.yaw)
  const world = (u, v, h) => [p.position[0] + c * u - s * v, p.position[1] + s * u + c * v, p.floor + h]
  const at = world(u + 4, v - depth / 2 - 11, 3.8), target = world(u, v - depth / 2, z + 4.8)
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([...at.slice(0, 2), at[2] + 1.8]),
    point(target), new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  views.push([district + '-' + family, `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`])
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
