import { expect, test } from 'bun:test'
import { bandGeometryIssues, prepareBandStreetGeometry, refineBandRoads } from './bandStreetGeometry'
import { bandGraph, clearBandSegment, type BandPoint, type BandRoad, type BandSite } from './bandStreetPlan'
import { planBandTransport } from './bandExpressway'
import { proposedBandExpressway } from './bandExpresswayLand'
import { proposedBandLand } from './bandLand'
import { StreetNetwork } from './streetNetwork'
import { buildStreetSurfaceGeometry } from './streetSurfaceGeometry'
import { containsStreetPolygon, intersectStreetPolygons, polygonArea } from './streetPolygon'
import { StreetSurfacePlan } from './streetSurfacePlan'
import type { StreetPath } from './streetPath'

const road=(from:BandPoint,to:BandPoint,kind:BandRoad['kind']='collector'):BandRoad=>({from,to,kind,reason:'fixture'})
const site:BandSite={id:'fixture',width:2000,length:2000,centres:[],crossings:[],reserves:[],seed:1,localDemand:0,detourRatio:1.7}
const near=(a:BandPoint,b:BandPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.0001
const planned=planBandTransport(proposedBandLand(),proposedBandExpressway()).surface
const geometry=prepareBandStreetGeometry(planned)

test('adjacent T junctions share one meeting and retain their four external approaches',()=>{
  const input=[road([-100,0],[0,0]),road([0,0],[8,0]),road([8,0],[100,0]),road([0,0],[0,100]),road([8,0],[8,-100])]
  const saved=structuredClone(input),result=refineBandRoads(input,site),g=bandGraph(result.roads)
  expect(result.before.short).toHaveLength(1);expect(result.remaining.short).toEqual([])
  expect(g.degree.filter(n=>n===4)).toHaveLength(1);expect(g.components).toBe(1)
  for(const end of [[-100,0],[100,0],[0,100],[8,-100]] as BandPoint[])expect(g.points.some(p=>near(p,end))).toBe(true)
  expect(input).toEqual(saved);expect(refineBandRoads(input,site)).toEqual(result)
})

test('a collector beside a larger road shares its approach without stranding its outer branch',()=>{
  const input=[road([-200,0],[0,0],'arterial'),road([0,0],[400,0],'arterial'),road([0,0],[200,5]),road([200,5],[200,180])]
  const result=refineBandRoads(input,site,[[200,5],[200,180]]),g=bandGraph(result.roads)
  expect(result.before.sharp).toHaveLength(1);expect(result.remaining.sharp).toEqual([])
  expect(g.components).toBe(1);expect(g.points.some(p=>near(p,[200,180]))).toBe(true)
  expect(result.roads.some(r=>near(r.from,[200,0])||near(r.to,[200,0]))).toBe(true)
})

test('two fixed gates cannot be merged merely to satisfy a minimum-link target',()=>{
  const input=[road([-100,0],[0,0]),road([0,0],[8,0]),road([8,0],[100,0]),road([0,0],[0,100]),road([8,0],[8,-100])]
  const result=refineBandRoads(input,{...site,accesses:[{id:'a',point:[0,0],serves:[]},{id:'b',point:[8,0],serves:[]}]})
  expect(result.edits).toEqual([]);expect(result.remaining.short).toHaveLength(1)
})

test('sharing an approach cannot cut protected land or create a crossing between disconnected banks',()=>{
  const input=[road([-400,0],[-200,0]),road([-200,0],[-100,0]),road([-200,0],[-150,5]),road([-150,5],[-100,100]),road([100,-100],[100,100])]
  const land={...site,reserves:[{id:'water',kind:'water' as const,polygon:[[-20,-1000],[20,-1000],[20,1000],[-20,1000]] as BandPoint[]},
    {id:'corner',kind:'green' as const,polygon:[[-155,1],[-145,1],[-145,3],[-155,3]] as BandPoint[]}]}
  const result=refineBandRoads(input,land)
  expect(bandGraph(result.roads).components).toBe(2)
  for(const r of result.roads.filter(r=>!input.some(s=>near(s.from,r.from)&&near(s.to,r.to))))expect(clearBandSegment(r.from,r.to,land.reserves)).toBe(true)
})

test('whole-band refinement preserves every named anchor, crossing and reachable demand',()=>{
  const original=bandGraph(planned.roads),g=bandGraph(geometry.roads)
  expect(g.components).toBe(1);expect(geometry.remaining.short).toEqual([])
  expect(geometry.remaining.sharp.length).toBeLessThan(geometry.before.sharp.length)
  for(const p of [...planned.site.centres.map(c=>c.point),...planned.site.accesses!.map(a=>a.point),...planned.site.crossings.flatMap(c=>[c.from,c.to])]) {
    if(original.points.some(q=>near(p,q)))expect(g.points.some(q=>near(p,q))).toBe(true)
  }
  for(const r of geometry.roads) {
    const crossing=planned.site.crossings.find(c=>c.id===(r.underpass??r.bridge))
    expect(clearBandSegment(r.from,r.to,planned.site.reserves.filter(s=>s.id!==crossing?.reserve))).toBe(true)
  }
  for(const r of planned.roads.filter(r=>r.bridge||r.underpass))expect(geometry.roads.some(s=>s.bridge===r.bridge&&s.underpass===r.underpass&&near(s.from,r.from)&&near(s.to,r.to))).toBe(true)
  const reachable=(p:BandPoint,roads:BandRoad[])=>roads.some(r=>{
    const dx=r.to[0]-r.from[0],dy=r.to[1]-r.from[1],t=Math.max(0,Math.min(1,((p[0]-r.from[0])*dx+(p[1]-r.from[1])*dy)/(dx*dx+dy*dy)))
    const q:BandPoint=[r.from[0]+t*dx,r.from[1]+t*dy]
    return Math.hypot(p[0]-q[0],p[1]-q[1])<=90.001&&clearBandSegment(p,q,planned.site.reserves)
  })
  for(const d of planned.demand)if(reachable(d.point,planned.roads))expect(reachable(d.point,geometry.roads)).toBe(true)
  const network=new StreetNetwork(geometry.paths,3200)
  expect(new Set(network.components).size).toBe(1)
  expect(network.edges.length-network.nodes.length+1).toBe(g.cycles)
  expect(bandGeometryIssues(geometry.roads)).toEqual(geometry.remaining)
})

test('finite-width pavement has one owner and sidewalks never overlap the carriageway',()=>{
  const bounds=(p:typeof geometry.carriageways[number])=>({x0:Math.min(...p.polygon.map(v=>v.x)),x1:Math.max(...p.polygon.map(v=>v.x)),y0:Math.min(...p.polygon.map(v=>v.y)),y1:Math.max(...p.polygon.map(v=>v.y))})
  const roads=geometry.carriageways.map(s=>({s,b:bounds(s)})),walks=geometry.sidewalks.map(s=>({s,b:bounds(s)}))
  let maxOverlap=0
  for(const [group,sameGroup] of [[roads,true],[walks,false]] as const)for(let i=0;i<group.length;i++)for(let j=0;j<(sameGroup?i:roads.length);j++) {
    const a=group[i],b=roads[j]
    if(a.b.x0>=b.b.x1||b.b.x0>=a.b.x1||a.b.y0>=b.b.y1||b.b.y0>=a.b.y1)continue
    maxOverlap=Math.max(maxOverlap,Math.abs(polygonArea(intersectStreetPolygons(a.s.polygon,b.s.polygon))))
  }
  expect(maxOverlap).toBeLessThan(.00001)
  const mesh=buildStreetSurfaceGeometry([...geometry.carriageways,...geometry.sidewalks],3200,10)!
  const p=mesh.getAttribute('position');expect(p.count).toBeGreaterThan(0)
  let radialError=0
  for(let i=0;i<p.count;i++) {
    const radius=Math.hypot(p.getX(i),p.getZ(i))
    radialError=Math.max(radialError,Math.min(Math.abs(radius-3199.8),Math.abs(radius-3199.68)))
  }
  expect(radialError).toBeLessThan(.001)
  mesh.dispose()
})

test('opted-in endpoint bevels close the outer road and footway notch without filling another deck',()=>{
  const paths:StreetPath[]=[road([-30,0],[0,0]),road([0,0],[0,30])].map((r,i)=>{
    const tangent:BandPoint=[r.to[0]-r.from[0],r.to[1]-r.from[1]]
    return {id:`bend-${i}`,azimuth:0,axial:0,level:0,groundHeight:0,kind:'local',width:6,knots:[{point:r.from,tangent},{point:r.to,tangent}]}
  })
  const filled=new StreetSurfacePlan(paths,3200,true),raw=new StreetSurfacePlan(paths,3200)
  const covers=(s:ReturnType<typeof filled.roadSurfaces>,x:number,y:number)=>s.some(s=>containsStreetPolygon(s.polygon,x,y))
  expect(covers(raw.roadSurfaces(),1,-1)).toBe(false)
  expect(covers(filled.roadSurfaces(),1,-1)).toBe(true)
  expect(covers(raw.sidewalks(),2,-2)).toBe(false)
  expect(covers(filled.sidewalks(),2,-2)).toBe(true)
  expect(covers(filled.roadSurfaces(),2,-2)).toBe(false)
  expect(covers(new StreetSurfacePlan([paths[0],{...paths[1],level:1}],3200,true).roadSurfaces(),1,-1)).toBe(false)
  expect(covers(new StreetSurfacePlan([paths[0],{...paths[1],groundHeight:3}],3200,true).roadSurfaces(),1,-1)).toBe(false)
})
