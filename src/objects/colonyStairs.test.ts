import {test,expect} from 'bun:test'
import * as THREE from 'three'
import {planCity,resolveCitySurfaceCollision,type CityBuilding,type CityRoad} from './cityLayout'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyStairCollider,colonyStairParts,planColonyStairs,stairSiteRect,type StairPart} from './colonyStairs'
import {planBuildingInteriors} from './buildingInteriors'
import {cityBlockSpec} from './authoredCityBlockPlan'

function fixture(radius:number,axis:'axial'|'tangent',side:1|-1){
 const t=axis==='tangent'
 for(let i=0;i<256;i++){
  const b:CityBuilding={azimuth:Math.PI-.002,axial:i,width:t?16:20,depth:t?20:16,height:16,kind:'block',tone:.5,front:{axis,side},streetKind:'local',parcel:{tangentOffset:t?-4*side:0,axialOffset:t?0:-4*side,tangentExtent:t?28:30,axialExtent:t?30:28}}
  const entrance=stairSiteRect(b,radius,0,8,0,0),edge=stairSiteRect(b,radius,0,10,0,0)
  b.access={entrance,roadEdge:edge,roadId:'road-0',roadIndex:0,width:2,length:2}
  const road:CityRoad={...stairSiteRect(b,radius,0,13,100,6),kind:'local'}
  const design=colonyBuildingDesign(b);design.use.primary='apartments';design.use.groundHeight=0
  const source={spec:colonyBuildingSpec(b),design,interior:false},sources=[source]
  const plan=planColonyStairs(sources,[b],[road],radius),stair=plan.get(b)
  if(stair?.kind==='external')return {b,source,sources,road,stair}
 }
 throw Error('No stair fixture')
}
const point=(part:StairPart,x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(part.x,part.y,part.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),part.yaw??0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),part.tilt??0)),new THREE.Vector3(part.w,part.h,part.d)))

test('rear stairs meet landings and floor doors with metric rails in all four street orientations',()=>{
 for(const radius of [800,3200])for(const axis of ['axial','tangent'] as const)for(const side of [-1,1] as const){
  const {b,stair}=fixture(radius,axis,side),parts=colonyStairParts(stair),flights=parts.filter(p=>p.kind==='flight'),cx=stair.x-2.45,cz=stair.z-1.36
  expect(flights.length).toBe((stair.levels.length-1)*2)
  const columns=parts.filter(p=>p.w===.095&&p.d===.095)
  expect(columns).toHaveLength(4)
  for(const p of columns){
   const top=(p.x>cx?stair.levels.at(-1)!:(stair.levels.at(-1)!+stair.levels.at(-2)!)/2)+1.05
   expect(p.y+p.h/2).toBeCloseTo(top,8)
  }
  for(let i=1;i<stair.levels.length;i++){
   const lo=stair.levels[i-1],hi=stair.levels[i],mid=(lo+hi)/2
   const first=flights[(i-1)*2],second=flights[(i-1)*2+1],a=point(first,.5,1,0),b=point(second,.5,1,0)
   expect(a.x).toBeCloseTo(cx-1.7,8);expect(a.y).toBeCloseTo(mid,8);expect(a.z).toBeCloseTo(cz+.7,8)
   expect(b.x).toBeCloseTo(cx+1.7,8);expect(b.y).toBeCloseTo(hi,8);expect(b.z).toBeCloseTo(cz-.7,8)
   expect(parts.some(p=>p.kind==='metal'&&Math.abs(p.x-(cx-2.45))<1e-8&&Math.abs(p.y+.065-mid)<1e-8&&p.w===1.5)).toBe(true)
   expect(parts.some(p=>p.kind==='metal'&&Math.abs(p.x-stair.x)<1e-8&&Math.abs(p.y+.065-hi)<1e-8&&p.w===1.5)).toBe(true)
   expect(parts.some(p=>p.kind==='door'&&p.x===stair.x&&p.y===hi+1.05)).toBe(true)
   for(const p of parts.filter(p=>p.tilt&&p.h===.06&&p.y>lo+1&&p.y<hi+1.1))expect(Math.abs(p.tilt!)).toBeLessThan(.6)
   expect(first.h/12).toBeLessThan(.19)
  }
  const collider=colonyStairCollider(b,stair,radius),inside={azimuth:collider.azimuth,axialPosition:collider.axial}
  expect(resolveCitySurfaceCollision(inside,[collider],radius)).toBe(true)
  const sidePath=stairSiteRect(b,radius,10.75,0,0,0),walk={azimuth:sidePath.azimuth,axialPosition:sidePath.axial}
  expect(resolveCitySurfaceCollision(walk,[collider],radius)).toBe(false)
 }
})

test('external stairs yield to a narrow parcel, foreign lot, road or certified approach',()=>{
 const r=3200,{b,sources,source,road,stair}=fixture(r,'axial',1)
 const base=planColonyStairs(sources,[b],[road],r)
 expect(base.get(b)).toEqual(stair)
 const old=b.parcel!;b.parcel={...old,tangentExtent:b.width+.2}
 expect(planColonyStairs(sources,[b],[road],r).get(b)?.kind).toBe('enclosed');b.parcel=old
 const at=stairSiteRect(b,r,stair.x-2.45,stair.z-1.36,2,2)
 const other:CityBuilding={...b,azimuth:at.azimuth,axial:at.axial,width:2,depth:2}
 expect(planColonyStairs(sources,[b,other],[road],r).get(b)?.kind).toBe('enclosed')
 expect(planColonyStairs(sources,[b],[road,{...at,kind:'alley'}],r).get(b)?.kind).toBe('enclosed')
 const remote={...other,axial:other.axial+100,access:{...b.access!,entrance:{azimuth:at.azimuth,axial:at.axial-1},roadEdge:{azimuth:at.azimuth,axial:at.axial+1},length:2}}
 expect(planColonyStairs(sources,[b,remote],[road],r).get(b)?.kind).toBe('enclosed')
 expect(planColonyStairs([{...source,interior:true}],[b],[road],r).size).toBe(0)
})

test('generated stair assemblies stay within lots, avoid roads, and fit complete rendering budgets',()=>{
 let external=0,enclosed=0
 for(const radius of [250,3200]){
  const city=planCity({radius,length:radius===3200?40000:2000,maxBuildings:64000}),interiors=planBuildingInteriors(city.buildings,radius)
  const sources=city.buildings.filter(b=>!cityBlockSpec(b,radius)).map(b=>({spec:colonyBuildingSpec(b,interiors.get(b)),design:colonyBuildingDesign(b,interiors.get(b)?.kind),interior:interiors.has(b)}))
  const plans=planColonyStairs(sources,city.buildings,city.roads,radius)
  for(const [b,s] of plans){
   const parts=colonyStairParts(s)
   expect(parts.every(p=>p.w>0&&p.h>0&&p.d>0&&Number.isFinite(p.x+p.y+p.z))).toBe(true)
   if(s.kind==='enclosed'){enclosed++;expect(parts.length).toBeLessThanOrEqual(320);continue}
   external++;expect(radius).toBeGreaterThanOrEqual(800)
   expect(parts.filter(p=>p.kind==='flight').length).toBeLessThanOrEqual(24)
   expect(parts.filter(p=>p.kind!=='flight').length).toBeLessThanOrEqual(384)
   const rect=colonyStairCollider(b,s,radius),parcel=b.parcel!
   const dt=Math.atan2(Math.sin(rect.azimuth-b.azimuth),Math.cos(rect.azimuth-b.azimuth))*radius
   expect(Math.abs(dt-parcel.tangentOffset)+rect.width/2).toBeLessThan(parcel.tangentExtent/2)
   expect(Math.abs(rect.axial-b.axial-parcel.axialOffset)+rect.depth/2).toBeLessThan(parcel.axialExtent/2)
   expect(city.roads.some(road=>Math.abs(Math.atan2(Math.sin(rect.azimuth-road.azimuth),Math.cos(rect.azimuth-road.azimuth)))*radius<(rect.width+road.tangentWidth)/2&&Math.abs(rect.axial-road.axial)<(rect.depth+road.axialLength)/2)).toBe(false)
   for(let i=1;i<s.levels.length;i++)expect((s.levels[i]-s.levels[i-1])/24).toBeLessThan(.19)
  }
 }
 expect(external).toBeGreaterThan(20);expect(enclosed).toBeGreaterThan(external)
})
