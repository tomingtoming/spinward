import { expect, test } from 'bun:test'
import * as THREE from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import corners from '../../assets/blender/izma-corner-blocks.json'
import { AuthoredColony, readColonyManifest, type ColonyManifest, type ColonyPackedMesh } from './authoredColony'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'

const empty: ColonyPackedMesh = { vertices: [], meshes: {}, surfaces: [] }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('an oblique mesh proxy survives failed detail and disappears only when its matching tile is ready', async () => {
  const shape: ColonyPackedMesh = { vertices: [0,0,4,10,0,4,3,8,4], meshes: { wall: [0,1,2] }, surfaces: [] }
  const manifest: ColonyManifest = { version: 1, radius: 3200, span: 40000, palette: { wall: '#aaaaaa' }, base: empty, visits: {},
    tiles: [{ id: 'corner', url: '/landscapes/izma/corner.json', band: 0, bounds: [0,0,10,8], districts: ['test'],
      boxes: [], proxyParts: [], proxyMesh: shape, architecture: true, cornerBlock: true }] }
  let finish: (p: ColonyPackedMesh) => void = () => {}
  const layer = new AuthoredColony(new THREE.Group(), () => new Promise(resolve => { finish = resolve }))
  layer.rebuild(readColonyManifest(manifest)); layer.update(0,0,2)
  const proxy = layer.group.getObjectByName('colony-mesh-proxy-corner')!
  expect(proxy.visible).toBe(true)
  finish({ ...shape, mid: shape }); await tick()
  expect(proxy.visible).toBe(false)
  layer.update(0,4000,2)
  expect(proxy.visible).toBe(true)
  layer.rebuild(null)
  expect(layer.group.children).toHaveLength(0)
  layer.dispose()
  const failed = new AuthoredColony(new THREE.Group(), async () => { throw Error('offline') })
  failed.rebuild(manifest); failed.update(0,0,2); await tick()
  expect(failed.group.getObjectByName('colony-mesh-proxy-corner')!.visible).toBe(true)
  failed.dispose()
})

test('every saved corner roof has the same far silhouette and physical support', () => {
  const manifest = readColonyManifest(raw)
  const layer = new AuthoredColony(new THREE.Group(), async () => empty)
  layer.rebuild({ ...manifest, base: empty, architecture: undefined, neighbourhoods: undefined, publicRealm: undefined,
    railways: undefined, landUse: undefined, streetFrontages: undefined, structures: [],
    tiles: manifest.tiles.filter(t => t.cornerBlock) })
  layer.group.updateMatrixWorld(true)
  const index = buildCityCollisionIndex(layer.getColliders(),3200,40000)
  for (const p of corners.parcels) {
    const x=p.outline.reduce((n,q)=>n+q[0],0)/p.outline.length
    const y=p.outline.reduce((n,q)=>n+q[1],0)/p.outline.length
    const a=x/3200,out=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),origin=out.clone().multiplyScalar(2800)
    origin.y=y
    const hit=new THREE.Raycaster(origin,out,0,600).intersectObject(layer.group,true)[0]
    expect(hit,p.id).toBeDefined()
    const h=3200-Math.hypot(hit.point.x,hit.point.z)
    expect(Math.abs(h-getCityGroundHeight(index,3200,a,y,h+.1)),p.id).toBeLessThan(.02)
  }
  expect(new Set(corners.parcels.map(p=>p.band)).size).toBe(3)
  layer.dispose()
})
