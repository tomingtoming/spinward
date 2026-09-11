import {expect,test} from 'bun:test'
import {planCity,type CityBuilding} from './cityLayout'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {buildingRoofAttachment} from './buildingRoofAttachment'
import {colonyRoofSurface,colonyRoofUnits,colonyRoofLod,ROOF_UNIT_LIMIT} from './colonyRoofs'

test('roof services sit on their actual deck, with clear edges, beacon and maintenance spacing',()=>{
 let count=0;const kinds=new Set(),uses=new Set()
 for(const radius of [250,3200]){
  const city=planCity({radius,length:radius===3200?40000:2000,maxBuildings:16000})
  for(const b of city.buildings){
   const spec=colonyBuildingSpec(b),roof=colonyRoofSurface(spec),units=colonyRoofUnits(spec,colonyBuildingDesign(b))
   expect(units.length).toBeLessThanOrEqual(ROOF_UNIT_LIMIT)
   if(!roof){expect(units.length).toBe(0);continue}
   const anchor=buildingRoofAttachment(spec,radius)
   expect(anchor.local).toEqual({x:roof.x,y:roof.y+roof.h/2,z:roof.z})
   for(const u of units){
    count++;kinds.add(u.kind);uses.add(colonyBuildingDesign(b).use.primary)
    const w=u.yaw?u.d:u.w,d=u.yaw?u.w:u.d
    expect(u.y).toBe(anchor.local.y)
    expect(Math.abs(u.x-roof.x)+w/2).toBeLessThanOrEqual(roof.w/2-1+1e-6)
    expect(Math.abs(u.z-roof.z)+d/2).toBeLessThanOrEqual(roof.d/2-1+1e-6)
    expect(Math.abs(u.x-roof.x)>=w/2+1.1||Math.abs(u.z-roof.z)>=d/2+1.1).toBe(true)
    expect(u.h).toBeLessThan(1.8)
    for(const other of units){if(other===u)continue
     const ow=other.yaw?other.d:other.w,od=other.yaw?other.w:other.d
     expect(Math.abs(u.x-other.x)>=(w+ow)/2+.8||Math.abs(u.z-other.z)>=(d+od)/2+.8).toBe(true)
    }
   }
  }
 }
 expect(count).toBeGreaterThan(500)
 expect(kinds.size).toBe(2);expect(uses.size).toBe(4)
})

test('equipment varies by use while public rooms and small roofs keep their own silhouette',()=>{
 const b:CityBuilding={azimuth:.1,axial:20,width:36,depth:28,height:32,tone:.5,kind:'block',front:{axis:'axial',side:1}}
 for(const axis of ['axial','tangent'] as const)for(const side of [-1,1] as const){
  const source={...b,front:{axis,side}},spec=colonyBuildingSpec(source),design=colonyBuildingDesign(source)
  design.use.primary='apartments';const apartments=colonyRoofUnits(spec,design)
  expect(apartments.length).toBeGreaterThan(0);expect(apartments.length).toBeLessThanOrEqual(2)
  design.use.primary='office';const office=colonyRoofUnits(spec,design)
  expect(office.length).toBeGreaterThan(apartments.length)
  design.use.primary='industrial';expect(colonyRoofUnits(spec,design).some(u=>u.kind==='roof_vent')).toBe(true)
  expect(colonyRoofUnits({...spec,id:'public-apartment'},design)).toEqual([])
  expect(colonyRoofUnits({...spec,volumes:[{x:0,y:4,z:0,w:4,h:8,d:4}]},design)).toEqual([])
  expect(colonyRoofUnits({...spec},design)).toEqual(colonyRoofUnits(spec,design))
 }
})

test('roof detail transitions have hysteresis for both mesh and distance boundaries',()=>{
 let lod:0|1|2=2
 for(const [distance,expected] of [[270,2],[241,2],[239,1],[75,1],[69,0],[80,0],[85,1],[245,1],[261,2]]){
  lod=colonyRoofLod(distance,lod);expect(lod).toBe(expected)
 }
})
