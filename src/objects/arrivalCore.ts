import type {CityPlan} from './cityLayout'
import {ARRIVAL_CENTRAL,rebuildArrivalRegion} from './arrivalDistrict'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {preserveCityPlaces} from './cityPlaces'
import {buildingFootprint} from './streetFrontage'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {certifyEntranceWalk} from './streetEntranceWalk'
import type {StreetPath} from './streetPath'
import type {BandPoint} from './bandStreetPlan'
import type {StreetPolygon} from './streetPolygon'
import {getStreetProfile} from './streetProfile'
import blocks from '../../assets/blender/city-block.json'

export const ARRIVAL_CORE_ID='district-arrival-core'
export const ARRIVAL_CORE={x0:ARRIVAL_CENTRAL[0].x0,x1:ARRIVAL_CENTRAL[0].x1,y0:ARRIVAL_CENTRAL[1].y1,y1:ARRIVAL_CENTRAL[0].y0}
const polygon=(p:BandPoint[]):StreetPolygon=>p.map(([x,y])=>({x,y,u:0,v:0}))

/** Keep the inhabited civic frontage, while replacing the streets around it
 * with the band plan. The frontage is a short destination branch; it does not
 * constrain the upstream road generator or retain the old grid's other rows. */
export function rebuildArrivalCore(city:CityPlan,radius:number,length:number){
  if(radius!==3200||length!==40000)return null
  const places=captureBandPublicPlaces(city,radius).slice(0,2)
  const park=preserveCityPlaces(city,radius).park!,patch=park.patch
  const patches=city.patches.filter(p=>p.azimuth===patch.azimuth&&p.axial===patch.axial)
  const trees=city.trees.filter(t=>Math.abs((t.azimuth-patch.azimuth)*radius)<=patch.tangentExtent/2&&Math.abs(t.axial-patch.axial)<=patch.axialExtent/2)
  const buildings=city.buildings.filter(b=>blocks.blocks.some(c=>Math.abs(b.azimuth-c.building.azimuth)<1e-9&&Math.abs(b.axial-c.building.axial)<1e-6))
  if(buildings.length!==3)throw Error('Civic frontage buildings are missing')
  const street=(id:string,from:BandPoint,to:BandPoint):StreetPath=>({id:`${ARRIVAL_CORE_ID}:${id}`,azimuth:0,axial:0,kind:'arterial',width:getStreetProfile('arterial',radius).carriageway,level:0,groundHeight:0,walkHeight:.32,
    knots:[from,to].map(point=>({point,tangent:[to[0]-from[0],to[1]-from[1]]}))})
  const result=rebuildArrivalRegion(city,radius,length,ARRIVAL_CORE_ID,ARRIVAL_CORE,false,{
    buildings,patches,trees,streets:[street('square-approach',[0,-34],[0,0]),street('civic-frontage',[0,0],[ARRIVAL_CORE.x1,0])],
    reserves:[...places.map(p=>polygon(p.footprint)),...buildings.map(b=>buildingFootprint({...b,width:b.width+6,depth:b.depth+6}).map(v=>({...v,x:v.x+b.azimuth*radius,y:v.y+b.axial})))]
  })
  if(!result)return null
  const p=places.find(p=>p.id==='park')!,normal={x:-park.forward.x,y:-park.forward.y}
  const path=park.paths.find(s=>Math.abs(park.entrance.x-s.x)<=s.width/2+1e-6&&Math.abs(park.entrance.y-s.y)<=s.depth/2+1e-6)
  if(!path)throw Error('Park entrance path is missing')
  // Join the rendered path's actual end, not the visit point inside it.
  const extension=normal.x?(path.x+normal.x*path.width/2-park.entrance.x)/normal.x:(path.y+normal.y*path.depth/2-park.entrance.y)/normal.y
  const x=p.entrances[0][0]+normal.x*extension,y=p.entrances[0][1]+normal.y*extension
  const nearby=city.streetNetwork!.streets.filter(s=>s.knots.some(k=>Math.hypot(s.azimuth*radius+k.point[0]-x,s.axial+k.point[1]-y)<400))
  const surface=new StreetSurfacePlan(nearby,radius,true)
  const global=(s:ReturnType<StreetSurfacePlan['sidewalks']>[number])=>s.polygon.map(v=>({...v,x:v.x+s.source.azimuth*radius,y:v.y+s.source.axial}))
  const walk=certifyEntranceWalk({id:'arrival-park',entrance:{x,y},normal,width:normal.x?path.depth:path.width,startHeight:p.walkingEntrances[0].height,maxGap:30,
    sidewalks:surface.sidewalks().map(s=>({polygon:global(s),height:s.lift})),carriageways:surface.roadSurfaces().map(global),
    allowed:[polygon(p.reserve.polygon)],obstacles:city.buildings.filter(b=>Math.hypot(b.azimuth*radius-x,b.axial-y)<80).map(b=>buildingFootprint(b).map(v=>({...v,x:v.x+b.azimuth*radius,y:v.y+b.axial})))},radius)
  if(!walk.walk)throw Error(`Arrival park connection: ${walk.rejected}`)
  city.entranceWalks=[...city.entranceWalks??[],walk.walk]
  return result
}
