import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { StreetMarkingPlan } from './streetMarkings'
import { StreetNetwork } from './streetNetwork'
import { StreetSignalPlan } from './streetSignals'
import { legacyStreetPaths, sampleStreetPath, type StreetPath } from './streetPath'
import { createTrafficSignalIndex, routeTrafficSignals, trafficSignalGap, controlledSignalAspect, signalAspect } from './intersectionSignals'
import { advanceTraffic } from './trafficMotion'
import { IntersectionFurniture, layoutStreetSignal, crossingQuaternionFor } from './intersectionFurniture'
import { intersectStreetPolygons, polygonArea } from './streetPolygon'
import { relativeStreetPolygon, StreetSurfacePlan } from './streetSurfacePlan'
import { buildStreetSurfaceGeometry } from './streetSurfaceGeometry'
import { planCity, type CityRoad } from './cityLayout'
import { planTrafficRoadSpans } from './trafficRoadSpans'

const R = 3200
const line = (id: string, a: [number, number], b: [number, number], width = 6): StreetPath => {
  const tangent: [number, number] = [b[0] - a[0], b[1] - a[1]]
  return { id, azimuth: 0, axial: 0, kind: 'arterial', level: 0, groundHeight: 0, width,
    knots: [{ point: a, tangent }, { point: b, tangent }] }
}
const plan = (paths: StreetPath[], radius = R) => new StreetSignalPlan(new StreetMarkingPlan(new StreetNetwork(paths, radius)))

test('skew stop lines sit behind the zebra, cover only incoming lanes and face drivers', () => {
  for (const angle of [.4, .9, Math.PI / 2, 2.2]) {
    const p = plan([line('a', [-150, 0], [150, 0], 12), line('b', [-150 * Math.cos(angle), -150 * Math.sin(angle)], [150 * Math.cos(angle), 150 * Math.sin(angle)])])
    const approaches = p.nearby(0, 0, 150)
    expect(approaches).toHaveLength(4)
    const stops = p.paint(approaches), zebras = p.markings.paint(p.markings.crossings(0, 0, 150))
    for (const a of approaches) {
      const c = a.crossing, edge = c.sign === 1 ? c.end : c.start
      expect((p.markings.distanceAt(c.street, a.stop) - p.markings.distanceAt(c.street, edge)) * c.sign).toBeCloseTo(.8, 6)
      const layout = layoutStreetSignal(a, R), q = crossingQuaternionFor(layout.origin.azimuth)
      const lens = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), layout.head.yaw).applyQuaternion(q)
      const sample = sampleStreetPath(c.source, a.stop), az = layout.origin.azimuth
      const towardsDriver = new THREE.Vector3(-Math.sin(az) * Math.cos(sample.heading), Math.sin(sample.heading), Math.cos(az) * Math.cos(sample.heading)).multiplyScalar(c.sign)
      expect(lens.dot(towardsDriver)).toBeCloseTo(1, 10)
      expect(Math.hypot(layout.head.t, layout.head.a)).toBeCloseTo(c.source.width / 4 + .9, 8)
      const stop = stops.find(s => s.source === c.source && Math.sign(s.polygon[0].x * Math.cos(sample.heading) + s.polygon[0].y * Math.sin(sample.heading)) === c.sign)!
      expect(stop).toBeDefined()
      for (const v of stop.polygon) {
        const offset = -Math.sin(sample.heading) * v.x + Math.cos(sample.heading) * v.y
        expect(offset * c.sign).toBeLessThan(-.29)
        expect(Math.abs(offset)).toBeLessThan(c.source.width / 2)
      }
    }
    for (const s of stops) for (const z of zebras)
      expect(polygonArea(intersectStreetPolygons(s.polygon, relativeStreetPolygon(z, s.source, R)))).toBeLessThan(1e-6)
  }
})

test('T and multiway junctions have complete controls, collinear pairs share phases, other directions never do', () => {
  const a = line('a', [-150, 0], [150, 0]), b = line('b', [0, 0], [0, 150])
  for (const paths of [[a, b], [a, b, line('extra', [0, 0], [120, -120])]]) {
    const p = plan(paths), approaches = p.nearby(0, 0, 100)
    expect(approaches).toHaveLength(paths.length + 1)
    expect(approaches[0].control.groups).toBe(paths.length)
    for (let time = 0; time < 96; time += .1) {
      const active = approaches.filter(a => controlledSignalAspect(time, 0, a.control) !== 2)
      expect(new Set(active.map(a => a.control.group)).size).toBeLessThanOrEqual(1)
    }
    expect(p.nearby(0, 0, 100, approaches.length - 1)).toHaveLength(0)
  }
  for (let time = -32; time < 64; time += .1) for (const group of [0, 1])
    expect(controlledSignalAspect(time, 17, { group, groups: 2 })).toBe(signalAspect(time, 17, group === 0 ? 'avenue' : 'street'))
})

test('short blocks, separate levels and authored floors do not leave partial signal junctions', () => {
  const a = line('a', [-100, 0], [100, 0]), b = line('b', [0, -100], [0, 100])
  expect(plan([a, b]).nearby(0, 0, 100)).toHaveLength(4)
  expect(plan([a, { ...b, level: 1 }]).nearby(0, 0, 100)).toHaveLength(0)
  expect(plan([a, { ...b, surfaceOwner: 'authored' }]).nearby(0, 0, 100)).toHaveLength(0)
  expect(plan([a, line('short', [0, 0], [0, 10])]).nearby(0, 0, 100)).toHaveLength(0)
  expect(plan([a, b, line('close', [10, -100], [10, 100])]).nearby(0, 0, 100)).toHaveLength(0)
  // Roadway on the shoulder: a pole must not occupy it even if the zebra fits.
  expect(plan([a, b, line('intrusion', [7.5, 3.85], [7.8, 3.85], .3)]).nearby(0, 0, 100)).toHaveLength(0)
})

test('traffic uses the native painted position for each direction and keeps its nose clear', () => {
  const roads: CityRoad[] = [
    { id: 'a', azimuth: 0, axial: 0, tangentWidth: 12, axialLength: 300, kind: 'arterial' },
    { id: 'b', azimuth: 0, axial: 0, tangentWidth: 300, axialLength: 6, kind: 'local' }]
  for (const reversed of [false, true]) {
    const paths = legacyStreetPaths(roads)
    if (reversed) paths[0].knots = [...paths[0].knots].reverse().map(k => ({ point: k.point, tangent: [-k.tangent[0], -k.tangent[1]] }))
    const p = plan(paths), index = createTrafficSignalIndex([], p, roads)
    for (const road of roads) {
      const kind = road.id === 'a' ? 'avenue' : 'street', stops = routeTrafficSignals(index, road, R, -150, 300)
      expect(stops).toHaveLength(2)
      for (const direction of [-1, 1]) {
        const stop = stops.find(s => s.direction === direction)!, start = stop.along - 65 * direction
        const red = stop.control!.group === 0 ? 20 : 4, green = stop.control!.group === 0 ? 4 : 20
        let motion = { progress: 0, speed: 12 }
        for (let frame = 0; frame < 900; frame++) motion = advanceTraffic(motion, 1 / 60, 12, trafficSignalGap(stops, kind, start + direction * motion.progress, direction, motion.speed, red))
        expect(65 - motion.progress).toBeCloseTo(2.7, 5)
        const stopped = motion.progress
        for (let frame = 0; frame < 300; frame++) motion = advanceTraffic(motion, 1 / 60, 12, trafficSignalGap(stops, kind, start + direction * motion.progress, direction, motion.speed, green))
        expect(motion.progress - stopped).toBeGreaterThan(15)
      }
    }
  }
})

test('duplicate roads use a single physical signal and traffic sees the widest shared carriageway', () => {
  const a = line('a', [-100, 0], [100, 0]), b = line('b', [0, -100], [0, 100])
  const p = plan([a, b, { ...a, id: 'wide', width: 12 }])
  expect(p.nearby(0, 0, 100)).toHaveLength(4)
  expect(p.forStreet('a')).toHaveLength(2)
  expect(p.forStreet('a')).toEqual(p.forStreet('wide'))
  expect(p.forStreet('b')).toHaveLength(2)
  expect(p.forStreet('missing')).toHaveLength(0)
})

test('cloned and merged physical traffic roads retain controls from every source segment', () => {
  const roads: CityRoad[] = [
    { id: 'south', azimuth: 0, axial: -100, tangentWidth: 12, axialLength: 200, kind: 'arterial' },
    { id: 'north', azimuth: 0, axial: 100, tangentWidth: 12, axialLength: 200, kind: 'arterial' },
    { id: 'south-cross', azimuth: 0, axial: -100, tangentWidth: 200, axialLength: 6, kind: 'local' },
    { id: 'north-cross', azimuth: 0, axial: 100, tangentWidth: 200, axialLength: 6, kind: 'local' }]
  const p = plan(legacyStreetPaths(roads)), index = createTrafficSignalIndex([], p, roads)
  const physical = planTrafficRoadSpans(roads, R).find(s => s.isAvenue)!
  expect(physical.road).not.toBe(roads[0])
  expect(physical.sourceRoadIds).toEqual(['south', 'north'])
  const stops = routeTrafficSignals(index, physical.road, R, physical.spanStart, physical.spanLength, physical.sourceRoadIds)
  expect(stops).toHaveLength(4)
  for (const sign of [-1, 1]) expect(stops.filter(s => Math.sign(s.along) === sign)).toHaveLength(2)
  expect(routeTrafficSignals(index, { ...roads[0] }, R, -200, 200)).toHaveLength(2)
})

test('legacy protection survives an unsupported short stub without doubling a migrated junction', () => {
  const legacy = { azimuth: 0, axial: 0, avenueKind: 'arterial' as const, streetKind: 'local' as const, avenueWidth: 12, streetWidth: 6 }
  const roads: CityRoad[] = [{ id: 'a', azimuth: 0, axial: 0, tangentWidth: 12, axialLength: 200, kind: 'arterial' },
    { id: 'b', azimuth: 45, axial: 0, tangentWidth: 110, axialLength: 6, kind: 'local' }]
  for (const short of [false, true]) {
    const paths = [line('a', [0, -100], [0, 100], 12), line('b', [short ? -10 : -100, 0], [100, 0])]
    const p = new StreetSignalPlan(new StreetMarkingPlan(new StreetNetwork(paths, R)), [legacy])
    expect(p.legacyFallbacks).toHaveLength(short ? 1 : 0)
    const index = createTrafficSignalIndex([], p, roads), stops = routeTrafficSignals(index, roads[0], R, -100, 200)
    expect(stops).toHaveLength(short ? 1 : 2)
    expect(stops.every(s => !!s.crossing === short)).toBe(true)
    const f = new IntersectionFurniture(); f.setPlan([legacy], R, p.markings, p); f.update(0, 0, 0)
    const heads = f.group.getObjectByName('intersection-signal-heads') as THREE.InstancedMesh
    expect(heads.count).toBe(short ? 8 : 4)
    expect(heads.userData.legacyHeads).toBe(short ? 8 : 0)
    f.dispose()
  }
})

test('curved controls wrap the cylinder seam and keep stop paint above the actual road triangles', () => {
  for (const radius of [180, 3200]) {
    const a: StreetPath = { ...line('a', [-100, 0], [100, 0]), azimuth: Math.PI, axial: -19000,
      knots: [{ point: [-100, 0], tangent: [200, 50] }, { point: [100, 0], tangent: [200, 50] }] }
    const b = { ...line('b', [0, -100], [0, 100]), azimuth: -Math.PI, axial: -19000 }
    const p = plan([a, b], radius), approaches = p.nearby(-Math.PI, -19000, 60)
    expect(approaches).toHaveLength(4)
    expect(p.nearby(0, 0, 60)).toHaveLength(0)
    const road = new THREE.Mesh(buildStreetSurfaceGeometry(new StreetSurfacePlan([a, b], radius).roadSurfaces(), radius, 1)!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const paint = new THREE.Mesh(buildStreetSurfaceGeometry(p.paint(approaches), radius, 1)!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    road.updateMatrixWorld(true); paint.updateMatrixWorld(true)
    const pos = paint.geometry.getAttribute('position'), idx = paint.geometry.index!, ray = new THREE.Raycaster()
    for (let i = 0; i < idx.count; i += 3) {
      const centre = new THREE.Vector3()
      for (let j = 0; j < 3; j++) centre.add(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + j)))
      centre.multiplyScalar(1 / 3)
      const outward = new THREE.Vector3(centre.x, 0, centre.z).normalize()
      ray.set(centre.clone().addScaledVector(outward, -1), outward)
      const top = ray.intersectObject(paint)[0], floor = ray.intersectObject(road)[0]
      expect(top).toBeDefined(); expect(floor).toBeDefined()
      expect(floor.distance - top.distance).toBeGreaterThan(.02)
      expect(floor.distance - top.distance).toBeLessThan(.075)
    }
    road.geometry.dispose(); road.material.dispose(); paint.geometry.dispose(); paint.material.dispose()
  }
})

test('native render replaces legacy stops and heads atomically, with one live lens and attached hardware', () => {
  const p = plan([line('a', [-100, -20], [100, 20]), line('b', [0, -100], [0, 100])]), furniture = new IntersectionFurniture()
  furniture.setPlan([], R, p.markings, p)
  const part = (name: string) => furniture.group.getObjectByName(name) as THREE.InstancedMesh
  for (const time of [0, 11, 14, 16, 27, 30, 32]) {
    furniture.update(0, 0, 0, time)
    expect(part('crosswalk-stripes').count).toBe(0)
    const heads = part('intersection-signal-heads'), lamps = part('intersection-signal-lamps'), arms = part('intersection-signal-arms')
    expect(heads.count).toBe(4); expect(lamps.count).toBe(12); expect(arms.count).toBe(4)
    expect(part('street-junction-markings').userData.stopLines).toBe(4)
    for (let i = 0; i < heads.count; i++) {
      let lit = 0
      for (let c = 0; c < 3; c++) if (new THREE.Color().fromBufferAttribute(lamps.instanceColor!, i * 3 + c).getHSL({ h: 0, s: 0, l: 0 }).l > .1) lit++
      expect(lit).toBe(1)
      const headMatrix = new THREE.Matrix4(), armMatrix = new THREE.Matrix4()
      heads.getMatrixAt(i, headMatrix); arms.getMatrixAt(i, armMatrix)
      const hanger = new THREE.Vector3(0, .55, 0).applyMatrix4(headMatrix).applyMatrix4(armMatrix.invert())
      expect(Math.hypot(hanger.x, hanger.y)).toBeLessThan(.01)
      expect(Math.abs(hanger.z)).toBeLessThan(.5)
    }
  }
  furniture.setPlan([], R)
  expect(part('intersection-signal-heads').count).toBe(0)
  expect(part('street-junction-markings')).toBeUndefined()
  furniture.dispose()
})

test('all three residential bands use native controls within the unchanged near-field budget', () => {
  const city = planCity({ radius: R, length: 40000, maxBuildings: 18000 }), p = new StreetSignalPlan(new StreetMarkingPlan(city.streetNetwork!))
  for (const azimuth of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const nearby = p.nearby(azimuth, 321.29, 420)
    expect(nearby.length).toBeGreaterThan(0); expect(nearby.length).toBeLessThanOrEqual(512)
    expect(nearby.every(a => a.control.groups >= 2)).toBe(true)
  }
  const index = createTrafficSignalIndex([], p, city.roads)
  const road = city.roads.find(r => r.id === 'road-7')!
  expect(routeTrafficSignals(index, road, R, 250, 150)).toHaveLength(2)
}, 30000)
