import { expect, test } from 'bun:test'
import { proposedBandLand, bandRiverCentre } from './bandLand'
import { proposedBandExpressway } from './bandExpresswayLand'
import { reserveBandExpressway } from './bandExpressway'
import { BAND_LEVELS, auditElevatedRoads, bandBankHeight, bandRoadHeight, bandSoilHeight, elevatedRoadMesh, proposeExpresswayElevations, sampleElevatedRoad, type ElevatedRoad } from './bandElevation'
import { bandMeshGeometry, buildBandPavement, buildBandRiverMeshes, solidBandDeck } from './bandElevationGeometry'
import { streetPathSurfaces } from './streetSurfacePlan'
import type { BandPoint } from './bandStreetPlan'

const road=(id:string,points:BandPoint[],height:number,width=9):ElevatedRoad=>({id,from:id+'-from',to:id+'-to',width,depth:1,samples:sampleElevatedRoad(points,()=>height)})
test('river levels keep a soil bed above the hull, low paths below the bank and bridge approaches at their road endpoints',()=>{
  for(const crossing of proposedBandLand().crossings){
    const y=crossing.from[1],x=bandRiverCentre(y)
    expect(bandSoilHeight([x,y])).toBe(.12)
    expect(bandSoilHeight([x+14,y])).toBe(1.2)
    expect(bandSoilHeight([x+22,y])).toBe(5)
    expect(bandRoadHeight([x,y],true)).toBe(5.2)
    for(const p of [crossing.from,crossing.to])expect(bandRoadHeight(p,true)).toBeCloseTo(bandRoadHeight(p),8)
  }
  let max=0
  for(let x=30;x<155;x+=.1)max=Math.max(max,Math.abs(bandBankHeight(x+.1)-bandBankHeight(x))/.1)
  expect(max).toBeLessThanOrEqual(.060001)
  expect(5.2-BAND_LEVELS.riverDeckDepth-(1.2+.06)).toBeGreaterThan(3.3)
  expect(()=>bandRiverCentre(NaN)).toThrow();expect(()=>bandRiverCentre(20200)).toThrow()
})

test('river soil closes around its bed and its clipped ends, with no open mesh edge',()=>{
  const meshes=buildBandRiverMeshes(1430,1470),edges=new Map<string,number>(),s=meshes.soil
  for(let i=0;i<s.indices.length;i+=3){const [a,b,c]=s.indices.slice(i,i+3);for(const [p,q] of [[a,b],[b,c],[c,a]]){const k=p<q?`${p}:${q}`:`${q}:${p}`;edges.set(k,(edges.get(k)??0)+1)}}
  expect([...edges.values()].every(n=>n===2)).toBe(true)
  expect(s.vertices.every(p=>p[2]>=0)).toBe(true)
  expect(meshes.water.vertices.every(p=>p[2]===.65)).toBe(true)
  const geometry=bandMeshGeometry(s),p=geometry.getAttribute('position')
  expect(p.count).toBe(s.vertices.length)
  for(let i=0;i<p.count;i++)expect(Math.hypot(p.getX(i),p.getZ(i))).toBeCloseTo(3200-s.vertices[i][2],3)
  geometry.dispose()
})

test('bridge pavement tessellation follows both slopes instead of spanning them with a flat chord',()=>{
  const c=proposedBandLand().crossings[1],tangent:BandPoint=[310,0]
  const path={id:'bridge',azimuth:0,axial:0,groundHeight:0,level:0,kind:'arterial' as const,width:19.5,
    knots:[{point:c.from,tangent},{point:c.to,tangent}]}
  const mesh=buildBandPavement(streetPathSurfaces(path,3200),new Set(['bridge']))
  expect(Math.max(...mesh.vertices.map(p=>p[2]))).toBeCloseTo(5.2,8)
  expect(Math.min(...mesh.vertices.map(p=>p[2]))).toBeCloseTo(.2,2)
  for(let i=0;i<mesh.indices.length;i+=3){
    const p=mesh.indices.slice(i,i+3).map(j=>mesh.vertices[j]),x=p.reduce((n,v)=>n+v[0]/3,0),y=p.reduce((n,v)=>n+v[1]/3,0),h=p.reduce((n,v)=>n+v[2]/3,0)
    expect(Math.abs(h-bandRoadHeight([x,y],true))).toBeLessThan(.007)
  }
})

test('finite road width catches an off-centre overlap and subtracts the upper deck thickness',()=>{
  const a=road('lower',[[0,0],[20,0]],.2),b=road('upper',[[0,8],[20,8]],5.5)
  const conflict=auditElevatedRoads([a,b]);expect(conflict.conflicts).toHaveLength(1)
  expect(conflict.conflicts[0].minimumClearance).toBeCloseTo(4.3,8)
  const safe=auditElevatedRoads([a,road('higher',[[0,8],[20,8]],6)])
  expect(safe.conflicts).toEqual([]);expect(safe.crossings).toHaveLength(1)
  expect(auditElevatedRoads([a,road('separate',[[0,10],[20,10]],.2)]).crossings).toEqual([])
})

test('a shared endpoint only exempts a local, matching-height merge; distant collisions remain visible',()=>{
  const a=road('a',[[0,0],[200,0]],10),b={...road('b',[[0,0],[200,8]],10),from:a.from}
  expect(auditElevatedRoads([a,b]).conflicts[0].sharedNode).toBe(true)
  const short={...road('short',[[0,0],[20,8]],10),from:a.from}
  expect(auditElevatedRoads([road('a',[[0,0],[20,0]],10),short]).conflicts).toEqual([])
  expect(auditElevatedRoads([a,{...short,samples:sampleElevatedRoad([[0,0],[20,8]],t=>10+t*2)}]).conflicts).toHaveLength(1)
})

test('a crossing where the vertical order changes cannot pass a clearance audit',()=>{
  const a=road('a',[[-10,0],[10,0]],10),b={...road('b',[[0,-10],[0,10]],10),samples:sampleElevatedRoad([[0,-10],[0,10]],t=>5+10*t)}
  expect(auditElevatedRoads([a,b]).conflicts[0].minimumClearance).toBeLessThan(0)
})

test('deck extrusion closes the same top that was audited, with a real underside',()=>{
  const top=elevatedRoadMesh(road('deck',[[0,0],[100,20]],10)),solid=solidBandDeck(top,1),n=top.vertices.length
  expect(solid.indices.slice(0,top.indices.length)).toEqual(top.indices)
  for(let i=0;i<n;i++)expect(solid.vertices[i][2]-solid.vertices[i+n][2]).toBe(1)
  const edges=new Map<string,number>()
  for(let i=0;i<solid.indices.length;i+=3){const [a,b,c]=solid.indices.slice(i,i+3);for(const [p,q] of [[a,b],[b,c],[c,a]]){const k=p<q?`${p}:${q}`:`${q}:${p}`;edges.set(k,(edges.get(k)??0)+1)}}
  expect([...edges.values()].every(n=>n===2)).toBe(true)
  expect(()=>sampleElevatedRoad([[0,0],[0,0]],()=>1)).toThrow()
  expect(()=>sampleElevatedRoad([[0,0],[1,0]],()=>NaN)).toThrow()
})

test('whole expressway elevations keep all explicit joins continuous but report the unresolved ramp crossings',()=>{
  const plan=reserveBandExpressway(proposedBandLand(),proposedBandExpressway()),roads=proposeExpresswayElevations(plan),audit=auditElevatedRoads(roads)
  for(const node of plan.nodes){
    const ends=roads.flatMap(r=>[...(r.from===node.id?[r.samples[0]]:[]),...(r.to===node.id?[r.samples.at(-1)!]:[])])
    expect(ends.length).toBeGreaterThan(0)
    for(const p of ends)expect(p[2]).toBeCloseTo(node.role==='gate'?.2:10.2,8)
  }
  expect(audit.steep).toEqual([])
  expect(audit.conflicts.some(c=>!c.sharedNode&&c.b.includes('arrival-ic'))).toBe(true)
  expect(audit.conflicts.some(c=>c.b.includes('south-logistics-jct'))).toBe(true)
})
