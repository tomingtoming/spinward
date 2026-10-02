import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Window upkeep (toming, 2026-09-30): spin gravity presses everything onto the
// glass, so its inner face is a floor that machines can drive on freely: no
// rails, suction or tethers, just soft tracks and wheels under ~1 g.
// The glass is almost free of obstacles, so the cleaner is a wide wiper, not
// a Roomba (toming, 2026-10-01): a 45 m beam carrying a brush and squeegees on
// crawler bogies at both ends and wheel towers between, like a solar-farm
// row cleaner or a centre-pivot irrigation span. It sweeps along the axis in
// lanes 50 m apart, each centred between two viaduct pier lines (every 50 m
// from the window edge), so it passes every pier with a metre or more to
// spare, and crabs sideways between lanes without turning. Sealed air soils
// the glass slowly: one wiper per 10 km of window covers its section in about
// two weeks, 12 wipers on three windows. (Small crawlers, one per 250 m and
// then per 1 km, looked far too many on the night windows.)
export const WINDOW_ROBOT = { section: 10000, lane: 50, margin: 10, speed: .5, halfWidth: 22.5, pier: 1.4, pierSpacing: 50,
  max: 64 }

/** A window in colony arc metres: arcs increase from arc0 to arc1; piers are
 * measured from arc1, the edge where the strip's source x meets the window. */
export type WindowStrip = { arc0: number; arc1: number; axial0: number; axial1: number; floor: number }
export type RobotPose = { arc: number; axial: number; heading: [number, number] } // motion in (arc, axial)

const hash = (i: number, j: number, k: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** Lane centres across a window (from its pier edge), an even count. */
export function wiperLanes(width: number) {
  const { lane, halfWidth, margin } = WINDOW_ROBOT, lanes: number[] = []
  for (let across = lane / 2; across + halfWidth <= width - margin; across += lane) lanes.push(across)
  if (lanes.length % 2) lanes.pop()
  return lanes
}

/** Deterministic boustrophedon sweep of one section (j) of a window at time t
 * (seconds). An even lane count ends the sweep at the section's start, so the
 * crab back across the window leads straight into the first lane. */
export function robotPose(strip: WindowStrip, window: number, j: number, time: number): RobotPose | null {
  const { section, margin, speed } = WINDOW_ROBOT
  const start = strip.axial0 + j * section + margin, end = Math.min(strip.axial1, strip.axial0 + (j + 1) * section) - margin
  const lanes = wiperLanes(strip.arc1 - strip.arc0), run = end - start
  if (lanes.length < 2 || run <= 0) return null
  const n = lanes.length, step = lanes[1] - lanes[0], span = lanes[n - 1] - lanes[0]
  const length = n * run + 2 * span // sweeps, lane changes, then back across
  let d = ((time * speed + hash(window, j, 7) * length) % length + length) % length
  if (d >= n * run + span) return { arc: strip.arc1 - lanes[n - 1] + (d - n * run - span), axial: start, heading: [1, 0] }
  const k = Math.min(n - 1, Math.floor(d / (run + step)))
  const into = d - k * (run + step), forward = k % 2 === 0
  if (into <= run) return { arc: strip.arc1 - lanes[k], axial: start + (forward ? into : run - into), heading: [0, forward ? 1 : -1] }
  return { arc: strip.arc1 - lanes[k] - (into - run), axial: start + (forward ? run : 0), heading: [-1, 0] }
}

type Part = [number, number, number, number, number, number] // x0 x1 y0 y1 z0 z1; x along the beam, +y up, z along the axis
const box = ([x0, x1, y0, y1, z0, z1]: Part) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
// The hex glazing sits 0.3 m inside the structural floor (cityscape buildWindowStrips).
export const GLASS_INSET = .3
const W = WINDOW_ROBOT.halfWidth, ENDS = [-1, 1], TOWERS = [-7.5, 7.5], LAMP_TOP = 1.3
// Truss beam over a brush housing, a squeegee on each face (it sweeps both
// ways), a crawler bogie at each end and wheel towers between. Lights (night
// view, 2026-09-30), split by who should see them:
// - A rotating amber beacon on each bogie, beamed along the glass for people
//   close by. Its flashes stay local.
// - A shielded, steady, dim position lamp beside it that faces up, the only
//   light the far side of the colony sees; flashing lights across a window
//   would repeat the wind-farm complaint on a colony scale.
// - A low raking work light along each face, on only at night. Clean glass
//   scatters almost nothing, so it lights no pool: it shows scratches.
const HULL: Part[] = [[-W, W, .2, .7, -.8, .8], [-W, W, 2.2, 2.4, -.15, .15], [-1, 1, .7, 1.6, -.9, .9],
  ...ENDS.map(s => [s * W - .6, s * W + .6, .45, 1.2, -1.2, 1.2] as Part),
  ...Array.from({ length: 11 }, (_, k) => -W + .1 + k * (2 * W - .2) / 10).map(x => [x - .07, x + .07, .7, 2.2, -.07, .07] as Part),
  ...TOWERS.map(x => [x - .1, x + .1, .5, 2.2, -.1, .1] as Part)]
const RUBBER: Part[] = [[-W, W, 0, .22, .8, .95], [-W, W, 0, .22, -.95, -.8],
  ...ENDS.flatMap(s => [-1, 1].map(t => [s * W + t * .45 - .15, s * W + t * .45 + .15, 0, .45, -1.4, 1.4] as Part)),
  ...TOWERS.map(x => [x - .25, x + .25, 0, .5, -.4, .4] as Part), [-.04, .04, 1.6, 2.9, 0, .08]]
const WORK_LIGHT: Part[] = [[-W, W, .3, .36, .8, .82], [-W, W, .3, .36, -.82, -.8]]
const robotGeometry = (parts: Part[]) => mergeGeometries(parts.map(box))
export const ROBOT_LIGHTS = { beacon: new THREE.Color('#ffae2e'), work: new THREE.Color('#fff4de'), position: '#ffb347',
  flashPeriod: 1.1, positionSize: 2.5 }

/** Brightness of a rotating beacon's beam as seen from one side, 0.25..1. */
export const beaconFlash = (time: number, phase: number) => {
  const c = Math.max(0, Math.cos(2 * Math.PI * (time / ROBOT_LIGHTS.flashPeriod + phase)))
  return .25 + .75 * c ** 6
}

/** Every wiper, drawn instanced (twelve of them); their position lamps at night. */
export class WindowRobots {
  readonly group = new THREE.Group()
  private meshes: THREE.InstancedMesh[]
  private beacon: THREE.InstancedMesh
  private workMaterial = new THREE.MeshBasicMaterial({ color: '#2e3234' })
  private matrix = new THREE.Matrix4()
  private colour = new THREE.Color()
  private far: THREE.Points
  constructor(parent: THREE.Object3D, readonly strips: WindowStrip[], readonly radius: number) {
    this.group.name = 'window-robots'; parent.add(this.group)
    const beacons = mergeGeometries(ENDS.map(s => new THREE.CylinderGeometry(.09, .09, .14, 10).translate(s * W, 1.27, -.6)))
    this.beacon = new THREE.InstancedMesh(beacons, new THREE.MeshBasicMaterial({ color: '#ffffff' }), WINDOW_ROBOT.max)
    this.meshes = [
      new THREE.InstancedMesh(robotGeometry(HULL), new THREE.MeshStandardMaterial({ color: '#d9dcd7', roughness: .55 }), WINDOW_ROBOT.max),
      new THREE.InstancedMesh(robotGeometry(RUBBER), new THREE.MeshStandardMaterial({ color: '#2e3234', roughness: .9 }), WINDOW_ROBOT.max),
      new THREE.InstancedMesh(robotGeometry(WORK_LIGHT), this.workMaterial, WINDOW_ROBOT.max),
      this.beacon
    ]
    this.beacon.setColorAt(0, this.colour.set(0))
    for (const m of this.meshes) { m.frustumCulled = false; m.count = 0; this.group.add(m) }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WINDOW_ROBOT.max * 2 * 3), 3))
    geometry.setDrawRange(0, 0)
    this.far = new THREE.Points(geometry, new THREE.PointsMaterial({ color: ROBOT_LIGHTS.position, size: ROBOT_LIGHTS.positionSize,
      sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }))
    this.far.name = 'window-robot-position-lamps'; this.far.frustumCulled = false; this.far.visible = false
    this.group.add(this.far)
    this.update(0)
  }
  get positionLamps() { return this.far.geometry.drawRange.count }
  setDaylight(daylight: number) {
    const night = THREE.MathUtils.smoothstep(1 - daylight, .45, .8)
    this.workMaterial.color.set('#2e3234').lerp(ROBOT_LIGHTS.work, night)
    const material = this.far.material as THREE.PointsMaterial
    material.opacity = night; this.far.visible = night > .01
  }
  update(time: number) {
    const R = this.radius, position = this.far.geometry.getAttribute('position') as THREE.BufferAttribute
    const lamp = new THREE.Vector3()
    let n = 0
    this.strips.forEach((strip, w) => {
      const sections = Math.ceil((strip.axial1 - strip.axial0) / WINDOW_ROBOT.section)
      for (let j = 0; j < sections && n < WINDOW_ROBOT.max; j++) {
        const pose = robotPose(strip, w, j, time)
        if (!pose) continue
        // The beam always lies across the window; it crabs between lanes. The
        // bogies stand on the glass, so the straight 45 m beam's middle rides
        // 8 cm above the curve; the squeegee is segmented to follow it.
        const a = pose.arc / R, floor = R - strip.floor - GLASS_INSET, rr = floor - W * W / (2 * floor)
        const up = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)), forward = new THREE.Vector3(0, 1, 0)
        const right = new THREE.Vector3().crossVectors(up, forward)
        this.matrix.makeBasis(right, up, forward).setPosition(Math.cos(a) * rr, pose.axial, Math.sin(a) * rr)
        for (const m of this.meshes) m.setMatrixAt(n, this.matrix)
        this.beacon.setColorAt(n, this.colour.copy(ROBOT_LIGHTS.beacon).multiplyScalar(beaconFlash(time, hash(j, w, 3))))
        ENDS.forEach((s, e) => position.setXYZ(n * 2 + e, ...lamp.set(s * W, LAMP_TOP, .6).applyMatrix4(this.matrix).toArray()))
        n++
      }
    })
    for (const m of this.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true }
    if (this.beacon.instanceColor) this.beacon.instanceColor.needsUpdate = true
    this.far.geometry.setDrawRange(0, n * 2); position.needsUpdate = true
    return n
  }
  dispose() {
    this.group.removeFromParent()
    for (const m of this.meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose() }
    this.far.geometry.dispose(); (this.far.material as THREE.Material).dispose()
  }
}
