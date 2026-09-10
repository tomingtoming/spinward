import {expect,test} from 'bun:test'
import * as THREE from 'three'
import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import contract from '../../assets/blender/neighborhood-fronts.json'
import cafe from '../../assets/blender/cafe-pilot.json'
import {planCity,type CityBuilding} from './cityLayout'
import {planBuildingInteriors} from './buildingInteriors'
import {matchNeighborhoodLot,neighborhoodPoint,neighborhoodDistance,neighborhoodFade,NEIGHBORHOOD_SHOPS} from './neighborhoodFronts'
const b=contract.building as CityBuilding,R=3200

test('neighbourhood shops match one real closed lot and preserve its central access',()=>{
 const buildings=planCity(cafe.habitat).buildings,lot=matchNeighborhoodLot(buildings,R)
 expect(lot).not.toBeNull();expect(planBuildingInteriors(buildings,R).has(lot!)).toBe(false)
 expect(buildings.filter(candidate=>matchNeighborhoodLot([candidate],R)).length).toBe(1)
 expect(matchNeighborhoodLot(buildings,1600)).toBeNull()
 expect(matchNeighborhoodLot([{...b,axial:b.axial+1}],R)).toBeNull()
 const intervals=NEIGHBORHOOD_SHOPS.map(s=>[s.x-5.2,s.x+5.2]).sort((a,b)=>a[0]-b[0])
 for(let i=0;i<intervals.length;i++){
  expect(intervals[i][0]).toBeGreaterThan(b.access!.width/2+.5)
  expect(intervals[i][1]).toBeLessThan(b.depth/2-.3)
  if(i)expect(intervals[i][0]-intervals[i-1][1]).toBeGreaterThan(1)
 }
 expect(b.access!.length).toBeGreaterThan(.95)
})

test('shop range measures each frontage rather than the tall building envelope',()=>{
 for(const shop of NEIGHBORHOOD_SHOPS){
  const p=neighborhoodPoint(b,R,new THREE.Vector3(shop.x,1.8,b.width/2+.4))
  expect(neighborhoodDistance(b,R,shop.x,Math.atan2(p.z,p.x),p.y,1.8)).toBeCloseTo(0)
  expect(neighborhoodDistance(b,R,shop.x,Math.atan2(p.z,p.x)+Math.PI*2,p.y,1.8)).toBeCloseTo(0)
  expect(neighborhoodFade(0,1.8)).toBe(1)
  expect(neighborhoodFade(155,1.8)).toBeGreaterThan(0)
  expect(neighborhoodFade(175,1.8)).toBe(0)
  expect(neighborhoodFade(0,b.height)).toBe(0)
 }
})

test('Blender storefront levels respect display, canopy, road and triangle budgets',async()=>{
 const bytes=readFileSync(new URL('../../public/assets/buildings/neighborhood-fronts.glb',import.meta.url));expect(bytes.length).toBeLessThan(500_000)
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');gltf.scene.updateMatrixWorld(true)
 for(const shop of NEIGHBORHOOD_SHOPS)for(const lod of [0,1]){
  const obj=gltf.scene.getObjectByName(`${shop.id}_lod${lod}`)!;expect(obj).toBeDefined()
  const box=new THREE.Box3().setFromObject(obj);expect(box.min.x).toBeGreaterThan(shop.x-5.21);expect(box.max.x).toBeLessThan(shop.x+5.21)
  expect(box.min.y).toBeGreaterThan(.19);expect(box.max.y).toBeLessThan(4.21)
  expect(box.min.z).toBeGreaterThan(b.width/2+.1);expect(box.max.z).toBeLessThan(b.width/2+.96)
  let triangles=0
  obj.traverse(o=>{if(o instanceof THREE.Mesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3
   const pos=o.geometry.attributes.position,p=new THREE.Vector3()
   for(let j=0;j<pos.count;j++){p.fromBufferAttribute(pos,j).applyMatrix4(o.matrixWorld);if(p.y<2.9)expect(p.z-b.width/2).toBeLessThan(.321)}
  }})
  expect(triangles).toBeLessThan(lod===0?2100:350)
  for(const x of [-.9,0,.9])for(const y of [.4,1.8,2.8]){
   const ray=new THREE.Raycaster(new THREE.Vector3(x,y,b.width/2+3),new THREE.Vector3(0,0,-1))
   expect(ray.intersectObject(obj,true).length).toBe(0)
  }
 }
})
