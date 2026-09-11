import {planBuildingInteriors} from './buildingInteriors'
import {matchesCafePilot,cafePilotPoint} from './cafePilot'
import {planRoomSeats} from '../app/roomSeating'
import type {CityPlan} from './cityLayout'
import type {LifeCrossing} from './neighborhoodLife'
import * as THREE from 'three'
export type JourneyPoint={azimuth:number;axial:number;height:number}
export function planResidentJourney(plan:CityPlan,radius:number,c:LifeCrossing){
 const interiors=[...planBuildingInteriors(plan.buildings,radius).values()]
 const room=interiors.find(i=>matchesCafePilot(i,radius))
 const seat=planRoomSeats(interiors,radius).find(s=>s.id==='cafe-1')
 if(!room||!seat)return null
 // A certified central doorway, then the aisle behind the cafe tables.
 const point=(x:number,z:number,height=.27):JourneyPoint=>{const p=cafePilotPoint(room,radius,new THREE.Vector3(x,height,z));return {azimuth:Math.atan2(p.z,p.x),axial:p.y,height}}
 const reach=c.halfWidth+.75
 const side=Math.sign(c.axis==='tangent'?room.building.axial-c.axial:room.building.azimuth-c.azimuth)
 const kerb=(s:number):JourneyPoint=>({azimuth:c.azimuth+(c.axis==='axial'?s*reach/radius:0),axial:c.axial+(c.axis==='tangent'?s*reach:0),height:.34})
 const outside=kerb(-side),inside=kerb(side)
 const home={...outside,azimuth:outside.azimuth+(c.axis==='tangent'?-8/radius:0),axial:outside.axial+(c.axis==='axial'?-8:0)}
 return {seat,room,points:[home,outside,inside,point(0,room.depth/2-1),point(0,-.1),{azimuth:seat.exit.azimuth,axial:seat.exit.axialPosition,height:.27}],side}
}
export type ResidentJourney=NonNullable<ReturnType<typeof planResidentJourney>>
/** Move on the unwrapped local surface, never through the cylinder interior. */
export function stepJourney(from:JourneyPoint,to:JourneyPoint,radius:number,distance:number){
 const x=Math.atan2(Math.sin(to.azimuth-from.azimuth),Math.cos(to.azimuth-from.azimuth))*radius,z=to.axial-from.axial,length=Math.hypot(x,z)
 const f=length>0?Math.min(1,Math.max(0,distance)/length):1
 return {point:{azimuth:from.azimuth+x*f/radius,axial:from.axial+z*f,height:from.height+(to.height-from.height)*f},heading:Math.atan2(x,z),arrived:f===1}
}
