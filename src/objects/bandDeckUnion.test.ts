import { expect, test } from 'bun:test'
import { buildJoinedBandDecks } from './bandDeckUnion'
import { proposedBandLand } from './bandLand'
import { proposedBandExpressway } from './bandExpresswayLand'
import { reserveBandExpressway } from './bandExpressway'
import { proposeExpresswayElevations, sampleElevatedRoad, type BandMesh, type ElevatedRoad } from './bandElevation'
import { intersectStreetPolygons, polygonArea, type StreetPolygon } from './streetPolygon'

const road=(id:string,end:[number,number],height=10,depth=1):ElevatedRoad=>({id,from:'join',to:id,width:10,depth,samples:sampleElevatedRoad([[0,0],end],()=>height)})
function badEdges(mesh:BandMesh){
  const edges=new Map<string,number>()
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3);for(const [x,y] of [[a,b],[b,c],[c,a]]){const key=x<y?`${x}:${y}`:`${y}:${x}`;edges.set(key,(edges.get(key)??0)+1)}}
  return [...edges].filter(([,count])=>count!==2)
}
function flatOverlap(polygons:StreetPolygon[]) {
  const grid=new Map<string,number[]>(),bounds=polygons.map(p=>({x0:Math.min(...p.map(v=>v.x)),x1:Math.max(...p.map(v=>v.x)),y0:Math.min(...p.map(v=>v.y)),y1:Math.max(...p.map(v=>v.y))}));let area=0
  polygons.forEach((p,i)=>{
    if(!p.every(v=>Math.abs(v.u-p[0].u)<1e-8))return
    const b=bounds[i],keys:string[]=[]
    for(let x=Math.floor(b.x0/20);x<=Math.floor(b.x1/20);x++)for(let y=Math.floor(b.y0/20);y<=Math.floor(b.y1/20);y++)keys.push(`${x}:${y}`)
    for(const j of new Set(keys.flatMap(k=>grid.get(k)??[]))){const c=bounds[j];if(Math.abs(p[0].u-polygons[j][0].u)<1e-8&&b.x0<c.x1&&b.x1>c.x0&&b.y0<c.y1&&b.y1>c.y0)area+=Math.abs(polygonArea(intersectStreetPolygons(p,polygons[j])))}
    for(const k of keys){const list=grid.get(k)??[];list.push(i);grid.set(k,list)}
  });return area
}
test('a right-angle join owns the 25 square metre overlap once and removes internal deck walls',()=>{
  const a=road('a',[40,0]),b=road('b',[0,30]),joined=buildJoinedBandDecks([a,b])
  expect(joined.stats.originalArea).toBeCloseTo(700,8)
  expect(joined.stats.removedArea).toBeCloseTo(25,8)
  expect(joined.stats.ownedArea).toBeCloseTo(675,8)
  expect(joined.boundary.reduce((n,e)=>n+Math.hypot(e.to[0]-e.from[0],e.to[1]-e.from[1]),0)).toBeCloseTo(160,7)
  expect(badEdges(joined.mesh)).toEqual([])
  expect(joined.stats.nonManifoldBoundaries).toBe(0)
  expect(buildJoinedBandDecks([b,a]).mesh).toEqual(joined.mesh)
})
test('graph identity and exact elevation govern joins, not projected crossings or a loose clearance exemption',()=>{
  const a=road('a',[40,0]),b=road('b',[0,30])
  for(const separate of [{...b,from:'unconnected'},road('b',[0,30],17),road('b',[0,30],10.01),road('b',[0,30],10,2)]){
    const joined=buildJoinedBandDecks([a,separate]);expect(joined.stats.removedArea).toBe(0)
    expect(joined.stats.ownedArea).toBeCloseTo(700,8)
  }
  const ground=buildJoinedBandDecks([road('a',[40,0],.2,1),road('b',[0,30],.2,.2)])
  expect(ground.stats.removedArea).toBeCloseTo(25,8)
  expect(ground.mesh.vertices.every(p=>p[2]>=0)).toBe(true)
  expect(badEdges(ground.mesh)).toEqual([])
  expect(()=>buildJoinedBandDecks([a,a])).toThrow()
  expect(()=>buildJoinedBandDecks([{...a,depth:NaN}])).toThrow()
})
test('oblique merges conform clipped vertices into a closed shell without adding or dropping pavement',()=>{
  for(const end of [[40,17],[-30,23],[-20,-30]] as [number,number][]){
    const joined=buildJoinedBandDecks([road('a',[45,0]),road('b',end),road('c',[-35,0])])
    expect(joined.stats.removedArea).toBeGreaterThan(0)
    expect(joined.stats.ownedArea+joined.stats.removedArea).toBeCloseTo(joined.stats.originalArea,6)
    expect(badEdges(joined.mesh)).toEqual([])
  }
})
test('the full IC and JCT plan removes duplicate joins and preserves a closed boundary within its mesh budget',()=>{
  const roads=proposeExpresswayElevations(reserveBandExpressway(proposedBandLand(),proposedBandExpressway())),joined=buildJoinedBandDecks(roads)
  expect(joined.stats.removedArea).toBeGreaterThan(1000)
  expect(joined.stats.ownedArea+joined.stats.removedArea).toBeCloseTo(joined.stats.originalArea+joined.stats.weldAreaChange,4)
  expect(joined.stats.maximumWeld).toBeLessThanOrEqual(.0001)
  expect(joined.stats.topTriangles).toBeLessThan(joined.stats.sourceTriangles*1.3)
  expect(joined.stats.nonManifoldBoundaries).toBe(0)
  expect(badEdges(joined.mesh)).toEqual([])
  expect(flatOverlap(joined.pieces.map(p=>p.polygon))).toBeLessThan(.00001)
  expect(joined.parts.every(p=>p.mesh.indices.length>0)).toBe(true)
})
