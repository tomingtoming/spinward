import type {CityPlan} from './cityLayout'
import {ARRIVAL_CENTRAL,arrivalStreets,rebuildArrivalRegion} from './arrivalDistrict'
import {bandLivingPlaces} from './bandLivingPlaces'
import {buildingFootprint} from './streetFrontage'
import type {StreetPath} from './streetPath'
import type {StreetPolygon} from './streetPolygon'
import type {BandPoint} from './bandStreetPlan'
import shops from '../../assets/blender/neighborhood-fronts.json'
import blocks from '../../assets/blender/city-block.json'
import cafe from '../../assets/blender/cafe-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'

export const ARRIVAL_EAST_ID='district-arrival-east'
export const ARRIVAL_EAST={x0:ARRIVAL_CENTRAL[0].x1,x1:ARRIVAL_CENTRAL[0].x1*3,y0:ARRIVAL_CENTRAL[1].y1*2,y1:ARRIVAL_CENTRAL[0].y0}
const polygon=(p:BandPoint[]):StreetPolygon=>p.map(([x,y])=>({x,y,u:0,v:0}))

/** Migrate the inhabited eastern streets without moving interiors, their
 * stairs, or the adjacent Garden. Short destination frontages remain, while
 * the independent band plan supplies the roads between them. */
export function rebuildArrivalEast(city:CityPlan,radius:number,length:number){
  if(radius!==3200||length!==40000)return null
  const contracts=[cafe.interior.building,apartment.interior.building,shops.building,blocks.blocks[2].building]
  const buildings=contracts.map(c=>city.buildings.find(b=>Math.abs(b.azimuth-c.azimuth)<1e-9&&Math.abs(b.axial-c.axial)<1e-6))
  if(buildings.some(b=>!b))throw Error('Eastern living places are missing')
  const kept=buildings.map(b=>b!),places=bandLivingPlaces().filter(p=>p.id==='cafe'||p.id==='apartment')
  const shop=kept[2],old=city.streetNetwork!.streets.find(s=>s.id===shop.access!.roadId)!
  if(!old)throw Error('Shop frontage is missing')
  const x=old.azimuth*radius
  const crossings=arrivalStreets(radius,ARRIVAL_EAST_ID,ARRIVAL_EAST).flatMap(s=>{
    const [a,b]=s.knots.map(k=>k.point),t=(x-a[0])/(b[0]-a[0]),y=a[1]+t*(b[1]-a[1])
    return t>=0&&t<=1&&Math.abs(y-(shop.axial-shop.depth/2))<20?[y]:[]
  })
  if(crossings.length!==1)throw Error('Shop frontage needs a single band-road connection')
  const line=(id:string,from:BandPoint,to:BandPoint,source:StreetPath):StreetPath=>({...source,id:`${ARRIVAL_EAST_ID}:${id}`,azimuth:0,axial:0,
    knots:[from,to].map(point=>({point,tangent:[to[0]-from[0],to[1]-from[1]]}))})
  const civic=city.streetNetwork!.streets.find(s=>s.id==='district-arrival-core:civic-frontage')!
  const end=kept[3].azimuth*radius+kept[3].width/2+12
  const apartmentFront=places.find(p=>p.id==='apartment')!.frontage.from
  return rebuildArrivalRegion(city,radius,length,ARRIVAL_EAST_ID,ARRIVAL_EAST,true,{
    buildings:kept,
    streets:[line('shop-frontage',[x,crossings[0]],[x,shop.axial+shop.depth/2+3],old),
      line('civic-frontage',[ARRIVAL_EAST.x0,0],[end,0],civic),
      line('residential-link',apartmentFront,[end,0],old)],
    reserves:[...places.map(p=>polygon(p.reserve.polygon)),...kept.map(b=>buildingFootprint({...b,width:b.width+6,depth:b.depth+6}).map(v=>({...v,x:v.x+b.azimuth*radius,y:v.y+b.axial})))],
    entrances:places.map(p=>({id:`arrival-${p.id}`,building:kept.find(b=>Math.abs(b.access!.entrance.azimuth*radius-p.entrance[0])<1e-5&&Math.abs(b.access!.entrance.axial-p.entrance[1])<1e-5)!,reserve:polygon(p.reserve.polygon)}))
  })
}
