import {expect,test} from 'bun:test'
import {planNeighborhoodRoute,NeighborhoodJourney,pavementExit,canParkAt,surfaceDistance} from './neighborhoodRoute'
import type {CityPlan} from '../objects/cityLayout'
const r=3200
const point=(x:number,y:number)=>({azimuth:x/r,axial:y})
const empty:CityPlan={roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null}
const block={...point(0,0),width:16,depth:16,height:30,tone:0,kind:'block' as const}
const plan:CityPlan={...empty,buildings:[block],roads:[
  {...point(-20,0),tangentWidth:8,axialLength:60,kind:'local'},
  {...point(20,0),tangentWidth:8,axialLength:60,kind:'local'},
  {...point(0,20),tangentWidth:48,axialLength:8,kind:'local'}]}
test('routes go around a block, with clear segments instead of a straight line through it',()=>{
 for(const driving of [false,true]){
  const route=planNeighborhoodRoute(plan,r,point(-20,0),point(20,0),driving)!
  expect(route).not.toBeNull()
  for(let i=1;i<route.length;i++)for(let t=0;t<=1;t+=.05){
   const x=(route[i-1].azimuth*(1-t)+route[i].azimuth*t)*r,y=route[i-1].axial*(1-t)+route[i].axial*t
   expect(Math.abs(x)>8||Math.abs(y)>8).toBe(true)
  }
  expect(route.reduce((n,p,i)=>n+(i?surfaceDistance(route[i-1],p,r):0),0)).toBeGreaterThan(60)
 }
 expect(planNeighborhoodRoute({...plan,roads:plan.roads.slice(0,2)},r,point(-20,0),point(20,0),true)).toBeNull()
 expect(planNeighborhoodRoute(plan,r,point(0,0),point(2000,0),true)).toBeNull()
})
test('the local route crosses the azimuth seam and never invents an absent road',()=>{
 const seam={...empty,roads:[{azimuth:Math.PI,axial:0,tangentWidth:80,axialLength:8,kind:'local' as const}]}
 expect(planNeighborhoodRoute(seam,r,{azimuth:Math.PI-20/r,axial:0},{azimuth:-Math.PI+20/r,axial:0},true)).not.toBeNull()
 expect(planNeighborhoodRoute(empty,r,point(0,0),point(20,0),true)).toBeNull()
})
test('a stopped kerbside car exits to the pavement; a central carriageway or blocked pavement refuses',()=>{
 const street={...empty,roads:[{...point(0,0),tangentWidth:19.5,axialLength:100,kind:'arterial' as const}]}
 for(const heading of [0,Math.PI]){
  const exit=pavementExit(street,r,point(8.4,25),heading)!
  expect(exit.azimuth*r).toBeGreaterThan(10)
  expect(exit.axial).toBe(25)
 }
 expect(pavementExit(street,r,point(0,25),0)).toBeNull()
 expect(pavementExit({...street,buildings:[{...block,...point(13,25),width:4,depth:6}]},r,point(8.4,25),0)).toBeNull()
})
test('parking assistance only aligns a stopped, nearby, parallel vehicle',()=>{
 const bay={...point(8.4,25),heading:0,signSide:-1}
 expect(canParkAt(point(8.5,24),Math.PI,.2,.2,bay,r)).toBe(true)
 expect(canParkAt(point(8.5,24),0,3,.2,bay,r)).toBe(false)
 expect(canParkAt(point(8.5,24),Math.PI/2,0,.2,bay,r)).toBe(false)
 expect(canParkAt(point(8.5,30),0,0,.2,bay,r)).toBe(false)
 expect(canParkAt(point(8.5,24),0,0,10,bay,r)).toBe(false)
})
test('guidance advances at corners, arrives, detects departure, and clears on cancellation',()=>{
 const journey=new NeighborhoodJourney();journey.action='guide-square'
 journey.setRoute([point(0,0),point(0,10),point(10,10)],false,'Square')
 journey.update(point(0,0),r,.1);expect(journey.remaining).toBe(20)
 journey.update(point(0,10),r,.1);expect(journey.index).toBe(2)
 journey.update(point(10,10),r,.1);expect(journey.status).toBe('arrived')
 journey.setRoute([point(0,0),point(0,20)],true,'Square')
 journey.update(point(20,0),r,2);expect(journey.offRoute).toBe(2)
 journey.cancel();expect(journey.action).toBeNull();expect(journey.status).toBe('idle')
})


test('a local-street bay leaves clearance to a building with a two-metre frontage setback',()=>{
 const street:CityPlan={...empty,roads:[{...point(0,0),tangentWidth:100,axialLength:6,kind:'local'}],buildings:[{...block,...point(0,15),width:24,depth:20}]}
 const exit=pavementExit(street,r,point(0,.65),Math.PI/2)!
 expect(exit).not.toBeNull()
 expect(exit.axial).toBeGreaterThan(3.4)
 expect(exit.axial).toBeLessThan(4.3)
})
