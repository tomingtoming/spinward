import type {CityPlan} from './cityLayout'
import type {CrossingGate} from './trafficMotion'
const wrap=(x:number)=>Math.atan2(Math.sin(x),Math.cos(x))
export type NeighborhoodTurn={azimuth:number;axial:number;radius:number;halfWidth:number}
/** One nearby main-road junction, with a right turn into the cafe street. */
export function planNeighborhoodTurn(plan:CityPlan,radius:number,c:CrossingGate):NeighborhoodTurn|null{
 if(c.axis!=='tangent')return null
 const roads=plan.roads.filter(r=>r.axialLength>r.tangentWidth&&r.kind==='collector'&&Math.abs(r.axial-c.axial)<r.axialLength/2-90&&wrap(r.azimuth-c.azimuth)*radius>20&&wrap(r.azimuth-c.azimuth)*radius<150)
 roads.sort((a,b)=>wrap(a.azimuth-c.azimuth)-wrap(b.azimuth-c.azimuth))
 return roads[0]?{azimuth:roads[0].azimuth,axial:c.axial,radius,halfWidth:roads[0].tangentWidth/2}:null
}
export const TURN_APPROACH=90,TURN_RADIUS=6,TURN_ARC=Math.PI*TURN_RADIUS/2,TURN_LENGTH=TURN_APPROACH+TURN_ARC+300
export function sampleNeighborhoodTurn(j:NeighborhoodTurn,progress:number){
 const p=Math.max(0,Math.min(TURN_LENGTH,progress)),r=TURN_RADIUS
 let x=-1.5,z=-1.5-r-TURN_APPROACH+p,heading=0
 if(p>=TURN_APPROACH){const t=Math.min(Math.PI/2,(p-TURN_APPROACH)/r);x=-1.5-r+r*Math.cos(t);z=-1.5-r+r*Math.sin(t);heading=-t}
 if(p>TURN_APPROACH+TURN_ARC){x-=p-TURN_APPROACH-TURN_ARC;heading=-Math.PI/2}
 return {azimuth:j.azimuth+x/j.radius,axial:j.axial+z,heading,height:.2}
}
export function junctionMajorBusy(j:NeighborhoodTurn,cars:readonly {azimuth:number;axial:number;speed:number;height:number}[]){
 return cars.some(v=>v.height<1&&Math.abs(wrap(v.azimuth-j.azimuth)*j.radius)<j.halfWidth&&Math.abs(v.axial-j.axial)<8+Math.abs(v.speed)*2)
}
/** Include the stop line itself: arrival must not grant priority next frame. */
export function turnYieldGap(progress:number,busy:boolean){
 return busy&&progress<=TURN_APPROACH?TURN_APPROACH-progress+3.2:Infinity
}
