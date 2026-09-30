import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Window upkeep (toming, 2026-09-30): spin gravity presses everything onto the
// glass, so its inner face is a floor and small robots can roam it freely. No
// rails, suction or tethers: plain soft tracks grip under ~1 g. The body is
// square, not round like a Roomba (there is no furniture to slip past), so a
// full-width brush reaches pane corners along straight lanes. Lanes are one
// brush width apart; one robot per 250 m cell at .5 m/s covers it in about
// three days. Lanes near a pier line (every 50 m from the window edge) are
// skipped, so no robot ever meets a viaduct pier.
export const WINDOW_ROBOT = { cell: 250, lane: 1, margin: 5, speed: .5, halfWidth: .55, pier: 1.4, pierSpacing: 50,
  range: 1500, max: 512 }

/** A window in colony arc metres: arcs increase from arc0 to arc1; piers are
 * measured from arc1, the edge where the strip's source x meets the window. */
export type WindowStrip = { arc0: number; arc1: number; axial0: number; axial1: number; floor: number }
export type RobotPose = { arc: number; axial: number; heading: [number, number] } // heading in (arc, axial)

const hash = (i: number, j: number, k: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** Lane offsets across one cell (from its window-edge side), an even count. */
const laneCache = new Map<number, number[]>()
function cellLanes(usable: number) {
  const key = Math.round(usable * 1000)
  let lanes = laneCache.get(key)
  if (lanes) return lanes
  const { lane, halfWidth, pier, pierSpacing } = WINDOW_ROBOT, clear = halfWidth + pier + .4
  lanes = []
  for (let k = 0, across = halfWidth; across <= usable - halfWidth; across = halfWidth + ++k * lane) {
    const off = across - Math.round(across / pierSpacing) * pierSpacing
    if (Math.abs(off) > clear) lanes.push(across)
  }
  if (lanes.length % 2) lanes.pop()
  laneCache.set(key, lanes)
  return lanes
}

/** Deterministic boustrophedon sweep of one cell at time t (seconds). An even
 * lane count ends the sweep at the cell's start, so the return across the
 * cell leads straight back into the first lane. */
export function robotPose(strip: WindowStrip, window: number, i: number, j: number, time: number): RobotPose | null {
  const { cell, margin, speed } = WINDOW_ROBOT
  const width = strip.arc1 - strip.arc0, across0 = i * cell, start = strip.axial0 + j * cell + margin
  const lanes = cellLanes(Math.min(cell, width - across0 - margin))
  if (lanes.length < 2) return null
  const run = cell - 2 * margin, n = lanes.length, span = lanes[n - 1] - lanes[0]
  const stride = run + (span / (n - 1)) // mean lane change; exact per-lane below
  const length = n * run + span * 2 // sweeps, lane changes, then return across
  let d = ((time * speed + hash(window, i, j) * length) % length + length) % length
  const sweep = n * run + span
  if (d >= sweep) {
    return { arc: strip.arc1 - across0 - lanes[n - 1] + (d - sweep), axial: start, heading: [1, 0] }
  }
  // Each lane k starts at k·run plus the lane changes before it.
  let k = Math.min(n - 1, Math.floor(d / stride))
  const begin = (m: number) => m * run + lanes[m] - lanes[0]
  while (k > 0 && begin(k) > d) k--
  while (k < n - 1 && begin(k + 1) <= d) k++
  const into = d - begin(k), forward = k % 2 === 0
  if (into <= run) {
    return { arc: strip.arc1 - across0 - lanes[k], axial: start + (forward ? into : run - into), heading: [0, forward ? 1 : -1] }
  }
  return { arc: strip.arc1 - across0 - lanes[k] - (into - run), axial: start + (forward ? run : 0), heading: [-1, 0] }
}

type Part = [number, number, number, number, number, number] // x0 x1 y0 y1 z0 z1; +z forward, +y up
const box = ([x0, x1, y0, y1, z0, z1]: Part) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
// A 1.1 m wide, 1.3 m long crawler: soft tracks, a low hull with a dust bin
// behind, a full-width brush and squeegee in front, and a camera mast at the
// back carrying an amber beacon so people on the viaducts can spot it.
const HULL: Part[] = [[-.36, .36, .06, .26, -.55, .5], [-.3, .3, .26, .32, -.55, -.1]]
const RUBBER: Part[] = [[-.55, -.37, 0, .16, -.6, .55], [.37, .55, 0, .16, -.6, .55], [-.55, .55, 0, .12, .56, .7],
  [-.03, .03, .32, .72, -.48, -.42], [-.08, .08, .66, .76, -.47, -.33]]
const robotGeometry = (parts: Part[]) => mergeGeometries(parts.map(box))

/** Robots near the camera, drawn instanced with an amber beacon. */
export class WindowRobots {
  readonly group = new THREE.Group()
  private meshes: THREE.InstancedMesh[]
  private matrix = new THREE.Matrix4()
  constructor(parent: THREE.Object3D, readonly strips: WindowStrip[], readonly radius: number) {
    this.group.name = 'window-robots'; parent.add(this.group)
    const beacon = new THREE.CylinderGeometry(.05, .05, .09, 10).translate(0, .81, -.45)
    this.meshes = [
      new THREE.InstancedMesh(robotGeometry(HULL), new THREE.MeshStandardMaterial({ color: '#d9dcd7', roughness: .55 }), WINDOW_ROBOT.max),
      new THREE.InstancedMesh(robotGeometry(RUBBER), new THREE.MeshStandardMaterial({ color: '#2e3234', roughness: .9 }), WINDOW_ROBOT.max),
      new THREE.InstancedMesh(beacon, new THREE.MeshStandardMaterial({ color: '#3b3322', emissive: '#f0b23c', emissiveIntensity: 1.6 }), WINDOW_ROBOT.max)
    ]
    for (const m of this.meshes) { m.frustumCulled = false; m.count = 0; this.group.add(m) }
  }
  /** focus: the camera in the parent's (colony) frame. */
  update(time: number, focus: THREE.Vector3) {
    const R = this.radius, { cell, range, max } = WINDOW_ROBOT
    const focusArc = Math.atan2(focus.z, focus.x) * R, focusAxial = focus.y
    let n = 0
    this.strips.forEach((strip, w) => {
      // Nearest point of the strip in arc (wrapped) and axial.
      const wrap = (a: number) => a - Math.round((a - focusArc) / (2 * Math.PI * R)) * 2 * Math.PI * R
      const a0 = wrap(strip.arc0), a1 = a0 + (strip.arc1 - strip.arc0)
      const da = Math.max(0, a0 - focusArc, focusArc - a1)
      if (da > range) return
      const iMax = Math.ceil((strip.arc1 - strip.arc0) / cell), jMax = Math.ceil((strip.axial1 - strip.axial0) / cell)
      const jLo = Math.max(0, Math.floor((focusAxial - range - strip.axial0) / cell)), jHi = Math.min(jMax - 1, Math.floor((focusAxial + range - strip.axial0) / cell))
      for (let i = 0; i < iMax && n < max; i++) for (let j = jLo; j <= jHi && n < max; j++) {
        const pose = robotPose(strip, w, i, j, time)
        if (!pose) continue
        const arc = pose.arc - strip.arc0 + a0
        if (Math.hypot(arc - focusArc, pose.axial - focusAxial) > range) continue
        const a = arc / R, rr = R - strip.floor
        const up = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a))
        const forward = new THREE.Vector3(-Math.sin(a) * pose.heading[0], pose.heading[1], Math.cos(a) * pose.heading[0]).normalize()
        const right = new THREE.Vector3().crossVectors(up, forward)
        this.matrix.makeBasis(right, up, forward).setPosition(Math.cos(a) * rr, pose.axial, Math.sin(a) * rr)
        for (const m of this.meshes) m.setMatrixAt(n, this.matrix)
        n++
      }
    })
    for (const m of this.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true }
    return n
  }
  dispose() {
    this.group.removeFromParent()
    for (const m of this.meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose() }
  }
}
