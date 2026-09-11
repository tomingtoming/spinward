import {test,expect} from 'bun:test'
import fs from 'node:fs'
import {planCity} from './cityLayout'
import {colonyBuildingSpec,colonyWindowGrid,fitColonyHouse} from './colonyBuildingPlan'
import {cityBlockSpec,cityBlockCollision} from './authoredCityBlockPlan'
import {planBuildingInteriors,interiorCollisionBuildings} from './buildingInteriors'

test('every planned lot has a bounded replacement at all habitat sizes and quality budgets',()=>{
 for(const radius of [250,800,3200])for(const maxBuildings of [16000,64000]){
  const plan=planCity({radius,length:radius===3200?40000:radius*8,maxBuildings})
  expect(plan.buildings.length).toBeGreaterThan(0)
  for(const b of plan.buildings){
   const spec=cityBlockSpec(b,radius)??colonyBuildingSpec(b)
   expect(spec.volumes.length).toBeGreaterThan(0)
   const tangent=b.front?.axis==='tangent',side=b.front?.side??-1,parcel=fitColonyHouse(b)?b.parcel:undefined
   const width=parcel?(tangent?parcel.axialExtent:parcel.tangentExtent):(tangent?b.depth:b.width),depth=parcel?(tangent?parcel.tangentExtent:parcel.axialExtent):(tangent?b.width:b.depth)
   const cx=parcel?side*(tangent?parcel.axialOffset:-parcel.tangentOffset):0,cz=parcel?side*(tangent?parcel.tangentOffset:parcel.axialOffset):0
   for(const v of spec.volumes){
    expect(Math.abs(v.x-cx)+v.w/2).toBeLessThanOrEqual(width/2+1e-5)
    expect(Math.abs(v.z-cz)+v.d/2).toBeLessThanOrEqual(depth/2+1e-5)
    expect(v.y-v.h/2).toBeGreaterThanOrEqual(-1e-5)
    expect(v.y+v.h/2).toBeLessThanOrEqual(b.height+1e-5)
    const grid=colonyWindowGrid(v)
    expect(grid.floors).toBeGreaterThan(0)
    if(v.h>6)expect(v.h/grid.floors).toBeLessThan(4)
   }
  }
 }
})
test('public room structural recipe retains its existing collision openings',()=>{
 const plan=planCity({radius:3200,length:40000,maxBuildings:16000}),interiors=planBuildingInteriors(plan.buildings,3200)
 expect(interiors.size).toBeGreaterThan(0)
 for(const [b,i] of interiors){
  const actual=cityBlockCollision(b,colonyBuildingSpec(b,i),3200)
  const expected=interiorCollisionBuildings(i,3200).filter(p=>actual.some(a=>Math.abs(a.azimuth-p.azimuth)<1e-8&&Math.abs(a.axial-p.axial)<1e-5))
  expect(actual.length).toBeGreaterThan(0)
  for(const a of actual)expect(expected.some(p=>Math.abs(a.width-p.width)<1e-5&&Math.abs(a.depth-p.depth)<1e-5&&Math.abs(a.height-p.height)<1e-5)).toBe(true)
 }
})
test('Blender module export contains only the reusable structural parts',()=>{
 const bytes=fs.readFileSync(new URL('../../public/assets/buildings/colony-modules.glb',import.meta.url)),g=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)))
 expect(g.nodes.map(n=>n.name).sort()).toEqual(['balcony','balcony_rail','canopy','door','planter','planting','shop_awning','stair_flight','structure','window_frame'])
 const structure=g.meshes[g.nodes.find(n=>n.name==='structure').mesh]
 const a=g.accessors[structure.primitives[0].attributes.POSITION]
 expect(a.min).toEqual([-.5,-.5,-.5]);expect(a.max).toEqual([.5,.5,.5])
 const balcony=g.meshes[g.nodes.find(n=>n.name==='balcony').mesh].primitives[0]
 const bounds=g.accessors[balcony.attributes.POSITION]
 expect(bounds.min[2]).toBeCloseTo(0,5);expect(bounds.max[2]).toBeLessThan(1)
 expect(bounds.min[1]).toBeCloseTo(-.12,5);expect(bounds.max[1]).toBeCloseTo(.96,5)
 expect(g.accessors[balcony.indices].count).toBeLessThanOrEqual(144)
 const rail=g.meshes[g.nodes.find(n=>n.name==='balcony_rail').mesh].primitives[0],railBounds=g.accessors[rail.attributes.POSITION]
 expect(railBounds.min).toEqual([-.5,expect.closeTo(-.12,5),expect.closeTo(0,5)])
 expect(railBounds.max).toEqual([.5,expect.closeTo(1.07,5),expect.closeTo(.9675,5)])
 expect(g.accessors[rail.indices].count/3).toBeLessThanOrEqual(144)
 for(const name of ['planter','planting']){
  const p=g.meshes[g.nodes.find(n=>n.name===name).mesh].primitives[0],a=g.accessors[p.attributes.POSITION]
  for(let axis=0;axis<3;axis++){expect(a.min[axis]).toBeCloseTo(-.5,5);expect(a.max[axis]).toBeCloseTo(.5,5)}
  expect(g.accessors[p.indices].count/3).toBeLessThanOrEqual(name==='planter'?28:240)
 }
 const flight=g.meshes[g.nodes.find(n=>n.name==='stair_flight').mesh].primitives[0],flightBounds=g.accessors[flight.attributes.POSITION]
 expect(flightBounds.min).toEqual([-.5,expect.closeTo(1/12-.05,5),-.5])
 expect(flightBounds.max).toEqual([.5,1,.5])
 expect(g.accessors[flight.indices].count/3).toBe(144)
 expect(bytes.length).toBeLessThan(48000)
})

test('replacement masses keep every certified street approach clear',()=>{
 const radius=3200,plan=planCity({radius,length:40000,maxBuildings:64000})
 for(const b of plan.buildings){
  if(cityBlockSpec(b,radius))continue
  const spec=colonyBuildingSpec(b),{roadEdge,entrance}=b.access!,side=b.front!.side,tangent=b.front!.axis==='tangent'
  for(const t of [0,.25,.5,.75,.95]){
   const angle=roadEdge.azimuth+(entrance.azimuth-roadEdge.azimuth)*t-b.azimuth,ax=roadEdge.axial+(entrance.axial-roadEdge.axial)*t-b.axial
   const x=side*(tangent?ax:-(radius-1.3)*Math.sin(angle)),z=side*(tangent?(radius-1.3)*Math.sin(angle):ax),y=radius-(radius-1.3)*Math.cos(angle)
   expect(spec.volumes.some(v=>Math.abs(x-v.x)<v.w/2-.025&&Math.abs(z-v.z)<v.d/2-.025&&Math.abs(y-v.y)<v.h/2),JSON.stringify({b,t,x,y,z,volumes:spec.volumes})).toBe(false)
  }
 }
})
