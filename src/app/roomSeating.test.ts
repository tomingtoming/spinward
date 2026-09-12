import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import { createBuildingInterior } from '../objects/buildingInteriors'
import type { CityBuilding } from '../objects/cityLayout'
import { planRoomSeats, nearestRoomSeat, RoomSeating } from './roomSeating'
import { createPlayerTraversalState, resetPlayerToGrounded, disposePlayerTraversalState } from './playerTraversal'
import { initRapier } from '../physics/rapierContext'
import { inertialPositionToRotating, inertialVelocityToRotating } from '../sim/frameTransforms'

const interiors=[cafe,lobby].map((c,i)=>createBuildingInterior(c.interior.building as CityBuilding,i===0?'cafe':'passage'))
const radius=3200,frame={radius,frameAngle:1,omega:.03}
const seats=planRoomSeats(interiors,radius)

test('seat approach and exit anchors stay outside all original solids and optional room props',async()=>{
 expect(seats.length).toBe(4)
 expect(planRoomSeats(interiors,1600)).toEqual([])
 const bytes=readFileSync(new URL('../../public/assets/buildings/room-dressing.glb',import.meta.url))
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 gltf.scene.updateMatrixWorld(true)
 for(const seat of seats){
  const i=interiors[seat.id.startsWith('cafe')?0:1],b=i.building,f=b.front!
  const local=(p:{azimuth:number;axialPosition:number})=>{
   const t=Math.atan2(Math.sin(p.azimuth-b.azimuth),Math.cos(p.azimuth-b.azimuth))*radius,a=p.axialPosition-b.axial
   return {x:f.axis==='tangent'?f.side*a:-f.side*t,z:f.axis==='tangent'?f.side*t:f.side*a}
  }
  const exit=local(seat.exit),anchor=local(seat)
  // Walking sphere plus margin is outside every solid footprint at floor level.
  for(const p of i.parts.filter(p=>p.solid&&p.y-p.height/2<1.8)){
   expect(Math.abs(exit.x-p.x)>p.width/2+.36||Math.abs(exit.z-p.z)>p.depth/2+.36).toBe(true)
  }
  // A real bench supports the anchor; it isn't an arbitrary camera waypoint.
  expect(i.parts.some(p=>p.solid&&Math.abs(p.y+p.height/2-.6)<1e-6&&Math.abs(anchor.x-p.x)<p.width/2&&Math.abs(anchor.z-p.z)<p.depth/2)).toBe(true)
  const model=gltf.scene.getObjectByName(seat.id.startsWith('cafe')?'cafe_room_dressing':'lobby_room_dressing')!
  // Above the cushion the seated torso/head space remains clear of plants/books.
  for(const dx of [-.15,0,.15])for(const dz of [-.15,0,.15]){
   const ray=new THREE.Raycaster(new THREE.Vector3(anchor.x+dx,.70,anchor.z+dz),new THREE.Vector3(0,1,0),0,.9)
   expect(ray.intersectObject(model,true).length).toBe(0)
  }
 }
})

test('seating follows the rotating frame, then re-enables physical walking in the clear aisle',async()=>{
 const rapier=await initRapier(),world=new rapier.World({x:0,y:0,z:0})
 const state=createPlayerTraversalState(seats[0].exit,radius,frame.frameAngle,frame.omega,{rapier,world})
 const seating=new RoomSeating()
 try{
  expect(nearestRoomSeat(seats,state,radius)).toBe(seats[0])
  expect(seating.enter(seats[0],state,frame)).toBe(true)
  expect(state.physics!.freeFlyBody.collider(0).isSensor()).toBe(true)
  for(const frameAngle of [1.1,2.5,5.9,.01]){
   seating.update(state,{...frame,frameAngle},seats);world.step()
   const pos=inertialPositionToRotating(state.inertialPosition,frameAngle,new THREE.Vector3())
   expect(Math.atan2(pos.z,pos.x)).toBeCloseTo(seats[0].azimuth,8)
   expect(pos.y).toBeCloseTo(seats[0].axialPosition,8)
  }
  expect(seating.leave(state,{...frame,frameAngle:.01})).toBe(true)
  expect(state.physics!.freeFlyBody.isEnabled()).toBe(true)
  expect(state.physics!.freeFlyBody.collider(0).isSensor()).toBe(false)
  expect(state.surface).toEqual(seats[0].exit)
  const velocity=inertialVelocityToRotating(state.inertialPosition,state.inertialVelocity,frame.omega,.01,new THREE.Vector3())
  expect(velocity.length()).toBeLessThan(.02)
  expect(seating.enter(seats[0],state,frame)).toBe(true)
  seating.update(state,frame,[])
  expect(seating.seat).toBeNull()
  expect(state.physics!.freeFlyBody.isEnabled()).toBe(true)
  expect(state.physics!.freeFlyBody.collider(0).isSensor()).toBe(false)
  expect(state.surface).toEqual(seats[0].exit)
 }finally{disposePlayerTraversalState(state);world.free()}
})

test('seat requests reject flying, rooftops and remote points; respawn cancels the old attachment',()=>{
 const state=createPlayerTraversalState(seats[0].exit,radius,1,.03),seating=new RoomSeating()
 state.groundHeight=10;expect(nearestRoomSeat(seats,state,radius)).toBeNull()
 state.groundHeight=0;state.mode='free-fly';expect(seating.enter(seats[0],state,frame)).toBe(false)
 state.mode='grounded';state.surface.axialPosition+=20;expect(seating.enter(seats[0],state,frame)).toBe(false)
 resetPlayerToGrounded(state,{...seats[0].exit,...frame});expect(seating.enter(seats[0],state,frame)).toBe(true)
 resetPlayerToGrounded(state,{azimuth:0,axialPosition:0,...frame});seating.update(state,frame,seats)
 expect(seating.seat).toBeNull();expect(state.surface).toEqual({azimuth:0,axialPosition:0})
})

test('repeated sitting restores real floor contacts, not just the enabled flag',async()=>{
 const rapier=await initRapier(),world=new rapier.World({x:0,y:0,z:0})
 const seat={id:'contact',label:'Bench',radius,azimuth:.0001,axialPosition:0,exit:{azimuth:0,axialPosition:0}}
 const frame={radius,frameAngle:0,omega:0}
 world.createCollider(rapier.ColliderDesc.cuboid(.5,10,10).setTranslation(radius+.5,0,0))
 const state=createPlayerTraversalState(seat.exit,radius,0,0,{rapier,world}),seating=new RoomSeating()
 try{
  for(let cycle=0;cycle<3;cycle++){
   resetPlayerToGrounded(state,{...seat.exit,...frame})
   expect(seating.enter(seat,state,frame)).toBe(true)
   for(let j=0;j<20;j++){seating.update(state,frame,[seat]);world.step()}
   expect(seating.leave(state,frame)).toBe(true)
   state.physics!.freeFlyBody.setLinvel({x:2,y:0,z:0},true)
   for(let j=0;j<60;j++)world.step()
   expect(state.physics!.freeFlyBody.translation().x).toBeLessThan(radius-.25)
  }
 }finally{disposePlayerTraversalState(state);world.free()}
})

test('seat height drives the eye and remains available during standing recovery',()=>{
 const seat={...seats[0],seatHeight:.53}
 const state=createPlayerTraversalState(seat.exit,radius,1,.03),seating=new RoomSeating()
 expect(seating.enter(seat,state,frame)).toBe(true)
 expect(seating.eyeHeight).toBeCloseTo(1.23,6)
 seating.leave(state,frame)
 expect(seating.eyeHeight).toBeCloseTo(1.23,6)
 expect(seating.stepDeparture(.15)).toBe(true)
 expect(seating.standingProgress).toBeCloseTo(.5,6)
 expect(seating.stepDeparture(.2)).toBe(false)
})

test('a bench on raised paving preserves the support, eye level and exit across the rotating frame',()=>{
 const seat={...seats[0],groundHeight:.34,seatHeight:.87},seating=new RoomSeating()
 const state=createPlayerTraversalState(seat.exit,radius,1,.03)
 expect(nearestRoomSeat([seat],state,radius)).toBeNull()
 resetPlayerToGrounded(state,{...seat.exit,...frame,groundHeight:.34})
 expect(seating.enter(seat,state,frame)).toBe(true)
 expect(state.groundHeight).toBeCloseTo(.34)
 expect(state.groundHeight+seating.eyeHeight).toBeCloseTo(1.57)
 for(const angle of [1.1,2.5,5.9]){
  seating.update(state,{...frame,frameAngle:angle},[seat])
  expect(seating.seat).toBe(seat)
  const point=inertialPositionToRotating(state.inertialPosition,angle,new THREE.Vector3())
  // Traversal stores the collision sphere centre, .4m above the foot anchor.
  expect(radius-Math.hypot(point.x,point.z)).toBeCloseTo(.34+.4)
 }
 expect(seating.leave(state,frame)).toBe(true)
 expect(state.groundHeight).toBeCloseTo(.34)
 expect(state.surface).toEqual(seat.exit)
 state.groundHeight=18
 expect(nearestRoomSeat([seat],state,radius)).toBeNull()
})
