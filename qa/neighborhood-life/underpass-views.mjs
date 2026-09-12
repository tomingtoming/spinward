import { Matrix4, Quaternion, Vector3 } from 'three'

// The downtown viaduct's south side, between two existing avenue sidewalks.
export const underpassViews = [
  { name: 'entry', at: [-.0035, -351.54, 1.8], aim: [-.03, -351.54, 2.2], ground: true },
  { name: 'covered', at: [-.025, -351.54, 1.8], aim: [-.008, -351.54, 2.2], ground: true },
  { name: 'overview', at: [-.019, -382, 14], aim: [-.019, -347, 3] },
  { name: 'night', at: [-.025, -351.54, 1.8], aim: [-.008, -351.54, 2.2], ground: true, phase: .02 },
  { name: 'west-junction', at: [-.039, -361, 5], aim: [-.032, -351.54, .8] },
  { name: 'east-junction', at: [.002, -364, 5], aim: [-.008, -351.54, .8] },
]
export function underpassPose(view) {
  const point = ([a, ax, h]) => new Vector3(Math.cos(a) * (3200 - h), ax, Math.sin(a) * (3200 - h))
  const p = point(view.at), q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p, point(view.aim), new Vector3(-Math.cos(view.at[0]), 0, -Math.sin(view.at[0]))))
  return `${view.ground ? `m=g&a=${view.at[0]}&ax=${view.at[1]}` : `m=f&rpm=0&p=${p.toArray()}`}&q=${q.toArray()}&t=${view.phase ?? .42}`
}
