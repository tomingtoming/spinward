import { expect, test } from 'bun:test'
import { growPlaceStreets, type PlaceStreetSite, type StreetDestination } from './placeStreetGrowth'
import { StreetNetwork } from './streetNetwork'
import { streetPathSamples, streetRibbon, type StreetPath } from './streetPath'
import { intersectStreetPolygons, polygonArea, type StreetPolygon } from './streetPolygon'

const line=(id:string,a:[number,number],b:[number,number]):StreetPath=>({id,azimuth:0,axial:0,kind:'collector',width:12,level:0,groundHeight:0,
  knots:[{point:a,tangent:[b[0]-a[0],b[1]-a[1]]},{point:b,tangent:[b[0]-a[0],b[1]-a[1]]}]})
const goal=(id:string,point:[number,number]):StreetDestination=>({id,point,kind:'local',width:6})
const rect=(x0:number,y0:number,x1:number,y1:number):StreetPolygon=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x,y,u:0,v:0}))
const site=(destinations:StreetDestination[],reserves:StreetPolygon[]=[]):PlaceStreetSite=>({id:'test',azimuth:0,axial:0,
  bounds:{x0:-600,x1:600,y0:-600,y1:600},trunks:[line('trunk',[-350,-580],[-350,580])],destinations,reserves})
const circuits=(streets:StreetPath[])=>{const n=new StreetNetwork(streets,3200);return n.edges.length-n.nodes.length+new Set(n.components).size}
function checkLand(streets:StreetPath[],reserves:StreetPolygon[]){
  for(const path of streets){const samples=streetPathSamples(path)
    for(let i=1;i<samples.length;i++)for(const reserve of reserves)
      expect(polygonArea(intersectStreetPolygons(streetRibbon(path,samples[i-1].t,samples[i].t,-path.width/2-2,path.width/2+2),reserve))).toBeLessThan(1e-6)
  }
}

test('destination position determines shared access and whether a useful loop is needed',()=>{
  const near=site([goal('east',[200,150]),goal('second',[340,150])])
  near.links=[{id:'connection',from:'east',to:'second',maxDetour:1.8}]
  const close=growPlaceStreets(near)
  expect(close.unconnected).toEqual([]);expect(close.deferredLinks).toEqual([])
  expect(close.connections[1].street).toBe('test:east')
  expect(close.links[0].added).toBe(false);expect(circuits(close.streets)).toBe(0)
  const apart=site([goal('east',[200,400]),goal('second',[205,-400])]);apart.links=near.links
  const far=growPlaceStreets(apart)
  expect(far.unconnected).toEqual([]);expect(far.deferredLinks).toEqual([])
  expect(far.links[0].added).toBe(true);expect(far.links[0].after*1.8).toBeLessThan(far.links[0].before)
  expect(circuits(far.streets)).toBe(1)
  expect(new Set(new StreetNetwork(far.streets,3200).components).size).toBe(1)
},10000)

test('moving reserved land changes the route while keeping its full pavement clear',()=>{
  const input=site([goal('neighborhood',[230,0])],[rect(-90,-320,90,320)])
  const blocked=growPlaceStreets(input),open=growPlaceStreets({...input,reserves:[]})
  expect(blocked.unconnected).toEqual([]);expect(open.unconnected).toEqual([])
  expect(blocked.streets[1].knots).not.toEqual(open.streets[1].knots)
  expect(Math.max(...streetPathSamples(blocked.streets[1]).map(p=>Math.abs(p.y)))).toBeGreaterThan(320)
  checkLand(blocked.streets.slice(1),input.reserves)
},10000)

test('a river barrier requires a supplied crossing; the generator cannot invent a road through water',()=>{
  const input=site([goal('east-bank',[250,0])],[rect(-40,-650,40,650)])
  const blocked=growPlaceStreets(input)
  expect(blocked.unconnected).toEqual(['east-bank']);expect(blocked.streets).toHaveLength(1)
  const withBridge=growPlaceStreets({...input,trunks:[...input.trunks,line('existing-bridge',[-350,350],[500,350])]})
  expect(withBridge.unconnected).toEqual([])
  expect(withBridge.connections[0].street).toBe('existing-bridge')
  checkLand(withBridge.streets.slice(2),input.reserves)
  expect(new Set(new StreetNetwork(withBridge.streets,3200).components).size).toBe(1)
},10000)

test('repeat generation is deterministic, does not mutate the site, and rejects inaccessible destinations explicitly',()=>{
  const input=site([goal('outside',[700,0]),goal('inside',[0,0]),goal('valid',[280,230])],[rect(-50,-50,50,50)])
  const before=JSON.stringify(input),a=growPlaceStreets(input),b=growPlaceStreets(input)
  expect(a).toEqual(b);expect(JSON.stringify(input)).toBe(before)
  expect(a.unconnected).toEqual(['outside','inside']);expect(a.connections).toHaveLength(1)
})
