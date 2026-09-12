import {expect,test} from 'bun:test'
import {planNeighborhoodRoute,NeighborhoodJourney,pavementExit,canParkAt,surfaceDistance} from './neighborhoodRoute'
import {planCity, getCityGroundHeight, resolveCitySurfaceCollision, type CityPlan} from '../objects/cityLayout'
import {CROSSWALK_LENGTH_METERS, CROSSWALK_SETBACK_METERS} from '../objects/intersectionSignals'
import {planPublicPark} from '../objects/publicPark'
import {centralPlazaArrival} from '../objects/civicArrival'
import {planPublicUnderpass,underpassGroundAndRail,UNDERPASS_HEIGHT} from '../objects/publicUnderpass'
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

test('walking detours to real zebra stripes on both axes and across the cylinder seam',()=>{
 for(const swap of [false,true])for(const shift of [0,.37,1.29])for(const origin of [0,Math.PI]) {
  const pt=(x:number,y:number)=>({azimuth:origin+(swap?y+shift:x)/r,axial:swap?x:y+shift})
  const street:CityPlan={...empty,roads:[
   {...pt(0,0),tangentWidth:swap?800:19.5,axialLength:swap?19.5:800,kind:'arterial'},
   {...pt(0,160),tangentWidth:swap?6:100,axialLength:swap?100:6,kind:'local'}],
   intersections:[{...pt(0,160),avenueWidth:swap?6:19.5,streetWidth:swap?19.5:6,avenueKind:swap?'local':'arterial',streetKind:swap?'arterial':'local'}]}
  const start=pt(-12,0),goal=pt(12,0),route=planNeighborhoodRoute(street,r,start,goal,false)!
  expect(route).not.toBeNull();expect(route.some(p=>p.crosswalk)).toBe(true)
  const xy=(p:{azimuth:number;axial:number})=>{
   const x=Math.atan2(Math.sin(p.azimuth-origin),Math.cos(p.azimuth-origin))*r,y=p.axial
   return swap?[y,x-shift]:[x,y-shift]
  }
  for(let i=1;i<route.length;i++) {
   const a=xy(route[i-1]),b=xy(route[i])
   for(let t=0;t<=1;t+=.025) {
    const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t
    if(Math.abs(x)<9.75) expect(Math.abs(Math.abs(y-160)-(3+CROSSWALK_SETBACK_METERS+CROSSWALK_LENGTH_METERS/2)))
      .toBeLessThanOrEqual(CROSSWALK_LENGTH_METERS/2-.29)
   }
  }
  // No silent fallback to an unmarked crossing when no painted crossing exists.
  expect(planNeighborhoodRoute({...street,intersections:[]},r,start,goal,false)).toBeNull()
  const driving=planNeighborhoodRoute(street,r,pt(-8,0),pt(8,0),true)!
  expect(driving).not.toBeNull();expect(driving.some(p=>p.crosswalk)).toBe(false)
 }
})

test('the generated central avenue uses its next junction, beyond the old 100 m search margin',()=>{
 const city=planCity({radius:r,length:40000,maxBuildings:4200}), start=point(-12,180),goal=point(12,180)
 const route=planNeighborhoodRoute(city,r,start,goal,false)!
 expect(route).not.toBeNull()
 expect(route.some(p=>p.crosswalk && p.axial>310)).toBe(true)
 expect(route.reduce((d,p,i)=>d+(i?surfaceDistance(route[i-1],p,r):0),0)).toBeGreaterThan(280)
})

test('a walking turn is not advanced while still two metres short of its crosswalk',()=>{
 const journey=new NeighborhoodJourney()
 journey.setRoute([point(-12,0),point(-12,10),{...point(12,10),crosswalk:true}],false,'Square')
 journey.update(point(-12,8),r,.1);expect(journey.index).toBe(1)
 journey.update(point(-12,9.5),r,.1);expect(journey.index).toBe(2)
})

test('the unmarked central square does not cut off directions to the public park',()=>{
 for(const maxBuildings of [2400,4200,9000]){
  const city=planCity({radius:r,length:40000,maxBuildings}),park=planPublicPark(city,r)!,arrival=centralPlazaArrival(r)
  const square={azimuth:arrival.azimuth,axial:arrival.axialPosition}
  const entrance={azimuth:park.azimuth+park.entrance.x/r,axial:park.axial+park.entrance.y}
  for(const [start,goal] of [[square,entrance],[entrance,square]]){
   const route=planNeighborhoodRoute(city,r,start,goal,false,park)
   expect(route).not.toBeNull();expect(route!.some(p=>p.crosswalk)).toBe(true)
  }
 }
})

test('walking uses the real covered link in both directions without grazing its rail or sitting pockets',()=>{
 for(const maxBuildings of [64000,18000,16000]){
  const city=planCity({radius:r,length:40000,maxBuildings}),link=planPublicUnderpass(city,r)!,colliders=underpassGroundAndRail(link,r)
  const length=(route:ReturnType<typeof planNeighborhoodRoute>)=>route!.reduce((d,p,i)=>d+(i?surfaceDistance(route![i-1],p,r):0),0)
  for(const phase of [0,.37,.97])for(const sign of [-1,1]){
   const at=(x:number,y:number)=>({azimuth:link.azimuth+x/r,axial:link.axial+y,groundHeight:UNDERPASS_HEIGHT})
   const start=at(sign*(link.length/2-1),8+phase),goal=at(-sign*(link.length/2-1),8+phase)
   const before=planNeighborhoodRoute(city,r,start,goal,false),route=planNeighborhoodRoute(city,r,start,goal,false,null,link)!
   expect(route).not.toBeNull();expect(route.some(p=>p.coveredWalk)).toBe(true)
   expect(length(route)).toBeLessThan(length(before))
   for(let i=1;i<route.length;i++){
    if(!route[i-1].coveredWalk&&!route[i].coveredWalk)continue
    const a=route[i-1],b=route[i],steps=Math.ceil(surfaceDistance(a,b,r)/.5)
    for(let j=0;j<=steps;j++){
     const t=j/steps,azimuth=a.azimuth+(b.azimuth-a.azimuth)*t,axialPosition=a.axial+(b.axial-a.axial)*t
     if(Math.abs((azimuth-link.azimuth)*r)>link.length/2-5)continue
     expect(Math.abs(axialPosition-link.axial)).toBeLessThanOrEqual((link.width-.7)/2)
     expect(getCityGroundHeight(colliders,r,azimuth,axialPosition,UNDERPASS_HEIGHT)).toBeCloseTo(UNDERPASS_HEIGHT)
     expect(resolveCitySurfaceCollision({azimuth,axialPosition},colliders,r,.4,UNDERPASS_HEIGHT)).toBe(false)
    }
   }
   expect(planNeighborhoodRoute(city,r,start,goal,true,null,link)).toEqual(planNeighborhoodRoute(city,r,start,goal,true))
  }
 }
})

test('covered route endpoints cannot snap across a rail or down from the motorway',()=>{
 const city=planCity({radius:r,length:40000,maxBuildings:4200}),link=planPublicUnderpass(city,r)!
 const start={azimuth:link.azimuth,axial:link.axial,groundHeight:UNDERPASS_HEIGHT}
 const goal={azimuth:link.azimuth+(link.length/2-1)/r,axial:link.axial+8}
 expect(planNeighborhoodRoute(city,r,start,goal,false)).toBeNull()
 expect(planNeighborhoodRoute(city,r,start,goal,false,null,link)?.some(p=>p.coveredWalk)).toBe(true)
 expect(planNeighborhoodRoute(city,r,{...start,axial:start.axial+2},goal,false,null,link)).toBeNull()
 expect(planNeighborhoodRoute(city,r,{...start,groundHeight:city.expressway!.deckHeight},goal,false,null,link)).toBeNull()
 const journey=new NeighborhoodJourney()
 journey.setRoute([point(0,0),point(0,10),{...point(20,10),coveredWalk:true}],false,'Square')
 journey.update(point(0,8),r,.1);expect(journey.index).toBe(1)
 journey.update(point(0,9.5),r,.1);expect(journey.index).toBe(2)
})
