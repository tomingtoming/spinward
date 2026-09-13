export type TrafficPedestrian = { azimuth:number; axial:number; height:number }
type Car = TrafficPedestrian & { heading:number }
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const HALF_CORRIDOR=1.4 // widest 2m car + instance scale + the 0.32m body
const STOP_CENTRE=3.75 // 2.7m vehicle nose + body radius + standing clearance
const LOOK_AHEAD=45

/** One nearby body, in colony metres. Optional samples follow the actual bend
 * and its elevation, so extending a turn's tangent cannot stop for a sidewalk.
 * The result uses advanceTraffic's existing 3.2m centre-gap convention. */
export function trafficPedestrianGap(car:Car,person:TrafficPedestrian|null,radius:number,
 sampleAhead?:(distance:number)=>TrafficPedestrian,maxAhead=LOOK_AHEAD):number{
 if(!person)return Infinity
 const x=wrap(person.azimuth-car.azimuth)*radius,y=person.axial-car.axial
 if(Math.abs(x)>LOOK_AHEAD+2||Math.abs(y)>LOOK_AHEAD+2)return Infinity
 // Covers the 2.3m delivery truck at the fleet's maximum 1.03 scale too.
 const supported=(height:number)=>person.height-height<2.4&&person.height+1.7>height
 if(!sampleAhead){
  if(!supported(car.height))return Infinity
  const along=x*Math.sin(car.heading)+y*Math.cos(car.heading),across=x*Math.cos(car.heading)-y*Math.sin(car.heading)
  return along>=0&&along<=LOOK_AHEAD&&Math.abs(across)<HALF_CORRIDOR?Math.max(0,along-STOP_CENTRE+3.2):Infinity
 }
 let a:TrafficPedestrian=car,from=0
 const limit=Math.min(LOOK_AHEAD,maxAhead)
 for(let end=Math.min(2,limit);end>from;end=Math.min(end+2,limit)){
  const b=sampleAhead(end),ax=wrap(a.azimuth-car.azimuth)*radius,ay=a.axial-car.axial
  const dx=wrap(b.azimuth-a.azimuth)*radius,dy=b.axial-a.axial,den=dx*dx+dy*dy
  if(den>1e-8){
   const raw=((x-ax)*dx+(y-ay)*dy)/den,t=Math.max(0,Math.min(1,raw))
   if(raw>=0&&raw<=1&&supported(a.height+(b.height-a.height)*t)&&Math.hypot(x-ax-dx*t,y-ay-dy*t)<HALF_CORRIDOR)
    return Math.max(0,from+(end-from)*t-STOP_CENTRE+3.2)
  }
  a=b;from=end
 }
 return Infinity
}
