import { Matrix4, Quaternion, Vector3 } from 'three'
export const bulkheadViews = [
  { name: 'port', at: [0, -12500, 0], aim: [0, -20000, 0] },
  { name: 'opposite', at: [0, 12500, 0], aim: [0, 20000, 0] },
  { name: 'oblique', at: [1900, -19200, 650], aim: [1700, -20000, 500] },
  { name: 'cladding', at: [1850, -19965, 550], aim: [1850, -20000, 550] },
  { name: 'rim', at: [3050, -19800, 0], aim: [3120, -20000, 0], up: [-1, 0, 0] },
  { name: 'night', at: [0, -15000, 0], aim: [0, -20000, 0], phase: .02 },
  { name: 'small', preset: 'playground', at: [0, -5, 0], aim: [0, -60, 0] },
  { name: 'ring', preset: 'elysium', at: [25000, 1800, 0], aim: [32000, -1000, 0], open: true },
  { name: 'window', preset: 'playground', at: [0, 5, 0], aim: [0, 60, 0] },
]
export function bulkheadPose(v) {
  const p = new Vector3(...v.at), q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p, new Vector3(...v.aim), new Vector3(...(v.up ?? [0, 0, 1]))))
  return `preset=${v.preset ?? 'izma'}&m=f&rpm=0&p=${p.toArray()}&q=${q.toArray()}&t=${v.phase ?? .42}`
}
