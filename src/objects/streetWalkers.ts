import * as THREE from 'three'
import type { SidewalkSegment } from './sidewalks'
import { SurfaceIndex } from './streetAccess'
import { loadResidentModel, placeResident, poseResident, ResidentBatches, type ResidentAppearance } from './residentModel'
import { planStreetWalkerRoutes, sampleStreetWalker, walkerDistance, walkerWouldApproach, type StreetWalkerRoute } from './streetWalkerRoutes'

type Focus = { azimuth: number; axial: number; altitude: number }
type Walker = { route: StreetWalkerRoute; root: THREE.Object3D; clock: number; blocked: boolean }
const RANGE = 110, KEEP_RANGE = 135
const shirts = [0x6c8288, 0x8e7565, 0x777e58, 0x9f9690, 0x826b76, 0x526579]
const trousers = [0x3d4652, 0x5e5750, 0x414943, 0x55505d, 0x625d55, 0x343d49]

/** Small, persistent nearby population. Rendering and motion have a fixed
 * capacity; routes are derived from nearby pavement, never the entire colony. */
export class StreetWalkers {
  readonly group = new THREE.Group()
  private routes: StreetWalkerRoute[] = []
  private segments: readonly SidewalkSegment[] = []
  private index = new SurfaceIndex(3200)
  private radius = 3200
  private walkers: Walker[] = []
  private source: THREE.Object3D | null = null
  private batches: ResidentBatches | null = null
  private requested = false
  private disposed = false
  private clock = 0
  private refresh = 0
  private firstPopulation = true
  private readonly appearances = new Map<THREE.Object3D, ResidentAppearance>()
  private readonly enabled = new URLSearchParams(window.location.search).get('people') !== '0'

  constructor(parent: THREE.Object3D, private readonly capacity: number) {
    this.group.name = 'street-walkers'; parent.add(this.group)
  }
  setPlan(segments: readonly SidewalkSegment[], radius: number) {
    this.radius = radius
    this.segments = this.enabled && radius >= 100 ? segments : []
    this.routes = []
    this.index = new SurfaceIndex(radius)
    this.segments.forEach((s, i) => {
      const width = s.isAvenue ? s.tangentExtent : s.axialExtent, length = s.isAvenue ? s.axialExtent : s.tangentExtent
      if (width >= 1.9 && length >= 20) this.index.insert({ ...s, tangentWidth: s.tangentExtent, axialLength: s.axialExtent }, i)
    })
    this.walkers = []; this.appearances.clear(); this.refresh = 0; this.firstPopulation = true
  }
  private populate(focus: Focus) {
    const keep = this.walkers.filter(w => walkerDistance(sampleStreetWalker(w.route, this.radius, w.clock), focus, this.radius) < KEEP_RANGE)
    const occupied = new Set(keep.map(w => w.route.id))
    // Create only nearby pieces of a long pavement. A city-wide 64 m split
    // would retain hundreds of thousands of route objects for eight people.
    this.routes = [...this.index.query({ ...focus, tangentWidth: RANGE * 2, axialLength: RANGE * 2 })]
      .flatMap(i => planStreetWalkerRoutes([this.segments[i]], this.radius, i, { ...focus, range: RANGE }))
    const candidates = this.routes.filter(r => !occupied.has(r.id))
      .map(route => ({ route, distance: walkerDistance(sampleStreetWalker(route, this.radius, this.clock + route.phase), focus, this.radius) }))
      .filter(r => r.distance < RANGE && (this.firstPopulation || r.distance > 22))
      .sort((a, b) => a.distance - b.distance)
    for (const { route } of candidates) {
      if (keep.length >= this.capacity) break
      const root = this.source!.clone(true)
      root.name = 'street-resident-' + route.id
      const cloth = new THREE.Color(shirts[route.variant]), pants = new THREE.Color(trousers[route.variant])
      // Per-instance multipliers turn the authored albedos into a quiet palette.
      cloth.setRGB(cloth.r / .19, cloth.g / .255, cloth.b / .24)
      pants.setRGB(pants.r / .105, pants.g / .135, pants.b / .15)
      this.appearances.set(root, { cloth, trousers: pants })
      keep.push({ route, root, clock: this.clock + route.phase, blocked: false })
    }
    for (const old of this.walkers) if (!keep.includes(old)) this.appearances.delete(old.root)
    this.walkers = keep; this.firstPopulation = false
  }
  update(dt: number, focus: Focus, rover: { azimuth: number; axial: number } | null) {
    this.clock += Math.min(.1, Math.max(0, dt))
    this.group.visible = this.enabled && this.segments.length > 0 && focus.altitude >= 0 && focus.altitude < 8
    if (!this.group.visible) return
    if (!this.source) {
      if (!this.requested) {
        this.requested = true
        loadResidentModel().then(asset => {
          if (this.disposed) return
          this.source = asset.getObjectByName('resident')!
          this.batches = new ResidentBatches(this.source, this.capacity)
          this.group.add(this.batches.group)
        }).catch(() => console.warn('Street residents unavailable.'))
      }
      return
    }
    this.refresh -= dt
    if (this.refresh <= 0) { this.populate(focus); this.refresh = .75 }
    const roots: THREE.Object3D[] = [], states = []
    for (const w of this.walkers) {
      const step = Math.min(.1, Math.max(0, dt))
      const current = sampleStreetWalker(w.route, this.radius, w.clock)
      const next = sampleStreetWalker(w.route, this.radius, w.clock + step)
      // Leave enough personal space that a portrait view can still read the
      // pavement around the person, rather than stopping nose-to-nose.
      w.blocked = walkerWouldApproach(current, next, focus, this.radius, 1.65) ||
        !!rover && walkerWouldApproach(current, next, rover, this.radius, 3.5)
      if (!w.blocked) w.clock += step
      const position = w.blocked ? current : next
      const scale = .94 + w.route.variant * .022
      placeResident(w.root, position.azimuth, position.axial, this.radius, position.heading, w.route.height)
      w.root.scale.set(scale * (w.route.variant % 2 ? 1.04 : .98), scale, scale)
      poseResident(w.root, w.clock * w.route.speed / 1.1, position.walking && !w.blocked, false, w.route.phase)
      w.root.visible = walkerDistance(position, focus, this.radius) < KEEP_RANGE
      roots.push(w.root)
      states.push({ id: w.route.id, ...position, visible: w.root.visible, blocked: w.blocked, variant: w.route.variant, scale })
    }
    this.batches?.update(roots, this.appearances)
    this.group.userData = { ready: true, nearbyRoutes: this.routes.length, capacity: this.capacity, people: roots.filter(r => r.visible).length, actors: states }
  }
  dispose() { this.disposed = true; this.batches?.dispose(); this.appearances.clear(); this.group.removeFromParent() }
}
