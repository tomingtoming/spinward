import { Matrix4, Quaternion, Vector3 } from 'three'

export const skylineViews = [
  { name: 'district', at: [-.165, -385, 150], aim: [-.06, -140, 42] },
  { name: 'residential', at: [-.125, -235, 65], aim: [-.09955162636068053, -164.52, 46] },
  { name: 'office', at: [-.092, 20, 53], aim: [-.07875287112641038, -60, 46] },
  { name: 'street', at: [-.085, -8, 1.8], aim: [-.07875287112641038, -60, 34], ground: true },
  { name: 'distant', at: [-.38, -580, 240], aim: [-.04, -90, 35] },
  { name: 'district-night', at: [-.165, -385, 150], aim: [-.06, -140, 42], phase: .02 },
]
export function skylinePose(view) {
  const point = ([a, ax, h]) => new Vector3(Math.cos(a) * (3200 - h), ax, Math.sin(a) * (3200 - h))
  const p = point(view.at), q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p, point(view.aim), new Vector3(-Math.cos(view.at[0]), 0, -Math.sin(view.at[0]))))
  return `${view.ground ? `m=g&a=${view.at[0]}&ax=${view.at[1]}` : `m=f&rpm=0&p=${p.toArray()}`}&q=${q.toArray()}&t=${view.phase ?? .42}`
}
