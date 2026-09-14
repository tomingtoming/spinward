import type {CityPlan} from './cityLayout'
import {ARRIVAL_WEST,ARRIVAL_CENTRAL,rebuildArrivalRegion} from './arrivalDistrict'
import {retireArrivalSeams} from './arrivalSeams'
import {proposedBandLand} from './bandLand'
import {bandReservePieces} from './bandParcels'
import {clipStreetPolygon,polygonArea} from './streetPolygon'

export const ARRIVAL_SOUTHERN_CORRIDOR_ID='district-arrival-southern-corridor'
export const ARRIVAL_SOUTHERN_CORRIDOR={x0:ARRIVAL_WEST.x0,x1:ARRIVAL_CENTRAL[0].x1,
  y0:-3534.193548387097,y1:ARRIVAL_WEST.y0}

/** A migration envelope reaches the next whole-band centre. Its old perimeter
 * only connects the remaining city; interior roads come from the band plan. */
export function arrivalSouthernReserves(){
  const b=ARRIVAL_SOUTHERN_CORRIDOR
  return proposedBandLand().reserves.flatMap(bandReservePieces).map(p=>{
    p=clipStreetPolygon(p,1,0,-b.x0);p=clipStreetPolygon(p,-1,0,b.x1)
    p=clipStreetPolygon(p,0,1,-b.y0);return clipStreetPolygon(p,0,-1,b.y1)
  }).filter(p=>polygonArea(p)>1e-5)
}

/** Apply after the inhabited arrival streets and their local infill, keeping
 * those existing lots out of the new region's subdivision and traffic budget. */
export function rebuildArrivalSouthernCorridor(city:CityPlan,radius:number,length:number){
  if(radius!==3200||length!==40000)return null
  const result=rebuildArrivalRegion(city,radius,length,ARRIVAL_SOUTHERN_CORRIDOR_ID,ARRIVAL_SOUTHERN_CORRIDOR,true,
    {buildings:[],streets:[],reserves:arrivalSouthernReserves()})
  if(!result)return null
  const seams=retireArrivalSeams(city,radius)
  return {...result,seams}
}
