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
import type {StreetPolygon} from './streetPolygon'

export const ARRIVAL_WEST_ID='district-arrival-west'
export const ARRIVAL_CENTRAL_IDS=['district-arrival-north','district-arrival-south'] as const
export type ArrivalBounds={x0:number;x1:number;y0:number;y1:number}
// A temporary migration perimeter on existing roads. It clips the whole-band
// proposal; these boundaries never feed the upstream road generator.
export const ARRIVAL_WEST={x0:-1124.9893692854876,x1:-449.9957477141951,y0:-963.8709677419356,y1:963.8709677419356}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
export const ARRIVAL_CENTRAL:readonly ArrivalBounds[]=[
  {x0:ARRIVAL_WEST.x1,x1:224.99787385709756,y0:321.29032258064535,y1:ARRIVAL_WEST.y1},
  {x0:ARRIVAL_WEST.x1,x1:224.99787385709756,y0:ARRIVAL_WEST.y0,y1:-321.29032258064535}
]
const inside=(bounds:ArrivalBounds,x:number,y:number,margin=0)=>x>bounds.x0+margin+1e-5&&x<bounds.x1-margin-1e-5&&y>bounds.y0+margin+1e-5&&y<bounds.y1-margin-1e-5
const arrivalStreetPrefixes=[ARRIVAL_WEST_ID,...ARRIVAL_CENTRAL_IDS,'district-arrival-core'].map(id=>`${id}:`)
export const isArrivalStreet=(p:StreetPath)=>arrivalStreetPrefixes.some(prefix=>p.id.startsWith(prefix))

/** Clip a source centreline without moving either its interior vertices or
 * junctions. Surviving ends meet the retained perimeter roads exactly. */
export function clipArrivalRoad(from:BandPoint,to:BandPoint,bounds:ArrivalBounds=ARRIVAL_WEST):[BandPoint,BandPoint]|null{
  let lo=0,hi=1
  for(const [a,b,min,max] of [[from[0],to[0],bounds.x0,bounds.x1],[from[1],to[1],bounds.y0,bounds.y1]]){
    const d=b-a
    if(Math.abs(d)<1e-10){if(a<min||a>max)return null;continue}
    const t0=(min-a)/d,t1=(max-a)/d
    lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1))
  }
  if(hi-lo<1e-8)return null
  return [lo,hi].map(t=>[from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t]) as [BandPoint,BandPoint]
}

export function arrivalWestStreets(radius:number):StreetPath[]{
  return arrivalStreets(radius,ARRIVAL_WEST_ID,ARRIVAL_WEST)
}
export function arrivalStreets(radius:number,id:string,bounds:ArrivalBounds,deferBoundarySpurs=false):StreetPath[]{
  const streets:StreetPath[]=snapshot.roads.flatMap((r,i)=>{
    const ends=clipArrivalRoad(r.from as BandPoint,r.to as BandPoint,bounds)
    if(!ends)return []
    if(r.bridge||r.underpass)throw Error('Arrival migration cannot flatten a bridge or underpass')
    const [from,to]=ends,tangent:BandPoint=[to[0]-from[0],to[1]-from[1]]
    return [{id:`${id}:band-${i}`,azimuth:0,axial:0,kind:r.kind as 'arterial'|'collector',
      width:getStreetProfile(r.kind as 'arterial'|'collector',radius).carriageway,level:0,groundHeight:0,walkHeight:.32,
      knots:[{point:from,tangent},{point:to,tangent}]}]
  })
  if(!deferBoundarySpurs)return streets
  // Hold short isolated terminals at the migration boundary until the
  // adjoining area is built. Keep short links between real junctions.
  return streets.filter(p=>{
    const [a,b]=p.knots.map(k=>k.point)
    if(Math.hypot(a[0]-b[0],a[1]-b[1])>=60)return true
    const ends=[a,b].filter(q=>inside(bounds,q[0],q[1]))
    return ends.length!==1||streets.some(other=>other!==p&&other.knots.some(k=>Math.hypot(k.point[0]-ends[0][0],k.point[1]-ends[0][1])<1e-6))
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
  return rebuildArrivalRegion(city,radius,length,ARRIVAL_WEST_ID,ARRIVAL_WEST)
}

/** The occupied core remains on its existing streets until every entrance is
 * connected. The northern and southern shoulders extend the same band plan. */
export function rebuildArrivalCentral(city:CityPlan,radius:number,length:number){
  return ARRIVAL_CENTRAL.flatMap((bounds,i)=>{
    const result=rebuildArrivalRegion(city,radius,length,ARRIVAL_CENTRAL_IDS[i],bounds,true)
    return result?[result]:[]
  })
}

export function rebuildArrivalRegion(city:CityPlan,radius:number,length:number,id:string,bounds:ArrivalBounds,deferBoundarySpurs=false,
  retained?:{buildings:CityBuilding[];reserves:StreetPolygon[];streets:StreetPath[];patches?:CityPlan['patches'];trees?:CityPlan['trees']}){
  if(radius!==snapshot.radius||length!==snapshot.length||!city.streetNetwork)return null
  if(city.nativeDistricts?.some(d=>d.id===id))throw Error('Arrival district already applied')
  preserveCityPlaces(city,radius)
  const {x0,x1,y0,y1}=bounds,azimuth=(x0+x1)/(2*radius),axial=(y0+y1)/2
  const streets=[...arrivalStreets(radius,id,bounds,deferBoundarySpurs),...retained?.streets??[]],roads:CityRoad[]=[]
  let replacedRoads=0
  for(const r of city.roads){
    const vertical=r.axialLength>r.tangentWidth,x=wrap(r.azimuth)*radius,at=vertical?x:r.axial
    const [a,b]=vertical?[y0,y1]:[x0,x1],mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2
    const [low,high]=vertical?[x0,x1]:[y0,y1]
    if(at<=low+1e-5||at>=high-1e-5||mid+half<=a||mid-half>=b){roads.push(r);continue}
    replacedRoads++
    for(const [i,start,end] of [[0,mid-half,Math.min(mid+half,a)],[1,Math.max(mid-half,b),mid+half]]){
      if(end-start<1e-5)continue
      roads.push({...r,id:`${r.id}:${id}:${i}`,azimuth:vertical?r.azimuth:(start+end)/(2*radius),axial:vertical?(start+end)/2:r.axial,
        tangentWidth:vertical?r.tangentWidth:end-start,axialLength:vertical?end-start:r.axialLength})
    }
  }
  const replace=(b:CityBuilding)=>inside(bounds,wrap(b.azimuth)*radius,b.axial)&&!retained?.buildings.includes(b)
  const removed=city.buildings.filter(replace),kept=city.buildings.filter(b=>!replace(b))
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
  reserves.push(...(retained?.reserves??[]).map(p=>p.map(v=>({...v,x:v.x-azimuth*radius,y:v.y-axial}))))
  const land=planStreetParcels({id,azimuth,axial,bounds:{x0:-(x1-x0)/2+18,x1:(x1-x0)/2-18,y0:-(y1-y0)/2+18,y1:(y1-y0)/2-18},
    streets,reserves,seed:14092026,maximumFrontage:40},radius)
  let seed=14092026
  const candidates:CityBuilding[]=land.parcels.map((p,i)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const b=p.building,tone=seed/4294967296
    return {azimuth:azimuth+b.x/radius,axial:axial+b.y,width:b.width,depth:b.depth,yaw:b.yaw,
      height:9+(i*17%13)*3,front:{axis:'axial',side:p.front.side===1?-1:1},kind:i%4===0?'setback':'block',urban:.72,oldTown:0,tone,
      nativeDistrict:id,nativeParcel:p.id}
  })
  // The perimeter's outside buildings participate as obstacles. Only new lots
  // are replaced with certification output; existing authored contracts retain
  // their dimensions and door coordinates.
  const certified=certifyStreetAccess([...kept,...candidates],network,radius,6)
  if(retained?.buildings.some(b=>!certified.buildings.some(c=>c.azimuth===b.azimuth&&c.axial===b.axial)))throw Error('Arrival migration obstructed an inhabited entrance')
  const accepted=certified.buildings.filter(b=>b.nativeDistrict===id)
  const buildings=accepted.filter((_,i)=>accepted.length<=removed.length||Math.floor(i*removed.length/accepted.length)!==Math.floor((i-1)*removed.length/accepted.length))
  const d:NativeDistrict={id,band:0,character:'mixed',layout:'band-plan',azimuth,axial,width:x1-x0,length:y1-y0,
    streets,buildings,replacedBuildings:removed.length,replacedRoads,land,
    surfaces:{carriageways:carriageways.filter(s=>streets.includes(s.source)),sidewalks:sidewalks.filter(s=>streets.includes(s.source))}}
  const byPosition=new Map(certified.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b.access]))
  city.buildings=[...kept.map(b=>({...b,access:byPosition.get(`${b.azimuth}:${b.axial}`)??b.access})),...buildings]
  city.roads=roads;city.streetNetwork=network;city.nativeDistricts=[...city.nativeDistricts??[],d]
  city.patches=city.patches.filter(p=>retained?.patches?.includes(p)||!inside(bounds,wrap(p.azimuth)*radius,p.axial))
  city.trees=city.trees.filter(p=>retained?.trees?.includes(p)||!inside(bounds,wrap(p.azimuth)*radius,p.axial))
  city.intersections=city.intersections.filter(p=>!inside(bounds,wrap(p.azimuth)*radius,p.axial))
  return {district:d,traffic:streets.filter(p=>Math.hypot(p.knots[1].point[0]-p.knots[0].point[0],p.knots[1].point[1]-p.knots[0].point[1])>60).map(p=>arrivalTrafficStreet(p,radius))}
}
