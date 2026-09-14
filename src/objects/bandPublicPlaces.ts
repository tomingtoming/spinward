import {getPlazaAxialHalfLength,getPlazaTangentHalfWidth,type CityPlan} from './cityLayout'
import {centralPlazaArrival} from './civicArrival'
import {PARK_PATH_HEIGHT,planPublicPark} from './publicPark'
import {planCurvedNeighborhood} from './curvedNeighborhood'
import {planRiverDistrict} from './riverDistrictPlan'
import snapshot from '../../assets/planning/public-places.json'
import {riverWalkGraph} from '../app/riverWalkRoute'
import type {BandPoint,BandReserve,BandAccess} from './bandStreetPlan'

export type BandPublicPlace={id:'square'|'park'|'garden'|'riverside';footprint:BandPoint[];entrances:BandPoint[];walkingEntrances:{point:BandPoint;height:number}[];reserve:BandReserve;accesses:BandAccess[];sharedReserve?:'river'}
const rect=(x:number,y:number,w:number,d:number):BandPoint[]=>[[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2]]
/** Capture existing public-space contracts before changing the streets used
 * to find them. A missing destination is a failed migration, not a new empty
 * parcel. This operates on the current city, without mutating it. */
export function captureBandPublicPlaces(city:CityPlan,radius:number):BandPublicPlace[]{
  const park=planPublicPark(city,radius),garden=planCurvedNeighborhood(city,radius),river=planRiverDistrict(city,radius)
  if(!park||!garden||!river)throw Error('Existing public destinations are required for the band migration')
  const place=(id:BandPublicPlace['id'],x:number,y:number,w:number,d:number,entrances:BandPoint[],gates:BandPoint[],sharedReserve?:'river'):BandPublicPlace=>({
    id,footprint:rect(x,y,w,d),entrances,walkingEntrances:[],reserve:{id:`public-${id}`,kind:'green',polygon:rect(x,y,w+40,d+40)},
    accesses:gates.map((point,i)=>({id:`public-${id}-gate-${i}`,point,serves:['arrival']})),...(sharedReserve?{sharedReserve}:{})})
  const at=centralPlazaArrival(radius),p=park.patch,g=garden.patch
  const square=place('square',0,0,getPlazaTangentHalfWidth(radius)*2,getPlazaAxialHalfLength(radius)*2,[[at.azimuth*radius,at.axialPosition]],[[0,-getPlazaAxialHalfLength(radius)-20]])
  const parkEntrance:BandPoint=[park.azimuth*radius+park.entrance.x,park.axial+park.entrance.y]
  const parkGate:BandPoint=[parkEntrance[0]-park.forward.x*22,parkEntrance[1]-park.forward.y*22]
  const gardenEntrances:BandPoint[]=garden.streetLinks.map(s=>[s.azimuth*radius+s.knots[0].point[0],s.axial+s.knots[0].point[1]])
  const gardenGates:BandPoint[]=gardenEntrances.map(([,y],i)=>[g.azimuth*radius+(i?1:-1)*(g.tangentExtent/2+20),y])
  const places=[square,place('park',p.azimuth*radius,p.axial,p.tangentExtent,p.axialExtent,[parkEntrance],[parkGate]),
    place('garden',g.azimuth*radius,g.axial,g.tangentExtent,g.axialExtent,gardenEntrances,gardenGates),
    // The river already has one continuous reservation and its bridge gate.
    // A second overlapping reservation would reject that legitimate crossing.
    place('riverside',river.azimuth*radius,river.axial,river.width,river.length,
      river.connections.map(s=>[s.azimuth*radius,river.axial]),[],'river')]
  places[0].walkingEntrances=[{point:square.entrances[0],height:0}]
  places[1].walkingEntrances=[{point:parkEntrance,height:PARK_PATH_HEIGHT}]
  places[2].walkingEntrances=garden.walkConnections.map(c=>{const [x,y,height]=c.points.at(-1)!;return{point:[garden.azimuth*radius+x,garden.axial+y],height}})
  const walks=riverWalkGraph(river,radius)
  places[3].walkingEntrances=walks.portals.map(i=>{const p=walks.nodes[i];return{point:[river.azimuth*radius+p.x,river.axial+p.y],height:p.h}})
  return places
}

/** A captured contract avoids regenerating the old city inside every new
 * planning run. Regression tests compare it to all inhabited quality budgets;
 * refresh explicitly with qa/neighborhood-life/capture-public-places.ts. */
export function bandPublicPlaces():BandPublicPlace[]{
  return structuredClone(snapshot.places) as BandPublicPlace[]
}
