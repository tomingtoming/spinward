import {expect,test} from 'bun:test'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import {createBuildingInterior} from './buildingInteriors'
import type {CityBuilding} from './cityLayout'
import {roomPresence,roomDressingOpacity} from './roomExperience'
import {computeAmbienceMix} from '../app/ambienceMix'

for(const contract of [cafe,lobby]) {
 const i=createBuildingInterior(contract.interior.building as CityBuilding,contract===cafe?'cafe':'passage'),b=i.building,front=b.front!,radius=3200
 const at=(x:number,z:number,y=1)=>{
  const az=b.azimuth+(front.axis==='tangent'?front.side*z:-front.side*x)/radius
  const ax=b.axial+(front.axis==='tangent'?front.side*x:front.side*z)
  return {presence:roomPresence(i,radius,az,ax,y),opacity:roomDressingOpacity(i,radius,az,ax,y)}
 }
 test(`${i.kind} room tone is bounded by walls, floor, ceiling, and real portals`,()=>{
  expect(at(0,0).presence).toBe(1)
  expect(at(i.frontage/2+1,0).presence).toBe(0)
  expect(at(0,0,b.height+1).presence).toBe(0)
  expect(at(0,0,-1).presence).toBe(0)
  expect(at(0,i.depth/2+2).presence).toBe(0)
  expect(at(0,i.depth/2+.3).presence).toBeGreaterThan(0)
  expect(at(3,i.depth/2+.3).presence).toBe(0)
  expect(at(0,-i.depth/2-.3).presence>0).toBe(i.kind==='passage')
  let previous=0
  for(let z=i.depth/2+1;z>i.depth/2-1.5;z-=.1){const level=at(0,z).presence;expect(level).toBeGreaterThanOrEqual(previous-1e-9);previous=level}
  expect(roomPresence(i,radius,b.azimuth+2*Math.PI,b.axial,1)).toBeCloseTo(1)
 })
 test(`${i.kind} room dressing fades independently of the exterior and stays off rooftops`,()=>{
  expect(at(0,0).opacity).toBe(1)
  expect(at(0,i.depth/2+17).opacity).toBeGreaterThan(0)
  expect(at(0,i.depth/2+17).opacity).toBeLessThan(1)
  expect(at(0,i.depth/2+23).opacity).toBe(0)
  expect(at(0,0,b.height).opacity).toBe(0)
 })
}

test('room shelter quiets city and wind while retaining the vacuum override',()=>{
 const input={radialFraction:1,inAir:true,airspeed:35,daylight:1}
 const street=computeAmbienceMix(input),room=computeAmbienceMix({...input,shelter:1})
 expect(room.city).toBeCloseTo(street.city*.22)
 expect(room.wind).toBeCloseTo(street.wind*.15)
 expect(computeAmbienceMix({...input,shelter:1,inAir:false})).toEqual({city:0,wind:0,vacuum:1})
})

test('Blender dressing is bounded to rooms and leaves the existing door paths clear',async()=>{
 const bytes=readFileSync(new URL('../../public/assets/buildings/room-dressing.glb',import.meta.url))
 expect(bytes.byteLength).toBeLessThan(450_000)
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 gltf.scene.updateMatrixWorld(true)
 for(const [name,contract,budget] of [['cafe',cafe,4600],['lobby',lobby,2300]] as const) {
  const model=gltf.scene.getObjectByName(`${name}_room_dressing`)!
  expect(model).toBeDefined()
  const box=new THREE.Box3().setFromObject(model),room=contract.interior
  expect(box.min.y).toBeGreaterThan(.249);expect(box.max.y).toBeLessThan(3.5)
  expect(box.min.x).toBeGreaterThan(-room.frontage/2+.3);expect(box.max.x).toBeLessThan(room.frontage/2-.3)
  expect(box.min.z).toBeGreaterThan(-room.depth/2+.29);expect(box.max.z).toBeLessThan(room.depth/2+.021)
  let triangles=0;model.traverse(o=>{if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
  expect(triangles).toBeLessThanOrEqual(budget)
  for(const x of [-1.5,0,1.5])for(const y of [.3,1.6,3.0]){
   const ray=new THREE.Raycaster(new THREE.Vector3(x,y,room.depth/2+1),new THREE.Vector3(0,0,-1))
   expect(ray.intersectObject(model,true)[0]?.distance??Infinity).toBeGreaterThan(name==='cafe'?5:room.depth+2)
  }
 }
})
