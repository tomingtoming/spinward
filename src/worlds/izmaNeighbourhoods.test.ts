import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Group } from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import plan from '../../assets/blender/izma-neighbourhood-plan.json'
import parcels from '../../assets/blender/izma-neighbourhood-parcels.json'
import publicSpaces from '../../assets/blender/izma-public-spaces.json'
import urban from '../../assets/blender/izma-urban-plan.json'
import streets from '../../assets/blender/izma-urban-streets.json'
import districtLinks from '../../assets/blender/izma-district-links.json'
import { colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { AuthoredLandscape, landscapeColliders, LANDSCAPE_LIGHT_BUDGET } from './authoredLandscape'
import { unpackLandscapeLibrary } from './landscapeData'
import worldRaw from './generated/worldLandscapes.json'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'
import { positivePolygon, polygonArea, intersectStreetPolygons } from '../objects/streetPolygon'

const manifest = readColonyManifest(raw)
const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
function drawingIndex(material?: string) {
  const meshes = decodeColonyMesh(manifest.neighbourhoods!.fixed, false).meshes
  if (material && !meshes[material]) throw Error('Missing drawn material: ' + material)
  const positions = (material ? [meshes[material]] : Object.values(meshes)).flat()
  return drawnMeshIndex(positions)
}
function drawnMeshIndex(positions: number[]) {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < positions.length; i += 9) {
    const key = `${Math.floor(positions[i] / 64)}:${Math.floor(positions[i + 1] / 64)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(...positions.slice(i, i + 9))
  }
  const surfaces = [...groups.values()].map(vertices => {
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1)
    return { vertices, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] }
  })
  return buildCityCollisionIndex(landscapeColliders({ surfaces, solids: [] }, 3200), 3200, 40000)
}
// New road-side paving can cover the former individual frontage surface.
// Check the original surface still exists, then compare physics with the
// visible top of both independent drawing layers at the same location.
const streetPaving = drawnMeshIndex(manifest.streetFrontages
  ? decodeColonyMesh(manifest.streetFrontages.fixed, false).meshes['frontage-paving'] : [])
const withStreetPaving = (h: number, x: number, y: number) => Math.max(h,
  getCityGroundHeight(streetPaving, 3200, x / 3200, y, 400, 0))

test('station, centre-link and public-place catchments have mixed uses and current reservation sources', async () => {
  for (const [name, digest] of Object.entries(parcels.dependencies)) {
    const bytes = await Bun.file(new URL('../../assets/blender/' + name, import.meta.url)).arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), name).toBe(digest)
  }
  expect(parcels.neighbourhoods.map(n => n.id).sort()).toEqual(publicSpaces.places.map(p => p.id).sort())
  expect(manifest.neighbourhoods!.counts.buildings).toBe(parcels.parcels.length)
  expect(new Set(parcels.parcels.map(p => p.id)).size).toBe(parcels.parcels.length)
  for (const n of parcels.neighbourhoods) {
    const spec = plan.districts[n.id as keyof typeof plan.districts]
    expect(n.parcels.length, n.id).toBeGreaterThanOrEqual(spec.minimum)
    const members = parcels.parcels.filter(p => p.district === n.id)
    expect(new Set(members.map(p => p.family)).size, n.id).toBeGreaterThanOrEqual(3)
    const district = urban.districts[n.id as keyof typeof urban.districts]
    const region = streets.districts.find(s => s.id === n.id)!
    const [dx, dy] = region.centre.map((v, i) => v - region.station[i])
    const length = Math.hypot(dx, dy)
    for (const p of members) {
      if (p.lot.catchment === 'public') expect(p.lot.distance, p.id).toBeLessThan(spec.radius)
      else if (p.lot.catchment === 'district-link') {
        const link = parcels.streets.find(s => s.id === p.lot.street)!
        expect(link?.role, p.id).toBe('district-link')
        expect(link.district, p.id).toBe(n.id)
        expect(link.purpose, p.id).toBe(p.lot.purpose)
        expect(link.frontageFamilies, p.id).toContain(p.family)
        const distance = Math.min(...link.points.slice(1).map((b, i) => {
          const a = link.points[i], dx = b[0] - a[0], dy = b[1] - a[1]
          const t = Math.max(0, Math.min(1, ((p.access.start[0] - a[0]) * dx + (p.access.start[1] - a[1]) * dy) / (dx * dx + dy * dy)))
          return Math.hypot(p.access.start[0] - a[0] - dx * t, p.access.start[1] - a[1] - dy * t)
        }))
        expect(distance, p.id + ' entrance meets its centre link').toBeLessThan(link.width / 2 + .2)
      }
      else {
        // The entrance meets the frontage road. Allow its sidewalk offset;
        // buildings may not silently leak into the long inter-district gaps.
        const [x, y] = p.access.start.map((v, i) => v - region.station[i])
        const along = (x * dx + y * dy) / length, across = Math.abs(x * dy - y * dx) / length
        // Use the actual road/sidewalk offset and the tangential door offset.
        // The 18 m town road already has an 11.15 m frontage offset; a fixed
        // 11 m allowance incorrectly rejects valid plots at its catchment edge.
        const offset = Math.hypot(p.access.start[0] - p.frontage[0], p.access.start[1] - p.frontage[1])
          + Math.abs((p.frontage[0] - p.position[0]) * Math.cos(p.yaw) + (p.frontage[1] - p.position[1]) * Math.sin(p.yaw))
        expect(along, p.id).toBeGreaterThan(30 - offset)
        expect(along, p.id).toBeLessThan(region.reach + 45 + offset)
        expect(across, p.id).toBeLessThan(region.halfWidth + offset)
      }
    }
    const coverage = n.footprintArea / n.lotArea
    expect(coverage, n.id).toBeLessThan(.8)
    if (district.character === 'lanes') expect(coverage, n.id).toBeGreaterThan(.55)
    if (district.character === 'groves') expect(coverage, n.id).toBeLessThan(.4)
    expect(manifest.visits['neighbourhood-' + n.id], n.id).toBeDefined()
  }
})

test('every authored centre link is accounted for and keeps its district purpose and named connections', async () => {
  for (const [name, digest] of Object.entries(streets.dependencies)) {
    const bytes = await Bun.file(new URL('../../assets/blender/' + name, import.meta.url)).arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), name).toBe(digest)
  }
  const accepted = streets.streets.filter(s => s.role === 'district-link')
  const authored = Object.entries(districtLinks.districts).flatMap(([district, spec]) =>
    spec.links.map(link => ({ ...link, district, id: `urban-${district}-link-${link.id}` })))
  expect([...accepted, ...streets.rejectedCentreLinks].map(s => s.id).sort()).toEqual(authored.map(s => s.id).sort())
  for (const link of accepted) {
    const source = authored.find(s => s.id === link.id)!
    expect(link.purpose, link.id).toBe(source.purpose)
    expect(link.district, link.id).toBe(source.district)
    expect(link.connections[0], link.id).not.toBe(link.connections[1])
    expect(link.authoring!.ends, link.id).toEqual(source.ends)
    for (const apron of link.aprons!) expect(apron, link.id).toBeGreaterThanOrEqual(.3)
  }
  for (const retired of districtLinks.retiredStreetSketches) {
    expect(streets.streets.some(s => s.id === retired.id), retired.id).toBe(false)
    expect(parcels.streets.some(s => s.id === retired.id), retired.id).toBe(false)
  }
  for (const district of Object.keys(districtLinks.districts)) {
    const inside = parcels.streets.filter(s => s.district === district && s.blockInterior)
    expect(inside.length, district + ' has an actual interior passage').toBeGreaterThan(0)
    const routes = new Set(inside.map(s => s.id))
    expect(parcels.parcels.some(p => p.district === district && routes.has(p.route)),
      district + ' interior passages serve inhabited plots').toBe(true)
  }
})

test('paved frontages abut both angled entrance edges and the foundation apron', () => {
  const paving = drawingIndex('arch-court')
  let probes = 0
  for (const p of parcels.parcels) {
    if (p.lot.frontageUse === 'garden' && urban.districts[p.district as keyof typeof urban.districts].character !== 'lanes') continue
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw), [x, y] = p.position
    const local = (q: number[]) => [c * (q[0] - x) + s * (q[1] - y), -s * (q[0] - x) + c * (q[1] - y)]
    const a = local(p.access.start), b = local(p.access.end), du = b[0] - a[0], dv = b[1] - a[1]
    const edge = -p.size[1] / 2 - .25
    if (edge - a[1] < .12) continue
    const halfWidth = p.access.width / 2 * Math.hypot(du, dv) / Math.abs(dv)
    for (const v of [(a[1] + edge) / 2, edge - .035]) for (const side of [-1, 1]) {
      const u = a[0] + du * (v - a[1]) / dv + side * (halfWidth + .035)
      if (Math.abs(u) > p.lot.width / 2 - .06) continue
      const qx = x + c * u - s * v, qy = y + s * u + c * v
      const h = getCityGroundHeight(paving, 3200, qx / 3200, qy, 400)
      expect(h, p.id + ' missing paved entrance edge').toBeGreaterThan(0)
      const visible = withStreetPaving(h, qx, qy)
      expect(Math.abs(getCityGroundHeight(physics, 3200, qx / 3200, qy, visible + .03) - visible), p.id).toBeLessThan(.02)
      probes++
    }
  }
  expect(probes).toBeGreaterThan(1000)
})

test('all back streets have drawn and physical walkable surfaces connected to their frontage road', () => {
  const drawn = drawingIndex('arch-lane')
  const base = decodeColonyMesh(manifest.base, false).meshes
  const visibleRoad = drawnMeshIndex([
    ...decodeColonyMesh(manifest.neighbourhoods!.fixed, false).meshes['arch-lane'],
    ...['local', 'arterial', 'walk'].flatMap(name => base[name] ?? [])
  ])
  const upstream = buildCityCollisionIndex(colonyColliders(manifest, undefined, undefined, undefined, []), 3200, 40000)
  expect([...parcels.streets, ...parcels.rejectedStreets].map(s => s.id).sort()).toEqual(streets.streets.map(s => s.id).sort())
  expect(parcels.streets.length).toBeGreaterThanOrEqual(30)
  for (const rejected of parcels.rejectedStreets) {
    if (rejected.reason === 'junction-grade') expect(rejected.maximumGrade).toBeGreaterThan(.075)
    else {
      expect(rejected.reason).toBe('parent-unavailable')
      const sketch = streets.streets.find(s => s.id === rejected.id)!
      expect(sketch.parents?.some(id => parcels.rejectedStreets.some(s => s.id === id))).toBe(true)
    }
    expect(parcels.parcels.some(p => p.lot.street === rejected.id)).toBe(false)
  }
  for (const street of parcels.streets) {
    const rows = street.profile
    const junctions = [rows[0], ...(street.connections.length > 1 ? [rows.at(-1)!] : []),
      ...parcels.streets.flatMap(s => s.connections.flatMap((parent, i) => parent === street.id ? [i === 0 ? s.profile[0] : s.profile.at(-1)!] : []))]
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
      expect(Math.abs(b[2] - a[2]) / length, street.id).toBeLessThanOrEqual(.075001)
      for (const side of [-.3, 0, .3]) {
        const x = (a[0] + b[0]) / 2 - (b[1] - a[1]) / length * street.width * side
        const y = (a[1] + b[1]) / 2 + (b[0] - a[0]) / length * street.width * side
        const junction = junctions.some(p => Math.hypot(x - p[0], y - p[1]) < 12)
        // Existing cross streets have 14 cm raised footways. An apron joins
        // their actual corners, whose plane need not equal its centre sample.
        const crossfall = Math.abs(side) * street.width * .075 + (junction ? .15 : 0)
        const h = getCityGroundHeight(drawn, 3200, x / 3200, y, Math.max(a[2], b[2]) + crossfall + .03)
        // At bent sections the cross-section rotates, so an off-centre probe
        // need not interpolate exactly half way between the row heights.
        // The junction apron also inherits the existing road's crossfall.
        expect(h, `${street.id} row ${i} side ${side} at ${x},${y}`).toBeGreaterThan(Math.min(a[2], b[2]) - crossfall - .03)
        expect(h, street.id).toBeLessThan(Math.max(a[2], b[2]) + crossfall + .03)
        // At the junction, the existing road and the apron are both visible.
        // Compare physics with their top surface, not only the added apron.
        const visible = getCityGroundHeight(visibleRoad, 3200, x / 3200, y, h + (junction ? .18 : .05), 0)
        const physical = getCityGroundHeight(physics, 3200, x / 3200, y, visible + .03)
        expect(Math.abs(physical - visible), JSON.stringify({ street: street.id, i, side, x, y, h, visible, physical })).toBeLessThan(.02)
      }
    }
    for (const [end, p] of [rows[0], ...(street.connections.length > 1 ? [rows.at(-1)!] : [])].entries()) {
      const parent = parcels.streets.find(s => s.id === street.connections[end])
      let h = getCityGroundHeight(upstream, 3200, p[0] / 3200, p[1], p[2] + .1)
      if (parent) {
        // A child meets the saved parent road, rather than the terrain under
        // it. Find the closest parent cross-section and its actual grade.
        const samples = parent.profile.slice(1).map((b, i) => {
          const a = parent.profile[i], dx = b[0] - a[0], dy = b[1] - a[1]
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
          return { distance: Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t), height: a[2] + (b[2] - a[2]) * t }
        }).sort((a, b) => a.distance - b.distance)
        expect(samples[0].distance, street.id).toBeLessThan(parent.width / 2)
        h = samples[0].height
      }
      expect(Math.abs(p[2] - h), street.id + ' joins existing street').toBeLessThan(.03)
    }
  }
})

test('frontage lots stay outside every segment of their own bent street', () => {
  const poly = (points: number[][]) => positivePolygon(points.map(([x, y]) => ({ x, y, u: 0, v: 0 })))
  for (const street of parcels.streets) {
    const corridors = street.points.slice(1).map((b, i) => {
      const a = street.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const nx = -(b[1] - a[1]) / length * (street.width / 2 - .03)
      const ny = (b[0] - a[0]) / length * (street.width / 2 - .03)
      return poly([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]])
    })
    for (const p of parcels.parcels.filter(p => p.lot.street === street.id)) for (const road of corridors) {
      expect(polygonArea(intersectStreetPolygons(poly(p.lot.polygon), road)), p.id).toBeLessThan(.00001)
    }
  }
})

test('back lanes serve inhabited second-depth plots and courtyard voids retain native floors', async () => {
  const secondary = parcels.streets.filter(s => s.parents?.length)
  const ids = new Set(secondary.map(s => s.id))
  const members = parcels.parcels.filter(p => ids.has(p.route))
  expect(new Set(members.map(p => p.district)).size).toBeGreaterThanOrEqual(10)
  for (const street of secondary) for (const parent of street.parents!) {
    expect(parcels.streets.some(s => s.id === parent), street.id).toBe(true)
  }
  for (const band of [0, 1, 2]) {
    const courts = parcels.parcels.filter(p => p.band === band && p.form === 'courtyard-apartment')
    expect(courts.length).toBeGreaterThan(0)
    const p = courts[0], v = p.size[1] * .3
    const x = p.position[0] - Math.sin(p.yaw) * v, y = p.position[1] + Math.cos(p.yaw) * v
    const tile = manifest.tiles.find(t => t.neighbourhood && x >= t.bounds[0] && x <= t.bounds[2] && y >= t.bounds[1] && y <= t.bounds[3]
      && t.boxes.some(b => Math.hypot(b[0] - p.position[0], b[1] - p.position[1]) < .001))!
    const native = decodeColonyMesh(await Bun.file(new URL('../../public' + tile.url, import.meta.url)).json()).meshes
    const drawn = drawnMeshIndex(native['arch-foundation'])
    const visible = getCityGroundHeight(drawn, 3200, x / 3200, y, p.floor + .05, 0)
    expect(Math.abs(visible - p.floor), p.id).toBeLessThan(.01)
    expect(Math.abs(getCityGroundHeight(physics, 3200, x / 3200, y, p.floor + .05, 0) - visible), p.id).toBeLessThan(.02)
  }
})

test('new frontages and lot grounds agree with drawn support and preserve the local collision budget', async () => {
  const drawn = drawingIndex(), near = new Set<CityBuilding>()
  // The exposed foundation cap is visible in the building tile, above the
  // end of its approach. Include that rendered surface when comparing physics;
  // checking only the fixed approach mistakes its covered part for the floor.
  const foundations = new Map<string, ReturnType<typeof drawnMeshIndex>>()
  for (const tile of manifest.tiles.filter(t => t.neighbourhood)) {
    const mesh = decodeColonyMesh(await Bun.file(new URL('../../public' + tile.url, import.meta.url)).json(), false)
    foundations.set(tile.id, drawnMeshIndex(mesh.meshes['arch-foundation'] ?? []))
  }
  for (const p of parcels.parcels) {
    expect(p.access.maximumStep, p.id).toBeLessThan(.15)
    expect(Math.abs(p.access.end[2] - p.floor), p.id).toBeLessThan(.003)
    for (const t of [.05, .25, .5, .75, .95]) {
      const q = p.access.start.map((v, i) => v + (p.access.end[i] - v) * t)
      const tiles = manifest.tiles.filter(tile => tile.neighbourhood && q[0] >= tile.bounds[0] && q[0] <= tile.bounds[2]
        && q[1] >= tile.bounds[1] && q[1] <= tile.bounds[3])
      const h = Math.max(getCityGroundHeight(drawn, 3200, q[0] / 3200, q[1], 400), ...tiles.map(tile =>
        getCityGroundHeight(foundations.get(tile.id)!, 3200, q[0] / 3200, q[1], p.floor + .05, 0)))
      expect(h, p.id).toBeGreaterThan(0)
      const visible = withStreetPaving(h, q[0], q[1])
      expect(Math.abs(getCityGroundHeight(physics, 3200, q[0] / 3200, q[1], visible + .03) - visible), p.id).toBeLessThan(.02)
      collectCityCollidersNear(physics, q[0] / 3200, q[1], 1, near)
      expect(near.size, p.id).toBeLessThanOrEqual(32)
      expect([...near].reduce((sum, b) => sum + (b.surfaceMesh?.length ?? 0) / 9, 0), p.id).toBeLessThanOrEqual(4096)
    }
    const u = 0, v = p.size[1] / 2 + p.lot.rearGarden / 2
    const x = p.position[0] + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v
    const y = p.position[1] + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v
    const h = getCityGroundHeight(drawn, 3200, x / 3200, y, 400)
    expect(h, p.id).toBeGreaterThan(0)
    const visible = withStreetPaving(h, x, y)
    expect(Math.abs(getCityGroundHeight(physics, 3200, x / 3200, y, visible + .03) - visible), p.id).toBeLessThan(.02)
  }
})

test('collision cost stays bounded between the roads, including the outer edges of dense housing', () => {
  const near = new Set<CityBuilding>()
  for (const n of parcels.neighbourhoods) {
    const points = parcels.parcels.filter(p => p.district === n.id).flatMap(p => p.lot.polygon)
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    for (let x = Math.min(...xs) - 64; x <= Math.max(...xs) + 64; x += 16)
      for (let y = Math.min(...ys) - 64; y <= Math.max(...ys) + 64; y += 16) {
        collectCityCollidersNear(physics, x / 3200, y, 1, near)
        expect(near.size, n.id).toBeLessThanOrEqual(32)
        expect([...near].reduce((sum, b) => sum + (b.surfaceMesh?.length ?? 0) / 9, 0), `${n.id} at ${x},${y}`).toBeLessThanOrEqual(4096)
      }
  }
})

test('street lamps have visible support and share the bounded near-light pool on all strips', () => {
  const lights = manifest.neighbourhoods!.lights!, layer = new AuthoredLandscape(new Group())
  const poles = parcels.parcels.flatMap(p => p.proxyParts.filter(part => part[3] === .16 && part[4] === .16).map(part => ({
    x: p.position[0] + Math.cos(p.yaw) * Number(part[0]) - Math.sin(p.yaw) * Number(part[1]),
    y: p.position[1] + Math.sin(p.yaw) * Number(part[0]) + Math.cos(p.yaw) * Number(part[1]),
    h: p.floor + Number(part[2]) + Number(part[5])
  })))
  expect(lights.length).toBeGreaterThan(200)
  expect(lights).toHaveLength(poles.length)
  for (const light of lights) expect(poles.some(p => Math.hypot(p.x - light.position[0], p.y - light.position[1]) < .5
    && Math.abs(p.h - light.position[2] - .21) < .01)).toBe(true)
  layer.rebuild('izma', unpackLandscapeLibrary(worldRaw).izma, 3200, [...manifest.publicRealm!.lights!, ...lights])
  try {
    expect(layer.group.children.filter(o => o.type === 'PointLight')).toHaveLength(LANDSCAPE_LIGHT_BUDGET)
    for (const daylight of [0, 1]) {
      layer.setDaylight(daylight)
      for (let i = 0; i < lights.length; i += 13) {
        const [x, y, h] = lights[i].position
        layer.update(x / 3200 - Math.PI * 2, y, h - 2.1)
        expect(layer.group.userData.activeLights).toBeLessThanOrEqual(LANDSCAPE_LIGHT_BUDGET)
        if (daylight === 0) expect(layer.group.userData.activeLights).toBeGreaterThan(0)
        else expect(layer.group.userData.activeLights).toBe(0)
      }
    }
  } finally { layer.dispose() }
})
