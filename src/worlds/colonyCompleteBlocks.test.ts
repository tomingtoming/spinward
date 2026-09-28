import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import plan from '../../assets/blender/izma-block-parcels.json'
import original from '../../assets/blender/izma-neighbourhood-parcels.json'
import city from '../../qa/neighborhood-life/city-parcels'
import { AuthoredColony, colonyColliders, decodeColonyMesh, readColonyManifest, type ColonyPackedMesh } from './authoredColony'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight } from '../objects/cityLayout'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'

const manifest = readColonyManifest(raw)
const empty: ColonyPackedMesh = { vertices: [], meshes: {}, surfaces: [] }

test('complete blocks replace only named source parcels and keep every dependency and detail request current', async () => {
  const replacement = manifest.cityBlocks!
  expect(replacement).toBeDefined()
  const retired = plan.blocks.flatMap(b => b.retiredParcels).sort()
  expect(replacement.retiredParcelIds.toSorted()).toEqual(retired)
  expect(new Set(retired).size).toBe(retired.length)
  for (const id of retired) expect(original.parcels.some(p => p.id === id), id).toBe(true)
  expect(manifest.neighbourhoods!.counts.buildings + retired.length).toBe(city.parcels.length)
  expect(replacement.counts.buildings).toBe(plan.blocks.reduce((n,b) => n+b.plots.length,0))
  const bytes = await Bun.file(new URL('../../assets/blender/izma-block-parcels.json', import.meta.url)).arrayBuffer()
  expect(replacement.planHash).toBe(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'))
  for (const [name, digest] of Object.entries(plan.dependencies)) {
    const bytes = await Bun.file(new URL('../../assets/blender/'+name, import.meta.url)).arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), name).toBe(digest)
  }
  expect(manifest.tiles.filter(t => t.completeBlock)).toHaveLength(plan.blocks.length)
  for (const block of plan.blocks) {
    const tile = manifest.tiles.find(t => t.id === 'block-'+block.id)!
    expect(tile.completeBlock).toBe(true)
    expect(tile.boxes).toEqual([])
    expect(tile.proxyParts).toEqual([])
    expect(manifest.visits[tile.id]).toBeDefined()
    const file = Bun.file(new URL('../../public'+tile.url, import.meta.url))
    expect(file.size).toBeLessThan(4*1024*1024)
    const mesh = await file.json()
    for (const lod of [mesh, mesh.mid, tile.proxyMesh]) {
      expect(Object.keys(decodeColonyMesh(lod, false).meshes).length).toBeGreaterThan(0)
    }
  }
})

test('all complete-block roofs retain the same drawn height at every LOD and their physical support', async () => {
  const layer = new AuthoredColony(new THREE.Group(), async () => empty)
  layer.rebuild({ ...manifest, base: empty, architecture: undefined, neighbourhoods: undefined, publicRealm: undefined,
    railways: undefined, landUse: undefined, streetFrontages: undefined, cornerBlocks: undefined, structures: [],
    tiles: manifest.tiles.filter(t => t.completeBlock) })
  const index = buildCityCollisionIndex(layer.getColliders(),3200,40000)
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  try {
    for (const block of plan.blocks) {
      const tile = manifest.tiles.find(t => t.id === 'block-'+block.id)!
      const detail = await Bun.file(new URL('../../public'+tile.url, import.meta.url)).json()
      for (const packed of [detail,detail.mid,tile.proxyMesh!]) {
        const vertices = citySurfaceVertices(Object.values(decodeColonyMesh(packed,false).meshes).flat(),3200)
        const geometry = new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(vertices,3))
        const mesh = new THREE.Mesh(geometry,material); mesh.position.x=3200; mesh.updateMatrixWorld(true)
        for (const p of block.plots) {
          const x=p.outline.reduce((n,q)=>n+q[0],0)/p.outline.length, y=p.outline.reduce((n,q)=>n+q[1],0)/p.outline.length
          const a=x/3200,out=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),origin=out.clone().multiplyScalar(2800);origin.y=y
          const hit=new THREE.Raycaster(origin,out,0,600).intersectObject(mesh)[0]
          expect(hit,p.id).toBeDefined()
          const h=3200-Math.hypot(hit.point.x,hit.point.z)
          expect(h,p.id).toBeGreaterThan(p.floor+p.height)
          expect(Math.abs(h-getCityGroundHeight(index,3200,a,y,h+.1)),p.id).toBeLessThan(.02)
        }
        geometry.dispose()
      }
    }
  } finally { material.dispose(); layer.dispose() }
})

test('both court passages have visible support and the denser blocks retain the local collision budget', () => {
  const layer = new AuthoredColony(new THREE.Group(),async () => empty)
  layer.rebuild(manifest); layer.group.updateMatrixWorld(true)
  const physics=buildCityCollisionIndex(colonyColliders(manifest),3200,40000)
  const court=layer.group.getObjectByName('colony-block-courts')!,near=new Set<ReturnType<typeof colonyColliders>[number]>()
  expect(court).toBeDefined()
  try {
    for (const block of plan.blocks) {
      for (const gate of block.gates) for (const [a,b] of [[gate.start,gate.end],[gate.end,block.centre]]) {
        for (let i=1;i<20;i++) {
          const x=a[0]+(b[0]-a[0])*i/20,y=a[1]+(b[1]-a[1])*i/20,angle=x/3200
          const out=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)),origin=out.clone().multiplyScalar(2800);origin.y=y
          const hit=new THREE.Raycaster(origin,out,0,600).intersectObject(court,true)[0]
          expect(hit,block.id+' open passage').toBeDefined()
          const h=3200-Math.hypot(hit.point.x,hit.point.z)
          expect(h,block.id+' no roof over passage').toBeLessThan(Math.max(...block.plots.map(p=>p.floor))+.5)
          expect(Math.abs(h-getCityGroundHeight(physics,3200,angle,y,h+.1)),block.id).toBeLessThan(.02)
        }
      }
      const xs=block.boundary.map(p=>p[0]),ys=block.boundary.map(p=>p[1])
      for(let x=Math.min(...xs)-32;x<Math.max(...xs)+32;x+=4)for(let y=Math.min(...ys)-32;y<Math.max(...ys)+32;y+=4){
        collectCityCollidersNear(physics,x/3200,y,1,near)
        const context=block.id+' at '+x+','+y
        expect(near.size,context).toBeLessThanOrEqual(32)
        expect([...near].reduce((n,b)=>n+(b.surfaceMesh?.length??0)/9,0),context).toBeLessThanOrEqual(4096)
      }
    }
  } finally { layer.dispose() }
})
