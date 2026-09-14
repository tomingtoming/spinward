import {corridorToRoad} from './streetFrontage'
import {containsStreetPolygon,intersectStreetPolygons,polygonArea,positivePolygon,type StreetPolygon} from './streetPolygon'
import {landContains} from './streetParcels'
import type {CitySurfaceMesh} from './citySurfaceMesh'
import type {CityBuilding} from './cityLayout'

type Point={x:number;y:number}
export type EntranceWalkSite={
  id:string;entrance:Point;normal:Point;width:number;startHeight:number;maxGap:number
  // All polygons use the same unrolled, global surface coordinates.
  sidewalks:{polygon:StreetPolygon;height:number}[];carriageways:StreetPolygon[]
  allowed:StreetPolygon[];obstacles:StreetPolygon[]
}
export type EntranceWalk={
  id:string;source:{azimuth:number;axial:number};width:number;length:number
  entrance:Point;landing:Point;landingHeight:number
  pieces:StreetPolygon[];landingPieces:StreetPolygon[];surfaceMesh:CitySurfaceMesh
  collider:CityBuilding;maximumGrade:number
}
export type EntranceWalkResult={walk:EntranceWalk;rejected?:never}|{walk:null;rejected:'no-footway'|'blocked'|'outside-reserve'|'steep'|'no-landing'|'split-footway'}

/** Certify the complete entrance width to the NEAR edge of a real footway.
 * A road-centre anchor is not a pedestrian destination. One metre of missing
 * pavement cannot be hidden by a centre-ray hit or an endpoint snap.
 * Returned ramp triangles are shared by rendering and the normal city ground
 * sampler; only the landing overlaps the existing footway, not the ramp. */
export function certifyEntranceWalk(site:EntranceWalkSite,radius:number):EntranceWalkResult {
  const {entrance,normal,width}=site,depth=1.4
  if(![radius,width,site.maxGap,...Object.values(entrance),...Object.values(normal),site.startHeight].every(Number.isFinite)||radius<=0||width<1||site.maxGap<=0||Math.abs(Math.hypot(normal.x,normal.y)-1)>1e-6)throw Error('Invalid entrance walk coordinates')
  const local=(p:StreetPolygon)=>p.map(v=>({...v,x:v.x-entrance.x,y:v.y-entrance.y}))
  const global=(p:StreetPolygon)=>p.map(v=>({...v,x:v.x+entrance.x,y:v.y+entrance.y}))
  const distance=(v:Point)=>v.x*normal.x+v.y*normal.y
  const range=site.maxGap+width+10
  const nearby=site.sidewalks.filter(s=>Math.min(...s.polygon.map(v=>v.x))<=entrance.x+range&&Math.max(...s.polygon.map(v=>v.x))>=entrance.x-range&&
    Math.min(...s.polygon.map(v=>v.y))<=entrance.y+range&&Math.max(...s.polygon.map(v=>v.y))>=entrance.y-range)
  const heights=[...new Set(nearby.map(s=>s.height))].filter(Number.isFinite)
  const candidates=heights.flatMap(height=>{
    const footways=nearby.filter(s=>s.height===height).map(s=>local(s.polygon))
    const corridor=corridorToRoad(footways,normal,width,site.maxGap)
    return corridor&&corridor.length>1e-5?[{height,footways,corridor}]:[]
  }).sort((a,b)=>a.corridor.length-b.corridor.length)
  let rejected:NonNullable<EntranceWalkResult['rejected']>='no-footway'
  for(const {height,footways,corridor}of candidates){
    const farVertices=corridor.pieces.flat().filter(v=>distance(v)>1e-6)
    const lateral=(p:Point)=>p.x*normal.y-p.y*normal.x
    if(farVertices.some((p,i)=>farVertices.slice(i+1).some(q=>Math.abs(lateral(p)-lateral(q))<1e-6&&Math.abs(distance(p)-distance(q))>1e-5))){rejected='split-footway';continue}
    const landingPieces:StreetPolygon[]=[]
    // Each convex corridor slice has one straight far boundary, even when
    // independently owned sidewalk pieces meet across the doorway.
    for(const p of corridor.pieces){
      const far=p.filter(v=>distance(v)>1e-6)
      if(far.length!==2){rejected='no-landing';break}
      landingPieces.push(positivePolygon([...far,...[...far].reverse().map(v=>({...v,x:v.x+normal.x*depth,y:v.y+normal.y*depth}))]))
    }
    const landing={x:normal.x*(corridor.length+depth/2),y:normal.y*(corridor.length+depth/2)}
    const body=positivePolygon([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:landing.x+x*.35,y:landing.y+y*.35,u:0,v:0})))
    if(landingPieces.length!==corridor.pieces.length||!landingPieces.every(p=>landContains(footways,p))||!landContains(footways,body)){rejected='no-landing';continue}
    const all=[...corridor.pieces,...landingPieces].map(global)
    if(!all.every(p=>landContains(site.allowed,p))){rejected='outside-reserve';continue}
    if(all.some(p=>[...site.carriageways,...site.obstacles].some(o=>polygonArea(intersectStreetPolygons(p,o))>1e-5))){rejected='blocked';continue}
    const mesh:number[]=[],triangles:{x:number;y:number;z:number}[][]=[]
    for(const p of corridor.pieces){
      const vertices=p.map(v=>({...v,z:distance(v)<1e-6?site.startHeight:height}))
      for(let i=1;i<vertices.length-1;i++)triangles.push([vertices[0],vertices[i],vertices[i+1]])
    }
    let maximumGrade=0
    for(const tri of triangles){
      const [a,b,c]=tri,dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y,det=dx*ey-dy*ex
      if(Math.abs(det)<1e-10)continue
      const hx=((b.z-a.z)*ey-(c.z-a.z)*dy)/det,hy=(dx*(c.z-a.z)-ex*(b.z-a.z))/det
      maximumGrade=Math.max(maximumGrade,Math.hypot(hx,hy))
      for(const v of tri)mesh.push(v.x,v.y,v.z)
    }
    if(maximumGrade>.060001){rejected='steep';continue}
    // The level landing is certified existing pavement, not another render
    // skin. The ramp ends exactly at its outside edge to avoid z-fighting.
    const xs=corridor.pieces.flat().map(p=>p.x),ys=corridor.pieces.flat().map(p=>p.y)
    const source={azimuth:entrance.x/radius,axial:entrance.y}
    const collider:CityBuilding={...source,width:2*Math.max(...xs.map(Math.abs)),depth:2*Math.max(...ys.map(Math.abs)),height:Math.max(height,site.startHeight),
      tone:0,kind:'block',groundSurface:true,collisionMargin:0,groundMargin:0,surfaceMesh:mesh}
    return{walk:{id:site.id,source,width,length:corridor.length,entrance,landing:{x:entrance.x+landing.x,y:entrance.y+landing.y},landingHeight:height,
      pieces:corridor.pieces,landingPieces,surfaceMesh:mesh,collider,maximumGrade}}
  }
  return{walk:null,rejected}
}

export function entranceWalkContains(walk:EntranceWalk,x:number,y:number){
  return [...walk.pieces,...walk.landingPieces].some(p=>containsStreetPolygon(p,x-walk.entrance.x,y-walk.entrance.y))
}
