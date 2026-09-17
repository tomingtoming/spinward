import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
const { stations } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-rail.json', import.meta.url), 'utf8'))
const point = ([x, y, h]) => new Vector3(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
const pose = (at, target, flying = false) => {
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(target),
    new Vector3(-Math.cos(at[0] / 3200), 0, -Math.sin(at[0] / 3200))))
  return flying ? `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}` : `m=g&a=${at[0] / 3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
const views = []
for (const station of stations) {
  views.push([station.id + '-entry', 'visit=station-' + station.id])
  const a = station.boarding[0], c = station.position
  views.push([station.id + '-platform', pose(a, [c[0] + (a[0] - c[0]) * 3, c[1] + (a[1] - c[1]) * 3, a[2] + 1.5])])
  if (['a-civic', 'b-housing', 'c-market'].includes(station.id)) {
    views.push([station.id + '-overview', pose([c[0] + 35, c[1] - 70, c[2] + 24], [c[0], c[1] - 15, c[2]], true)])
    const at = station.approach.at(-2)
    views.push([station.id + '-door-side', pose(at, [c[0] + (a[0] - c[0]) * 2.5, c[1] + (a[1] - c[1]) * 2.5, a[2] + .6])])
  }
}
process.env.VIEWS ||= views.map(v => v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS = JSON.stringify(views)
await import('./colony-runtime.mjs')
