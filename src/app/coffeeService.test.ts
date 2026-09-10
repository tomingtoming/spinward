import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import { createBuildingInterior } from '../objects/buildingInteriors'
import type { CityBuilding } from '../objects/cityLayout'
import { createPlayerTraversalState } from './playerTraversal'
import { cafePilotPoint } from '../objects/cafePilot'
import { coffeeLiquidPose } from '../objects/coffeeServiceView'
import { CoffeeService, COFFEE_SERVICE as spec, nearCoffeeCounter, planCoffeeStation } from './coffeeService'
const interior=createBuildingInterior(cafe.interior.building as CityBuilding,'cafe'),radius=3200
function setup(){
 const station=planCoffeeStation([interior],radius)!
 const player=createPlayerTraversalState(station,radius,0,.03)
 return {service:new CoffeeService(),context:{station,player,radius,blocked:false}}
}
function place(context:ReturnType<typeof setup>['context'],x:number,z:number){
 const p=cafePilotPoint(interior,radius,new THREE.Vector3(x,0,z))
 context.player.surface={azimuth:Math.atan2(p.z,p.x),axialPosition:p.y}
}

test('coffee counter binds only the exact cafe and its accessible customer side',()=>{
 const {context}=setup();expect(nearCoffeeCounter(context)).toBe(true)
 expect(planCoffeeStation([interior],1600)).toBeNull()
 expect(planCoffeeStation([createBuildingInterior(lobby.interior.building as CityBuilding,'passage')],radius)).toBeNull()
 expect(planCoffeeStation([{...interior,building:{...interior.building,axial:interior.building.axial+1}}],radius)).toBeNull()
 context.player.surface.azimuth+=Math.PI*2;expect(nearCoffeeCounter(context)).toBe(true)
 const x=spec.counterX,z=-interior.depth/2+spec.approachFromBack
 for(const part of interior.parts.filter(p=>p.solid&&p.y-p.height/2<1.8))
  expect(Math.abs(x-part.x)>part.width/2+.36||Math.abs(z-part.z)>part.depth/2+.36).toBe(true)
 place(context,x,-interior.depth/2+.8);expect(nearCoffeeCounter(context)).toBe(false)
 place(context,x,z);context.player.groundHeight=46.9;expect(nearCoffeeCounter(context)).toBe(false)
 context.player.groundHeight=0;context.player.mode='free-fly';expect(nearCoffeeCounter(context)).toBe(false)
})

test('coffee takes time to brew, has three completed sips, and returns for another cycle',()=>{
 const {service,context}=setup()
 expect(service.activate(context)).toBe(true);expect(service.phase).toBe('brewing')
 expect(service.activate(context)).toBe(false)
 service.update(spec.brewSeconds-.01,context);expect(service.phase).toBe('brewing')
 service.update(.02,context);expect(service.phase).toBe('ready')
 expect(service.activate(context)).toBe(true);expect(service.phase).toBe('holding')
 place(context,8.5,-.1)
 for(let left=3;left>0;left--){
  expect(service.activate(context)).toBe(true);expect(service.activate(context)).toBe(false)
  service.update(spec.sipSeconds/2,context);expect(service.servings).toBe(left)
  service.update(spec.sipSeconds/2+.001,context);expect(service.servings).toBe(left-1)
 }
 expect(service.prompt(context)?.enabled).toBe(false);expect(service.activate(context)).toBe(false)
 place(context,spec.counterX,-interior.depth/2+spec.approachFromBack)
 expect(service.prompt(context)?.label).toBe('Return cup');expect(service.activate(context)).toBe(true)
 expect(service.phase).toBe('idle');expect(service.activate(context)).toBe(true)
})

test('leaving during brewing cancels; rebuild, driving/XR, and explicit respawn reset service',()=>{
 const {service,context}=setup()
 service.activate(context);service.update(2,context);place(context,0,0);service.update(2,context)
 expect(service.phase).toBe('idle')
 place(context,spec.counterX,-interior.depth/2+spec.approachFromBack)
 for(const mode of ['blocked','rebuild','respawn']){
  service.activate(context);service.update(3,context);service.activate(context);expect(service.phase).toBe('holding')
  if(mode==='blocked'){context.blocked=true;service.update(.1,context);context.blocked=false}
  if(mode==='rebuild'){context.station=planCoffeeStation([interior],radius)!;service.update(.1,context)}
  if(mode==='respawn')service.reset()
  expect(service.phase).toBe('idle');expect(service.servings).toBe(0)
 }
})

test('coffee asset fits a real counter and keeps the walking approach and mug interior clear',async()=>{
 const bytes=readFileSync(new URL('../../public/assets/buildings/coffee-service.glb',import.meta.url))
 expect(bytes.length).toBeLessThan(150_000)
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');gltf.scene.updateMatrixWorld(true)
 const mug=gltf.scene.getObjectByName('coffee_mug')!,liquid=gltf.scene.getObjectByName('coffee_liquid')!,sign=gltf.scene.getObjectByName('coffee_station_sign')!
 expect(mug).toBeDefined();expect(liquid).toBeDefined();expect(sign).toBeDefined()
 const bounds=new THREE.Box3().setFromObject(mug)
 expect(bounds.max.y-bounds.min.y).toBeCloseTo(.11,3);expect(bounds.max.x-bounds.min.x).toBeLessThan(.16)
 const ray=new THREE.Raycaster(new THREE.Vector3(0,.14,0),new THREE.Vector3(0,-1,0))
 expect(ray.intersectObject(mug,true)[0].point.y).toBeCloseTo(.013,3)
 expect(ray.intersectObject(liquid,true)[0].point.y).toBeCloseTo(.093,3)
 // Handle never cuts through the visible coffee surface, including lower fills.
 for(const fraction of [0,.1,.5,1/3,2/3,1])for(let j=0;j<16;j++){
  const pose=coffeeLiquidPose(fraction),a=j*Math.PI/8,r=.039*pose.scale,y=pose.height
  const probe=new THREE.Raycaster(new THREE.Vector3(Math.cos(a)*r,.14,Math.sin(a)*r),new THREE.Vector3(0,-1,0),0,.14-y)
  expect(probe.intersectObject(mug,true).length).toBe(0)
 }
 const sceneBounds=new THREE.Box3().setFromObject(gltf.scene)
 expect(sceneBounds.min.y).toBeGreaterThan(-.01)
 // Every station primitive stays on the original 1m-deep counter top.
 expect(sceneBounds.min.z+spec.cupFromBack).toBeGreaterThan(.75)
 expect(sceneBounds.max.z+spec.cupFromBack).toBeLessThan(1.75)
 expect(spec.approachFromBack-(sceneBounds.max.z+spec.cupFromBack)).toBeGreaterThan(.36)
 let triangles=0;gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
 expect(triangles).toBeLessThan(1700)
})
