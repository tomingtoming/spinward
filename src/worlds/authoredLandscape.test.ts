import { expect, test } from 'bun:test'
import * as THREE from 'three'
import raw from './generated/worldLandscapes.json'
import { unpackLandscapeLibrary } from './landscapeData'
import { AuthoredLandscape, LANDSCAPE_LIGHT_BUDGET, landscapeColliders } from './authoredLandscape'
import { resolveAuthoredWorld, WORLD_DEFINITIONS } from './worldDefinitions'
import { FULL_360_TOPOLOGY, ISLAND_THREE_TOPOLOGY } from '../sim/habitatConfig'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, getCityGroundHeight, resolveCitySurfaceCollision } from '../objects/cityLayout'

const library = unpackLandscapeLibrary(raw)
const ids = ['izma', 'cooper', 'elysium'] as const

test('authored maps require an explicit identity and matching physical envelope', () => {
  for (const id of ids) {
    const world = WORLD_DEFINITIONS[id]
    const config = { worldId: id, radius: world.radius, length: world.span, type: world.type,
      topology: id === 'izma' ? ISLAND_THREE_TOPOLOGY : FULL_360_TOPOLOGY }
    expect(resolveAuthoredWorld(config)).toBe(id)
    expect(resolveAuthoredWorld({ ...config, worldId: 'custom' })).toBeNull()
    expect(resolveAuthoredWorld({ ...config, radius: config.radius + 1 })).toBeNull()
    expect(resolveAuthoredWorld({ ...config, length: config.length - 1 })).toBeNull()
    expect(resolveAuthoredWorld({ ...config, type: world.type === 'ring' ? 'cylinder' : 'ring' })).toBeNull()
    expect(resolveAuthoredWorld({ ...config, topology: { ...config.topology,
      landArcs: config.topology.landArcs.map(a => ({ ...a, centerAzimuth: a.centerAzimuth + .1 })) } })).toBeNull()
  }
  expect(resolveAuthoredWorld({ worldId: 'playground', radius: 18, length: 120,
    type: 'cylinder', topology: FULL_360_TOPOLOGY })).toBeNull()
})

for (const id of ids) test(`${id}: Blender export, visible floor and streamed grounding agree`, () => {
  const data = library[id], world = WORLD_DEFINITIONS[id], radius = world.radius
  expect(data.extent).toEqual([640, 800]); expect(data.spawn).toHaveLength(3)
  const counts = data.lods.map(l => Object.values(l).reduce((n, v) => n + v.length / 9, 0))
  // Izma includes dressed frontages, public edges and a bridge arch. Fine
  // hardware remains near-only instead of raising every LOD's detail cost.
  expect(counts[0]).toBeLessThan(id === 'izma' ? 48000 : 30000)
  expect(counts[1]).toBeLessThan(counts[0]); expect(counts[2]).toBeLessThan(counts[1])
  for (const lod of data.lods) for (const [material, vertices] of Object.entries(lod)) {
    expect(data.palette[material]).toMatch(/^#[0-9a-f]{6}$/)
    expect(vertices.length % 9).toBe(0)
    expect(vertices.every(Number.isFinite)).toBe(true)
  }
  // The exported collision mesh must consist of triangles that are also
  // visible at LOD0. Catch transform drift or stale separately-generated data.
  const drawn = new Set(Object.values(data.lods[0]).flatMap(v =>
    Array.from({ length: v.length / 9 }, (_, i) => v.slice(i * 9, i * 9 + 9).join(','))))
  for (const { vertices } of data.surfaces) for (let i = 0; i < vertices.length; i += 9) {
    expect(drawn.has(vertices.slice(i, i + 9).join(','))).toBe(true)
  }
  const colliders = landscapeColliders(data, radius)
  const index = buildCityCollisionIndex(colliders, radius, world.span)
  const [x, y, h] = data.spawn, a = x / radius
  const height = getCityGroundHeight(index, radius, a, y, h)
  expect(Math.abs(height - h)).toBeLessThan(.15)
  expect(collectCityBuildingsInWindow(index, a, y, 1, new Set()).size).toBeLessThan(colliders.length / 2)
  const parent = new THREE.Group(), layer = new AuthoredLandscape(parent)
  layer.rebuild(id, data, radius); parent.updateMatrixWorld(true)
  const near = layer.group.getObjectByName('landscape-lod-0')!
  const origin = new THREE.Vector3(Math.cos(a) * (radius - h - 2), y, Math.sin(a) * (radius - h - 2))
  const hits = new THREE.Raycaster(origin, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0, 4).intersectObject(near, true)
  expect(hits.length).toBeGreaterThan(0)
  const drawnHeight = radius - Math.hypot(hits[0].point.x, hits[0].point.z)
  expect(Math.abs(drawnHeight - height)).toBeLessThan(.07)
  // Regression: edge-only draping and long cylinder chords buried the middle
  // of Izma's west lane and Elysium's lakeside walk. Probe the actual wrapped
  // faces, not just the unrolled height formula or route control points.
  const earth = near.getObjectByName('landscape-earth')!
  for (const name of ['road', 'walk']) {
    const path = near.getObjectByName(`landscape-${name}`) as THREE.Mesh
    const positions = path.geometry.getAttribute('position')
    const stride = Math.max(1, Math.floor(positions.count / 3 / 80)) * 3
    for (let i = 0; i < positions.count; i += stride) {
      const p = new THREE.Vector3()
      for (let j = 0; j < 3; j++) p.add(new THREE.Vector3().fromBufferAttribute(positions, i + j))
      p.multiplyScalar(1 / 3)
      const outward = new THREE.Vector3(p.x, 0, p.z).normalize()
      const ray = new THREE.Raycaster(p.clone().addScaledVector(outward, -3), outward, 0, 30)
      const floor = ray.intersectObject(earth, false)[0]
      expect(floor, `${id} ${name} face ${i / 3} has terrain below`).toBeDefined()
      expect(floor.distance, `${id} ${name} face ${i / 3} is not buried`).toBeGreaterThan(2.965)
    }
  }
  expect(layer.visit()?.groundHeight).toBeCloseTo(h, 4)
  layer.update(0, 2000, 0); expect(layer.group.userData.lod).toBe(1)
  layer.update(0, 5000, 0); expect(layer.group.userData.lod).toBe(2)
  layer.clear(); expect(layer.visit()).toBeNull(); expect(layer.group.children).toHaveLength(0)
  layer.dispose(); expect(parent.children).toHaveLength(0)
})

test('the river bridge supports a continuous thirty metre crossing', () => {
  const data = library.izma, index = buildCityCollisionIndex(landscapeColliders(data, 3200), 3200, 40000)
  let h = data.spawn[2]
  for (let x = data.spawn[0]; x < data.spawn[0] + 30; x += .25) {
    h = getCityGroundHeight(index, 3200, x / 3200, data.spawn[1], h)
    expect(h).toBeCloseTo(8.2, 3)
  }
})

for (const route of Object.keys(library.izma.walks!)) test(`${route}: pavement and door clearance form a continuous walk`, () => {
  const data=library.izma, points=data.walks![route]
  const index=buildCityCollisionIndex(landscapeColliders(data,3200),3200,40000)
  let height=points[0][2], distance=0
  for (let segment=1;segment<points.length;segment++) {
    const a=points[segment-1],b=points[segment],length=Math.hypot(b[0]-a[0],b[1]-a[1])
    const steps=Math.ceil(length/.5);distance+=length
    for (let i=0;i<=steps;i++) {
      const x=a[0]+(b[0]-a[0])*i/steps,y=a[1]+(b[1]-a[1])*i/steps
      const next=getCityGroundHeight(index,3200,x/3200,y,height)
      expect(Math.abs(next-height),`${route} segment ${segment} at ${x},${y}: vertical gap`).toBeLessThan(.3)
      const pose={azimuth:x/3200,axialPosition:y}
      expect(resolveCitySurfaceCollision(pose,index,3200,.34,next+.18),
        `${route} segment ${segment} at ${x},${y}: wall blocks the walking line`).toBe(false)
      height=next
    }
  }
  expect(distance).toBeGreaterThan(route==='bridge-to-homes'?350:5)
  expect(height).toBeCloseTo(points.at(-1)![2],1)
})

test('authored visits resolve their own shops and hillside, and do not leak into other worlds', () => {
  const layer=new AuthoredLandscape(new THREE.Group())
  layer.rebuild('izma',library.izma,3200)
  expect(layer.visit('shops')).not.toBeNull();expect(layer.visit('garden')).not.toBeNull()
  expect(layer.visit('cafe')).toBeNull()
  layer.rebuild('cooper',library.cooper,3200)
  expect(layer.visit('shops')).toBeNull();expect(layer.visit('garden')).toBeNull()
  layer.dispose()
})

test('market and hillside lanes keep trees and posts out of the carriageway', () => {
  const data=library.izma
  const lanes=data.routes.filter(r=>/^(Market_lane|Hillside_lane)/.test(r.name))
  expect(lanes).toHaveLength(2)
  for(const solid of data.solids.filter(s=>s.width<=.6&&s.depth<=.6&&s.height>2)){
    for(const lane of lanes){
      let distance=Infinity
      for(let i=1;i<lane.points.length;i++){
        const a=lane.points[i-1],b=lane.points[i],dx=b[0]-a[0],dy=b[1]-a[1]
        const t=Math.max(0,Math.min(1,((solid.x-a[0])*dx+(solid.y-a[1])*dy)/(dx*dx+dy*dy)))
        distance=Math.min(distance,Math.hypot(solid.x-a[0]-t*dx,solid.y-a[1]-t*dy))
      }
      expect(distance-lane.width/2-Math.hypot(solid.width,solid.depth)/2,
        `post at ${solid.x},${solid.y} intrudes into ${lane.name}`).toBeGreaterThan(.1)
    }
  }
})

test('night windows vary by room and all local light sources have a visible fitting', () => {
  const data=library.izma
  for(const name of ['window_warm','window_neutral','window_cool','window_off']) {
    for(const lod of data.lods) expect(lod[name].length).toBeGreaterThan(0)
  }
  const fittings=data.lods[0].lamp_glass
  expect(data.lights!.length).toBeGreaterThan(12)
  for(const light of data.lights!) {
    let distance=Infinity
    const point=new THREE.Vector3(...light.position),closest=new THREE.Vector3(),triangle=new THREE.Triangle()
    for(let i=0;i<fittings.length;i+=9) {
      triangle.a.fromArray(fittings,i);triangle.b.fromArray(fittings,i+3);triangle.c.fromArray(fittings,i+6)
      distance=Math.min(distance,triangle.closestPointToPoint(point,closest).distanceTo(point))
    }
    expect(distance,'illumination must attach to a lamp or ceiling fitting').toBeLessThan(.65)
  }
})

test('drainage inlets lie flush with the hillside paving', () => {
  const layer=new AuthoredLandscape(new THREE.Group())
  layer.rebuild('izma',library.izma,3200)
  const near=layer.group.getObjectByName('landscape-lod-0')!
  const slots=near.getObjectByName('landscape-drain_slot') as THREE.Mesh
  const earth=near.getObjectByName('landscape-earth')!
  const paving=[near.getObjectByName('landscape-road')!,near.getObjectByName('landscape-walk')!]
  const positions=slots.geometry.getAttribute('position')
  expect(positions.count).toBeGreaterThan(0)
  for(let i=0;i<positions.count;i+=3) {
    const p=new THREE.Vector3()
    for(let j=0;j<3;j++)p.add(new THREE.Vector3().fromBufferAttribute(positions,i+j))
    p.divideScalar(3)
    const out=new THREE.Vector3(p.x,0,p.z).normalize()
    const hit=new THREE.Raycaster(p.clone().addScaledVector(out,-1),out,0,2).intersectObject(earth)[0]
    expect(hit).toBeDefined()
    expect(hit.distance).toBeGreaterThan(1.11);expect(hit.distance).toBeLessThan(1.17)
  }
  // Following terrain alone still left the panels 8 cm above the footway.
  // Check every corner against the actual paving, including road overlaps.
  for(let i=0;i<positions.count;i++) {
    const p=new THREE.Vector3().fromBufferAttribute(positions,i),out=new THREE.Vector3(p.x,0,p.z).normalize()
    const hit=new THREE.Raycaster(p.clone().addScaledVector(out,-1),out,0,2).intersectObjects(paving)[0]
    expect(hit).toBeDefined();expect(Math.abs(hit.distance-1)).toBeLessThan(.031)
  }
  layer.dispose()
})

test('day/night lighting stays bounded, leaves roads unlit, and releases its resources on world change', () => {
  const layer=new AuthoredLandscape(new THREE.Group())
  layer.rebuild('izma',library.izma,3200)
  const near=layer.group.getObjectByName('landscape-lod-0')!
  const materials=near.children.map(m=>(m as THREE.Mesh).material as THREE.MeshStandardMaterial)
  const textures=new Set(materials.map(m=>m.map).filter(t=>t!==null))
  let disposed=0
  textures.forEach(t=>t!.addEventListener('dispose',()=>disposed++))
  const lamp=near.getObjectByName('landscape-lamp_glass') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>
  const road=near.getObjectByName('landscape-road') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>
  layer.update(-101/3200,-70,10)
  layer.setDaylight(1);expect(lamp.material.emissiveIntensity).toBe(0)
  expect(layer.group.userData.activeLights).toBe(0)
  layer.setDaylight(0);expect(lamp.material.emissiveIntensity).toBeGreaterThan(0)
  expect(road.material.emissive.getHex()).toBe(0)
  expect(layer.group.userData.activeLights).toBeGreaterThan(0)
  expect(layer.group.userData.activeLights).toBeLessThanOrEqual(LANDSCAPE_LIGHT_BUDGET)
  layer.update(0,5000,100);expect(layer.group.userData.activeLights).toBe(0)
  layer.rebuild('cooper',library.cooper,3200)
  expect(disposed).toBe(textures.size);expect(textures.size).toBeGreaterThan(0)
  expect(layer.group.children.some(o=>o instanceof THREE.PointLight)).toBe(false)
  layer.dispose()
})
