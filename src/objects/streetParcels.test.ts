import {expect,test} from 'bun:test'
import {planStreetParcels,landContains,type StreetParcelSite} from './streetParcels'
import {polygonArea,intersectStreetPolygons,containsStreetPolygon,type StreetPolygon} from './streetPolygon'
import {streetPathSurfaces} from './streetSurfacePlan'
import type {StreetPath} from './streetPath'
const rect=(x0:number,y0:number,x1:number,y1:number):StreetPolygon=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x,y,u:0,v:0}))
const line=(id:string,a:[number,number],b:[number,number],level=0):StreetPath=>({id,azimuth:0,axial:0,kind:'local',width:6,level,groundHeight:0,knots:[a,b].map(point=>({point,tangent:[b[0]-a[0],b[1]-a[1]]}))})
const site=(streets:StreetPath[],reserves:StreetPolygon[]=[]):StreetParcelSite=>({id:'test',azimuth:0,axial:0,bounds:{x0:-160,x1:160,y0:-160,y1:160},streets,reserves,seed:91})
test('oblique streets and a T junction form land blocks before lots, while a dead end does not cut a block',()=>{
 const through=line('through',[-160,-60],[160,60]),branch=line('branch',[0,0],[-40,160])
 expect(planStreetParcels(site([through]),3200).blocks).toHaveLength(2)
 const p=planStreetParcels(site([through,branch]),3200)
 expect(p.blocks).toHaveLength(3);expect(p.parcels.length).toBeGreaterThan(10)
 expect(planStreetParcels(site([through,line('dead',[0,0],[-20,75])]),3200).blocks).toHaveLength(2)
 expect(planStreetParcels(site([through,{...branch,level:1,groundHeight:20}]),3200).blocks).toHaveLength(2)
})
test('land and parcel interiors do not overlap and conserve available area around a reserve hole',()=>{
 const roads=[line('street',[-160,-80],[160,-80])],reserve=rect(-20,-10,45,65),s=site(roads,[reserve]),p=planStreetParcels(s,3200)
 expect(p.blocks).toHaveLength(2)
 expect(p.blocks.reduce((a,b)=>a+b.area,0)).toBeCloseTo(320*320-320*12-65*75,5)
 const all=p.blocks.flatMap(b=>b.pieces)
 for(const a of all){
  expect(polygonArea(intersectStreetPolygons(a,reserve))).toBeLessThan(1e-6)
  for(const road of streetPathSurfaces({...roads[0],width:12},3200))expect(polygonArea(intersectStreetPolygons(a,road.polygon))).toBeLessThan(1e-6)
 }
 for(let i=0;i<p.parcels.length;i++){
  const a=p.parcels[i];expect(a.pieces.some(q=>containsStreetPolygon(q,a.front.point.x,a.front.point.y))).toBe(true)
  for(let j=0;j<i;j++)for(const x of a.pieces)for(const y of p.parcels[j].pieces)expect(polygonArea(intersectStreetPolygons(x,y))).toBeLessThan(1e-5)
  const b=a.building,c=Math.cos(b.yaw),sn=Math.sin(b.yaw)
  const foot=rect(-b.width/2,-b.depth/2,b.width/2,b.depth/2).map(v=>({...v,x:b.x+c*v.x-sn*v.y,y:b.y+sn*v.x+c*v.y}))
  expect(landContains(a.pieces,foot)).toBe(true)
 }
 expect(p.unallocatedArea+p.parcels.reduce((a,b)=>a+b.area,0)).toBeCloseTo(p.blocks.reduce((a,b)=>a+b.area,0),6)
 // A four-corner-only check would miss this reservation entirely.
 expect(landContains(all,rect(-30,-20,60,80))).toBe(false)
})
test('curved road and reserve changes alter parcels deterministically without mutating source land',()=>{
 const road:StreetPath={...line('curve',[-160,-40],[160,20]),knots:[{point:[-160,-40],tangent:[210,150]},{point:[160,20],tangent:[210,-130]}]}
 const s=site([road],[rect(-25,35,60,120)]),before=JSON.stringify(s),p=planStreetParcels(s,3200)
 expect(p.parcels.length).toBeGreaterThan(5);expect(JSON.stringify(s)).toBe(before)
 expect(planStreetParcels(s,3200)).toEqual(p)
 expect(planStreetParcels({...s,reserves:[rect(-60,-130,40,-50)]},3200).parcels).not.toEqual(p.parcels)
 for(const parcel of p.parcels)for(const piece of parcel.pieces){
  expect(piece.every(v=>v.x>=-160-1e-6&&v.x<=160+1e-6&&v.y>=-160-1e-6&&v.y<=160+1e-6)).toBe(true)
  expect(polygonArea(intersectStreetPolygons(piece,s.reserves[0]))).toBeLessThan(1e-5)
 }
})
