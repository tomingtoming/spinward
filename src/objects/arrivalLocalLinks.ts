import type {CityPlan} from './cityLayout'
import {isArrivalStreet,clipArrivalRoad} from './arrivalDistrict'
import {refreshArrivalSurfaces} from './arrivalSeams'
import {planLocalStreetLinks} from './localStreetLinks'
import {buildingFootprint,certifyStreetAccess,streetAccessPolygons} from './streetFrontage'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {StreetNetwork} from './streetNetwork'
import type {StreetPolygon} from './streetPolygon'
import type {StreetPath} from './streetPath'

/** Add a lower road tier within already migrated land. Protect all candidate
 * lots, even those omitted by a cheaper building budget, so quality settings
 * cannot silently change the road topology. */
export function connectArrivalLocalStreets(city:CityPlan,radius:number,onRejected?:(from:string,to:string,reason:string)=>void){
 const districts=(city.nativeDistricts??[]).filter(d=>d.layout==='band-plan'&&d.streets.some(isArrivalStreet))
 if(!city.streetNetwork||!districts.length||districts.some(d=>d.localLinks))return{links:[],retired:[]}
 const bounds=districts.map(d=>({x0:d.azimuth*radius-d.width/2,x1:d.azimuth*radius+d.width/2,y0:d.axial-d.length/2,y1:d.axial+d.length/2}))
 const areas=bounds.map(b=>[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]].map(([x,y])=>({x,y,u:0,v:0})))
 const global=(at:{azimuth:number;axial:number},p:StreetPolygon)=>p.map(v=>({...v,x:v.x+at.azimuth*radius,y:v.y+at.axial}))
 const reserves=[
  ...captureBandPublicPlaces(city,radius).map(p=>p.reserve.polygon.map(([x,y])=>({x,y,u:0,v:0}))),
  ...districts.flatMap(d=>(d.land?.parcels??[]).map(p=>{
   const b=p.building;return global({azimuth:d.azimuth+b.x/radius,axial:d.axial+b.y},buildingFootprint({azimuth:0,axial:0,height:1,kind:'block',tone:0,...b,width:b.width+2,depth:b.depth+2}))
  })),
  ...city.buildings.filter(b=>districts.some(d=>Math.abs((b.azimuth-d.azimuth)*radius)<d.width/2+40&&Math.abs(b.axial-d.axial)<d.length/2+40)).flatMap(b=>[
   global(b,buildingFootprint({...b,width:b.width+2,depth:b.depth+2})),...b.access?streetAccessPolygons(b.access,radius).map(p=>global(b.access!.entrance,p)):[]]),
  ...city.entranceWalks?.flatMap(w=>[...w.pieces,...w.landingPieces].map(p=>global(w.source,p)))??[]
 ]
 const links=planLocalStreetLinks(city.streetNetwork,{areas,reserves,eligible:isArrivalStreet,maximumLength:650,minimumDetour:1.8,limit:4,onRejected})
 if(!links.length)return{links,retired:[]}
 // A new junction can supersede an unserved, metre-scale source spur beside
 // it. Keep every inhabited frontage and every longer destination branch.
 const retired=city.streetNetwork.streets.filter((p,i)=>isArrivalStreet(p)&&p.knots.length===2&&city.streetNetwork!.streetLengths[i]<20
  &&!city.buildings.some(b=>b.access?.roadId===p.id)
  &&city.streetNetwork!.closedEnds[i].some(Boolean)
  &&p.knots.some((k,j)=>!city.streetNetwork!.closedEnds[i][j as 0|1]&&links.some(l=>l.path.knots.some(v=>Math.hypot(v.point[0]-k.point[0],v.point[1]-k.point[1])<1e-5))))
 const removed=new Set(retired.map(p=>p.id))
 const added:StreetPath[]=[],owned=districts.map(()=>[] as StreetPath[])
 for(const l of links)for(const [i,b] of bounds.entries()){
  const ends=clipArrivalRoad(l.path.knots[0].point,l.path.knots[1].point,b)
  if(!ends)continue
  const [a,z]=ends,tangent:[number,number]=[z[0]-a[0],z[1]-a[1]]
  const path={...l.path,id:`${districts[i].id}:${l.path.id}`,knots:ends.map(point=>({point,tangent}))}
  added.push(path);owned[i].push(path)
 }
 const before=certifyStreetAccess(city.buildings,city.streetNetwork,radius,6)
 const network=new StreetNetwork([...city.streetNetwork.streets.filter(p=>!removed.has(p.id)),...added],radius),after=certifyStreetAccess(city.buildings,network,radius,6)
 if(after.rejected.some(r=>!before.rejected.some(old=>old.building===r.building&&old.reason===r.reason)))throw Error('A local street obstructs an existing entrance')
 if(new Set(network.components).size!==new Set(city.streetNetwork.components).size)throw Error('A local street changed a separate land band')
 const access=new Map(after.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b.access]))
 const ids=new Map(network.streets.map((p,i)=>[p.id,i]))
 city.buildings=city.buildings.map(b=>{
  const a=access.get(`${b.azimuth}:${b.axial}`)??b.access;if(!a||!ids.has(a.roadId))throw Error('A local street retired an inhabited frontage')
  return {...b,access:{...a,roadIndex:ids.get(a.roadId)!}}
 })
 city.streetNetwork=network
 for(const [i,d] of districts.entries()){
  d.streets=d.streets.filter(p=>!removed.has(p.id));d.streets.push(...owned[i]);d.localLinks=links.filter(l=>owned[i].some(p=>p.id.endsWith(`:${l.path.id}`))).map(l=>({id:l.path.id,from:l.from,to:l.to,before:l.before,after:l.after}))
 }
 refreshArrivalSurfaces(city,radius)
 return {links,retired:retired.map(p=>p.id)}
}
