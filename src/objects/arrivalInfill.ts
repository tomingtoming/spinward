import {DEFAULT_MAX_BUILDINGS,type CityBuilding,type CityPlan} from './cityLayout'
import {planStreetParcels} from './streetParcels'
import {buildingFootprint,certifyStreetAccess,streetAccessPolygons} from './streetFrontage'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {streetPathSurfaces} from './streetSurfacePlan'
import {colonyBuildingSeed} from './colonyBuildingUse'
import type {StreetPolygon} from './streetPolygon'

const rectangle=(x0:number,y0:number,x1:number,y1:number):StreetPolygon=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x,y,u:0,v:0}))

/** Occupy the served edges of new local streets without moving existing lots.
 * The same candidate parcels are reserved at every rendering budget. */
export function populateArrivalLocalStreets(city:CityPlan,radius:number,maximumBuildings=DEFAULT_MAX_BUILDINGS){
 if(!Number.isFinite(maximumBuildings)||maximumBuildings<0)throw Error('Invalid arrival infill budget')
 const districts=(city.nativeDistricts??[]).filter(d=>d.localLinks?.length)
 if(!city.streetNetwork||!districts.length||districts.some(d=>d.infill))return[]
 const global=(at:{azimuth:number;axial:number},p:StreetPolygon)=>p.map(v=>({...v,x:v.x+at.azimuth*radius,y:v.y+at.axial}))
 const reserves:StreetPolygon[]=[
  ...captureBandPublicPlaces(city,radius).map(p=>p.reserve.polygon.map(([x,y])=>({x,y,u:0,v:0}))),
  ...(city.nativeDistricts??[]).flatMap(d=>(d.land?.parcels??[]).flatMap(p=>p.pieces.map(piece=>global(d,piece)))),
  ...city.streetNetwork.streets.flatMap(p=>streetPathSurfaces(p,radius).map(s=>global(p,s.polygon))),
  ...(city.nativeDistricts??[]).flatMap(d=>d.surfaces?.sidewalks.map(s=>global(s.source,s.polygon))??[]),
  ...city.buildings.flatMap(b=>[global(b,buildingFootprint({...b,width:b.width+2,depth:b.depth+2})),
   ...b.access?streetAccessPolygons(b.access,radius).map(p=>global(b.access!.entrance,p)):[]]),
  ...city.entranceWalks?.flatMap(w=>[...w.pieces,...w.landingPieces].map(p=>global(w.source,p)))??[]
 ]
 if(city.expressway){
  const e=city.expressway
  reserves.push(rectangle(-Math.PI*radius,e.axial-e.corridorHalfWidth,Math.PI*radius,e.axial+e.corridorHalfWidth))
 }
 const candidates:CityBuilding[]=[],fronts=new Map<string,string>()
 for(const d of districts){
  const land:ReturnType<typeof planStreetParcels>[]=[]
  for(const path of d.streets.filter(p=>p.id.includes(':local-link-'))){
   const x=path.knots.map(k=>k.point[0]+(path.azimuth-d.azimuth)*radius),y=path.knots.map(k=>k.point[1]+path.axial-d.axial)
   const bounds={x0:Math.max(-d.width/2+18,Math.min(...x)-60),x1:Math.min(d.width/2-18,Math.max(...x)+60),
    y0:Math.max(-d.length/2+18,Math.min(...y)-60),y1:Math.min(d.length/2-18,Math.max(...y)+60)}
   if(bounds.x1<=bounds.x0||bounds.y1<=bounds.y0)continue
   const nearby=reserves.filter(p=>Math.max(...p.map(v=>v.x))-d.azimuth*radius>=bounds.x0&&Math.min(...p.map(v=>v.x))-d.azimuth*radius<=bounds.x1
    &&Math.max(...p.map(v=>v.y))-d.axial>=bounds.y0&&Math.min(...p.map(v=>v.y))-d.axial<=bounds.y1)
   const plan=planStreetParcels({id:`${path.id}:infill`,azimuth:d.azimuth,axial:d.axial,bounds,streets:[path],
    reserves:nearby.map(p=>p.map(v=>({...v,x:v.x-d.azimuth*radius,y:v.y-d.axial}))),seed:14092026,maximumFrontage:34},radius)
   land.push(plan)
   for(const parcel of plan.parcels){
    const p=parcel.building,seed=colonyBuildingSeed({azimuth:d.azimuth+p.x/radius,axial:d.axial+p.y} as CityBuilding)
    // Shallower masses retain the certified front edge and leave private land
    // behind. Mix height and width without using the visible building index.
    const depth=Math.min(p.depth,14+((seed>>>8)%7)*2),shift=(depth-p.depth)/2,side=parcel.front.side
    const nearJunction=parcel.front.t<.22||parcel.front.t>.78
    const b:CityBuilding={azimuth:d.azimuth+(p.x-Math.sin(p.yaw)*side*shift)/radius,
     axial:d.axial+p.y+Math.cos(p.yaw)*side*shift,width:p.width,depth,yaw:p.yaw,
     height:(nearJunction?12:9)+(seed%5)*3,front:{axis:'axial',side:side===1?-1:1},kind:(seed>>>5)%4===0?'setback':'block',
     urban:nearJunction?.7:.35,oldTown:0,tone:((seed>>>12)%65536)/65536,nativeDistrict:d.id,nativeParcel:parcel.id}
    candidates.push(b);fronts.set(parcel.id,parcel.front.streetId)
    reserves.push(...parcel.pieces.map(piece=>global(d,piece)))
   }
  }
  d.infill={land,buildings:0}
 }
 if(!candidates.length)return[]
 const before=certifyStreetAccess(city.buildings,city.streetNetwork,radius,6)
 const after=certifyStreetAccess([...city.buildings,...candidates],city.streetNetwork,radius,6),existing=new Set(city.buildings)
 if(after.rejected.some(r=>existing.has(r.building)&&!before.rejected.some(old=>old.building===r.building&&old.reason===r.reason)))throw Error('Arrival infill obstructs an existing entrance')
 const accepted=after.buildings.filter(b=>b.nativeParcel&&fronts.get(b.nativeParcel)===b.access.roadId)
 const available=Math.max(0,Math.floor(maximumBuildings-city.buildings.length))
 const selected=accepted.filter((_,i)=>accepted.length<=available||Math.floor(i*available/accepted.length)!==Math.floor((i-1)*available/accepted.length))
 city.buildings.push(...selected)
 for(const d of districts){const added=selected.filter(b=>b.nativeDistrict===d.id);d.buildings.push(...added);d.infill!.buildings=added.length}
 return selected
}
