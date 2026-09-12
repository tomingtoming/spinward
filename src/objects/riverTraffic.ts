import type {CityPlan, CityRoad} from './cityLayout'
import {sampleCitySurface} from './citySurfaceMesh'
import {riverRoadGeometry, type RiverDistrict} from './riverDistrictPlan'
import {streetLaneCenters} from './streetProfile'

type Point = {x:number; y:number; h:number; distance:number; cruise:number}
export type TrafficPosition = {azimuth:number; axial:number; height:number; heading:number; speed:number}
type Gate = {stop:number; x:number; y:number; heading:number; crossing:boolean}
export type RiverTrafficLoop = {
  azimuth:number; axial:number; radius:number; points:Point[]; length:number; gates:Gate[]
  north:CityRoad; bridgeStart:number; bridgeEnd:number
}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const modulo=(a:number,n:number)=>(a%n+n)%n

/** A real closed circuit: western avenue -> bridge -> eastern avenue -> an
 * existing collector -> western avenue. No repeat seam at either bridge end.
 * Use the wider collector for the return turn; the first narrow local corner
 * cannot carry this wheelbase without mounting its pavement. */
export function planRiverTraffic(p:RiverDistrict|null,city:CityPlan,radius:number):RiverTrafficLoop|null {
  if(!p)return null
  const [west,east]=p.connections,road=riverRoadGeometry(p,radius)
  const north=city.roads.filter(r=>r.kind==='collector'&&r.tangentWidth>r.axialLength&&
    r.axial>p.axial+150&&r.axial<p.axial+700&&Math.abs(wrap(r.azimuth-p.azimuth))*radius+140<r.tangentWidth/2)
    .sort((a,b)=>a.axial-b.axial)[0]
  if(!north)return null
  // This bounded route uses unsignalled streets. Future arterial connections
  // must first integrate their actual signal phases, not silently ignore them.
  if(city.roads.some(r=>r.kind==='arterial'&&r.tangentWidth>r.axialLength&&r.axial>p.axial-40&&r.axial<north.axial+1))return null
  const wx=wrap(west.azimuth-p.azimuth)*radius+streetLaneCenters(west.kind,1,radius).at(-1)!
  const ex=wrap(east.azimuth-p.azimuth)*radius-streetLaneCenters(east.kind,1,radius)[0]
  const top=north.axial-p.axial-streetLaneCenters(north.kind,1,radius)[0]
  // Tuck the turning line 0.4m inward at each narrow mouth. Both tyres stay
  // on asphalt, then ease back to the regular lane centre over twelve metres.
  const offsetAt=(x:number)=>1.25+.4*Math.min(1,Math.max(0,(Math.min(x-road.left,road.right-x)-4)/12))
  const ly=road.point(road.left,1.25)[1],ry=road.point(road.right,1.25)[1],r=5
  const carriageway=p.surfaces.filter(s=>s.material==='road').map(s=>s.collider)
  const loop:RiverTrafficLoop={azimuth:p.azimuth,axial:p.axial,radius,points:[],length:0,gates:[],north,bridgeStart:0,bridgeEnd:0}
  const add=(x:number,y:number,cruise:number)=>{
    let h=.2
    if(x>=road.left-2&&x<=road.right+2&&Math.abs(y)<50)
      for(const b of carriageway)h=Math.max(h,sampleCitySurface(b.surfaceMesh!,x-wrap(b.azimuth-p.azimuth)*radius,y-(b.axial-p.axial)))
    const last=loop.points.at(-1),distance=last?last.distance+Math.hypot(x-last.x,y-last.y,h-last.h):0
    if(last&&distance-last.distance<1e-6)return
    loop.points.push({x,y,h,cruise,distance})
  }
  const line=(ax:number,ay:number,bx:number,by:number,cruise=7)=>{
    const n=Math.ceil(Math.hypot(bx-ax,by-ay)/.5)
    for(let i=0;i<=n;i++)add(ax+(bx-ax)*i/n,ay+(by-ay)*i/n,cruise)
  }
  const arc=(x:number,y:number,start:number)=>{
    for(let i=0;i<=32;i++){const a=start+Math.PI/2*i/32;add(x+r*Math.cos(a),y+r*Math.sin(a),3)}
  }
  arc(wx+r,ly+r,Math.PI)
  loop.bridgeStart=loop.points.at(-1)!.distance
  const n=Math.ceil((ex-r-wx-r)/.5)
  for(let i=0;i<=n;i++){const at=wx+r+(ex-r-wx-r)*i/n,[x,y]=road.point(at,offsetAt(at));add(x,y,5)}
  loop.bridgeEnd=loop.points.at(-1)!.distance
  loop.gates.push({stop:loop.bridgeEnd,x:ex,y:ry+r,heading:0,crossing:false})
  arc(ex-r,ry+r,-Math.PI/2)
  line(ex,ry+r,ex,top-r)
  loop.gates.push({stop:loop.points.at(-1)!.distance,x:ex-r,y:top,heading:-Math.PI/2,crossing:false})
  arc(ex-r,top-r,0)
  line(ex-r,top,wx+r,top)
  loop.gates.push({stop:loop.points.at(-1)!.distance,x:wx,y:top-r,heading:Math.PI,crossing:false})
  arc(wx+r,top-r,Math.PI/2)
  line(wx,top-r,wx,ly+r)
  loop.length=loop.points.at(-1)!.distance
  // Intermediate local crossings yield to cross traffic. Cars past the stop
  // continue through; a new arrival must never strand a car in the junction.
  for(const crossing of city.roads.filter(v=>v.tangentWidth>v.axialLength&&v.axial>p.axial+50&&v.axial<north.axial-20)){
    for(const [x,direction]of [[ex,1],[wx,-1]]){
      if(Math.abs(wrap(p.azimuth+x/radius-crossing.azimuth))*radius>crossing.tangentWidth/2)continue
      const y=crossing.axial-p.axial,stopY=y-direction*(crossing.axialLength/2+3)
      const closest=loop.points.reduce((a,b)=>Math.hypot(b.x-x,b.y-stopY)<Math.hypot(a.x-x,a.y-stopY)?b:a)
      loop.gates.push({stop:closest.distance,x,y,heading:direction===1?0:Math.PI,crossing:true})
    }
  }
  return loop
}

function pointAt(loop:RiverTrafficLoop,progress:number){
  const s=modulo(progress,loop.length),points=loop.points
  let lo=0,hi=points.length-1
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(points[mid].distance<=s)lo=mid;else hi=mid}
  const a=points[lo],b=points[hi],t=(s-a.distance)/(b.distance-a.distance)
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,h:a.h+(b.h-a.h)*t,cruise:Math.min(a.cruise,b.cruise),index:lo,distance:s}
}
export function sampleRiverTraffic(loop:RiverTrafficLoop,progress:number){
  const p=pointAt(loop,progress),back=pointAt(loop,progress-1.25),front=pointAt(loop,progress+1.25)
  let cruise=p.cruise
  for(let i=1;i<90;i++){
    const q=loop.points[(p.index+i)%loop.points.length],ahead=modulo(q.distance-p.distance,loop.length)
    if(ahead>20)break
    cruise=Math.min(cruise,Math.sqrt(q.cruise*q.cruise+6*ahead))
  }
  return {azimuth:loop.azimuth+p.x/loop.radius,axial:loop.axial+p.y,height:(back.h+front.h)/2,
    heading:Math.atan2(front.x-back.x,front.y-back.y),slope:Math.atan2(front.h-back.h,Math.hypot(front.x-back.x,front.y-back.y)),
    cruise}
}

/** World-space following also sees cars merging from a different route. */
export function trafficFollowingGap(own:TrafficPosition,cars:readonly TrafficPosition[],radius:number){
  let gap=Infinity
  for(const v of cars){
    if(Math.abs(v.height-own.height)>1)continue
    const dx=wrap(v.azimuth-own.azimuth)*radius,dy=v.axial-own.axial
    const along=dx*Math.sin(own.heading)+dy*Math.cos(own.heading),across=dx*Math.cos(own.heading)-dy*Math.sin(own.heading)
    if(along>0&&Math.abs(across)<2.2)gap=Math.min(gap,along-2)
  }
  return gap
}
export function riverTrafficYieldGap(loop:RiverTrafficLoop,progress:number,cars:readonly TrafficPosition[]){
  const s=modulo(progress,loop.length)
  let gap=Infinity
  for(const gate of loop.gates){
    const ahead=gate.stop-s
    if(ahead<-.01||ahead>45)continue
    const busy=cars.some(v=>{
      if(v.height>1)return false
      const dx=wrap(v.azimuth-loop.azimuth)*loop.radius-gate.x,dy=v.axial-loop.axial-gate.y
      if(gate.crossing){
        if(Math.abs(Math.sin(v.heading-gate.heading))<.5)return false
        const along=dx*Math.sin(v.heading)+dy*Math.cos(v.heading),across=dx*Math.cos(v.heading)-dy*Math.sin(v.heading)
        return Math.abs(across)<4&&along>-10-v.speed*2&&along<8
      }
      const along=dx*Math.sin(gate.heading)+dy*Math.cos(gate.heading),across=dx*Math.cos(gate.heading)-dy*Math.sin(gate.heading)
      return Math.abs(across)<2.2&&along>-10-v.speed*2&&along<10
    })
    if(busy)gap=Math.min(gap,Math.max(0,ahead)+3.2)
  }
  return gap
}
