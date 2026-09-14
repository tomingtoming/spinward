import snapshot from '../../assets/planning/band-roads.json'
import type {CityPlan,CityRoad,CityBuilding} from './cityLayout'
import type {NativeDistrict,DistrictTrafficStreet} from './nativeDistricts'
import {legacyStreetPaths,type StreetPath} from './streetPath'
import {StreetNetwork} from './streetNetwork'
import {StreetSurfacePlan,relativeStreetPolygon} from './streetSurfacePlan'
import {planStreetParcels} from './streetParcels'
import {certifyStreetAccess} from './streetFrontage'
import {preserveCityPlaces} from './cityPlaces'
import {getStreetProfile} from './streetProfile'
import type {BandPoint} from './bandStreetPlan'

export const ARRIVAL_WEST_ID='district-arrival-west'
// A temporary migration perimeter on existing roads. It clips the whole-band
// proposal; these boundaries never feed the upstream road generator.
export const ARRIVAL_WEST={x0:-1124.9893692854876,x1:-449.9957477141951,y0:-963.8709677419356,y1:963.8709677419356}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const inside=(x:number,y:number,margin=0)=>x>ARRIVAL_WEST.x0+margin+1e-5&&x<ARRIVAL_WEST.x1-margin-1e-5&&y>ARRIVAL_WEST.y0+margin+1e-5&&y<ARRIVAL_WEST.y1-margin-1e-5

/** Clip a source centreline without moving either its interior vertices or
 * junctions. Surviving ends meet the retained perimeter roads exactly. */
export function clipArrivalRoad(from:BandPoint,to:BandPoint):[BandPoint,BandPoint]|null{
  let lo=0,hi=1
  for(const [a,b,min,max] of [[from[0],to[0],ARRIVAL_WEST.x0,ARRIVAL_WEST.x1],[from[1],to[1],ARRIVAL_WEST.y0,ARRIVAL_WEST.y1]]){
    const d=b-a
    if(Math.abs(d)<1e-10){if(a<min||a>max)return null;continue}
    const t0=(min-a)/d,t1=(max-a)/d
    lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1))
  }
  if(hi-lo<1e-8)return null
  return [lo,hi].map(t=>[from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t]) as [BandPoint,BandPoint]
}

export function arrivalWestStreets(radius:number):StreetPath[]{
  return snapshot.roads.flatMap((r,i)=>{
    const ends=clipArrivalRoad(r.from as BandPoint,r.to as BandPoint)
    if(!ends)return []
    if(r.bridge||r.underpass)throw Error('Arrival migration cannot flatten a bridge or underpass')
    const [from,to]=ends,tangent:BandPoint=[to[0]-from[0],to[1]-from[1]]
    return [{id:`${ARRIVAL_WEST_ID}:band-${i}`,azimuth:0,axial:0,kind:r.kind as 'arterial'|'collector',
      width:getStreetProfile(r.kind as 'arterial'|'collector',radius).carriageway,level:0,groundHeight:0,walkHeight:.32,
      knots:[{point:from,tangent},{point:to,tangent}]}]
  })
}

/** A station descriptor for the existing bounded traffic fleet. It is never
 * supplied as a visible rectangular road. The centreline owns the car pose. */
export function arrivalTrafficStreet(path:StreetPath,radius:number):DistrictTrafficStreet{
  let [from,to]=path.knots.map(k=>k.point),dx=to[0]-from[0],dy=to[1]-from[1]
  const vertical=Math.abs(dy)>Math.abs(dx)
  if((vertical?dy:dx)<0){[from,to]=[to,from];dx=-dx;dy=-dy}
  const cx=(from[0]+to[0])/2,cy=(from[1]+to[1])/2,tangent:BandPoint=[dx,dy]
  const road:CityRoad={id:path.id,kind:path.kind,azimuth:cx/radius,axial:cy,
    tangentWidth:vertical?path.width:Math.abs(dx),axialLength:vertical?Math.abs(dy):path.width}
  return {road,path:{...path,knots:[{point:from,tangent},{point:to,tangent}]},sourceRoadIds:[path.id]}
}

/** Apply a real portion of the independently planned band. Public facilities
 * and authored entrances remain outside this first perimeter. Ground-level
 * streets, parcels, guidance, pedestrians and distant rendering share the
 * resulting CityPlan; no alternate preview-only world is generated. */
export function rebuildArrivalWest(city:CityPlan,radius:number,length:number){
  if(radius!==snapshot.radius||length!==snapshot.length||!city.streetNetwork)return null
  if(city.nativeDistricts?.some(d=>d.id===ARRIVAL_WEST_ID))throw Error('Arrival district already applied')
  preserveCityPlaces(city,radius)
  const {x0,x1,y0,y1}=ARRIVAL_WEST,azimuth=(x0+x1)/(2*radius),axial=(y0+y1)/2
  const streets=arrivalWestStreets(radius),roads:CityRoad[]=[]
  let replacedRoads=0
  for(const r of city.roads){
    const vertical=r.axialLength>r.tangentWidth,x=wrap(r.azimuth)*radius,at=vertical?x:r.axial
    const [a,b]=vertical?[y0,y1]:[x0,x1],mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2
    const [low,high]=vertical?[x0,x1]:[y0,y1]
    if(at<=low+1e-5||at>=high-1e-5||mid+half<=a||mid-half>=b){roads.push(r);continue}
    replacedRoads++
    for(const [i,start,end] of [[0,mid-half,Math.min(mid+half,a)],[1,Math.max(mid-half,b),mid+half]]){
      if(end-start<1e-5)continue
      roads.push({...r,id:`${r.id}:${ARRIVAL_WEST_ID}:${i}`,azimuth:vertical?r.azimuth:(start+end)/(2*radius),axial:vertical?(start+end)/2:r.axial,
        tangentWidth:vertical?r.tangentWidth:end-start,axialLength:vertical?end-start:r.axialLength})
    }
  }
  const removed=city.buildings.filter(b=>inside(wrap(b.azimuth)*radius,b.axial)),kept=city.buildings.filter(b=>!inside(wrap(b.azimuth)*radius,b.axial))
  const paths=[...legacyStreetPaths(roads),...city.nativeDistricts?.flatMap(d=>d.streets)??[],...streets]
  const network=new StreetNetwork(paths,radius)
  if(new Set(network.components).size!==new Set(city.streetNetwork!.components).size)throw Error('Arrival migration disconnected the street network')
  const nearby=paths.filter(p=>{
    const xs=p.knots.map(k=>wrap(p.azimuth)*radius+k.point[0]),ys=p.knots.map(k=>p.axial+k.point[1])
    return Math.max(...xs)>x0-25&&Math.min(...xs)<x1+25&&Math.max(...ys)>y0-25&&Math.min(...ys)<y1+25
  })
  const surface=new StreetSurfacePlan(nearby,radius,true)
  const carriageways=surface.roadSurfaces(),sidewalks=surface.sidewalks()
  const origin={...streets[0],azimuth,axial}
  const reserves=[...carriageways,...sidewalks].map(s=>relativeStreetPolygon(s,origin,radius))
  const land=planStreetParcels({id:ARRIVAL_WEST_ID,azimuth,axial,bounds:{x0:-(x1-x0)/2+18,x1:(x1-x0)/2-18,y0:-(y1-y0)/2+18,y1:(y1-y0)/2-18},
    streets,reserves,seed:14092026,maximumFrontage:40},radius)
  let seed=14092026
  const candidates:CityBuilding[]=land.parcels.map((p,i)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const b=p.building,tone=seed/4294967296
    return {azimuth:azimuth+b.x/radius,axial:axial+b.y,width:b.width,depth:b.depth,yaw:b.yaw,
      height:9+(i*17%13)*3,front:{axis:'axial',side:p.front.side===1?-1:1},kind:i%4===0?'setback':'block',urban:.72,oldTown:0,tone,
      nativeDistrict:ARRIVAL_WEST_ID,nativeParcel:p.id}
  })
  // The perimeter's outside buildings participate as obstacles. Only new lots
  // are replaced with certification output; existing authored contracts retain
  // their dimensions and door coordinates.
  const certified=certifyStreetAccess([...kept,...candidates],network,radius,6)
  const accepted=certified.buildings.filter(b=>b.nativeDistrict===ARRIVAL_WEST_ID)
  const buildings=accepted.filter((_,i)=>accepted.length<=removed.length||Math.floor(i*removed.length/accepted.length)!==Math.floor((i-1)*removed.length/accepted.length))
  const d:NativeDistrict={id:ARRIVAL_WEST_ID,band:0,character:'mixed',layout:'band-plan',azimuth,axial,width:x1-x0,length:y1-y0,
    streets,buildings,replacedBuildings:removed.length,replacedRoads,land,
    surfaces:{carriageways:carriageways.filter(s=>streets.includes(s.source)),sidewalks:sidewalks.filter(s=>streets.includes(s.source))}}
  const byPosition=new Map(certified.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b.access]))
  city.buildings=[...kept.map(b=>({...b,access:byPosition.get(`${b.azimuth}:${b.axial}`)??b.access})),...buildings]
  city.roads=roads;city.streetNetwork=network;city.nativeDistricts=[...city.nativeDistricts??[],d]
  city.patches=city.patches.filter(p=>!inside(wrap(p.azimuth)*radius,p.axial))
  city.trees=city.trees.filter(p=>!inside(wrap(p.azimuth)*radius,p.axial))
  city.intersections=city.intersections.filter(p=>!inside(wrap(p.azimuth)*radius,p.axial))
  return {district:d,traffic:streets.filter(p=>Math.hypot(p.knots[1].point[0]-p.knots[0].point[0],p.knots[1].point[1]-p.knots[0].point[1])>60).map(p=>arrivalTrafficStreet(p,radius))}
}
