import type { RiverDistrict } from '../objects/riverDistrictPlan'
import { routeThroughRiver } from './riverWalkRoute'
import { getStreetProfile } from '../objects/streetProfile'
import type { CityPlan } from '../objects/cityLayout'
import type { PublicPark } from '../objects/publicPark'
import type { CarShareBay } from '../objects/carShare'
import { UNDERPASS_HEIGHT, type PublicUnderpass } from '../objects/publicUnderpass'
import { CROSSWALK_LENGTH_METERS, CROSSWALK_SETBACK_METERS } from '../objects/intersectionSignals'

export type SurfacePoint = { azimuth: number; axial: number; groundHeight?: number; crosswalk?: boolean; coveredWalk?: boolean; riverWalk?: 'bridge' | 'upper' | 'ramp' | 'bank' }
export const OUTING_DESTINATIONS = [
  { id: 'guide-square', label: 'Central Square' },
  { id: 'guide-cafe', label: 'Café' },
  { id: 'guide-park', label: 'Park' },
  { id: 'guide-car', label: 'Your car' },
  { id: 'guide-river', label: 'Riverside' }
] as const
export type GuideAction = typeof OUTING_DESTINATIONS[number]['id']
export type OutingAction = GuideAction | 'guide-cancel' | 'drive-mode-toggle' | 'park-car'
export type OutingDestination = { label: string; entrance: SurfacePoint; bay: CarShareBay | null }
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export const surfaceDistance = (a: SurfacePoint, b: SurfacePoint, radius: number) => Math.hypot(wrapAngle(a.azimuth-b.azimuth)*radius, a.axial-b.axial)

/** Local, bounded route search on actual generated streets. Pavements win on
 * foot; arterials and collectors can only be crossed at painted crossings.
 * Buildings remain obstacles; an indoor start leaves via its certified door.
 * This is guidance only: it never moves the player or drives the car. */
export function planNeighborhoodRoute(plan: CityPlan, radius: number, start: SurfacePoint, goal: SurfacePoint,
  driving: boolean, park: PublicPark | null = null, underpass: PublicUnderpass | null = null, river: RiverDistrict | null = null): SurfacePoint[] | null {
  if (river && !driving) {
    const route = routeThroughRiver(river, radius, start, goal,
      (a, b) => planNeighborhoodRoute(plan, radius, a, b, false, park, underpass))
    if (route !== undefined) return route
  }
  // The central square omits its junction markings, so the next crossing can
  // be a full city block away. Include that detour; the cell cap still applies.
  const step = 2, pad = driving ? 100 : 400
  const gx = wrapAngle(goal.azimuth-start.azimuth)*radius, gy = goal.axial-start.axial
  if (Math.abs(gx)>1600 || Math.abs(gy)>1600) return null
  const linkX=underpass?wrapAngle(underpass.azimuth-start.azimuth)*radius:Infinity
  const linkY=underpass?underpass.axial-start.axial:Infinity
  const link=!driving&&underpass&&Math.abs(linkX-gx/2)<underpass.length/2+Math.abs(gx)/2+pad&&Math.abs(linkY-gy/2)<Math.abs(gy)/2+pad?underpass:null
  // A 2.6 m walkway has a 1.9 m body-clear band. Align a grid row with its
  // centre so sub-cell phase cannot erase it or push the route onto the rail.
  const anchorY=link?linkY:0
  const minX = Math.floor((Math.min(0,gx)-pad)/step)*step, minY = anchorY+Math.floor((Math.min(0,gy)-pad-anchorY)/step)*step
  const nx = Math.ceil((Math.max(0,gx)+pad-minX)/step)+1, ny = Math.ceil((Math.max(0,gy)+pad-minY)/step)+1
  if (nx*ny>600000) return null
  const cost = new Uint8Array(nx*ny)
  const local = (p: SurfacePoint) => [wrapAngle(p.azimuth-start.azimuth)*radius, p.axial-start.axial]
  const paint = (x:number,y:number,w:number,h:number,value:number) => {
    const x0=Math.max(0,Math.ceil((x-w/2-minX)/step)), x1=Math.min(nx-1,Math.floor((x+w/2-minX)/step))
    const y0=Math.max(0,Math.ceil((y-h/2-minY)/step)), y1=Math.min(ny-1,Math.floor((y+h/2-minY)/step))
    if(x1<x0 || y1<y0)return
    for(let j=y0;j<=y1;j++) cost.fill(value,j*nx+x0,j*nx+x1+1)
  }
  const roads = plan.roads.map(r=>({r,x:wrapAngle(r.azimuth-start.azimuth)*radius,y:r.axial-start.axial}))
    .filter(({r,x,y})=>Math.abs(x-(gx/2))<r.tangentWidth/2+Math.abs(gx)/2+pad+4 && Math.abs(y-(gy/2))<r.axialLength/2+Math.abs(gy)/2+pad+4)
  if (!driving) for(const {r:road,x,y} of roads) {
    const pavement=getStreetProfile(road.kind,radius).sidewalk
    if(pavement)paint(x,y,road.tangentWidth+pavement*2,road.axialLength+pavement*2,1)
  }
  // The certified plan already excludes buildings, trees and the access ramp.
  // Only the main through path participates; seats and the rail plinth do not.
  if(link)paint(linkX,linkY,link.length,link.width-.7,2)
  for(const {r,x,y} of roads) paint(x,y,r.tangentWidth-(driving?2.2:0),r.axialLength-(driving?2.2:0),driving?1:4)
  if (!driving) {
    // Apply after ALL roads: a side street must not punch an unmarked path
    // across a larger carriageway. Shared lanes and local streets stay usable.
    for(const {r,x,y} of roads) if(r.kind==='arterial'||r.kind==='collector')
      paint(x,y,r.tangentWidth,r.axialLength,0)
    for(const crossing of plan.intersections) {
      const [x,y]=local(crossing)
      if(x<minX-30||x>minX+(nx-1)*step+30||y<minY-30||y>minY+(ny-1)*step+30)continue
      // Same setback/length as the rendered stripes, with 30 cm each side
      // reserved for the walker's body. Ends join the real pavement bands.
      const width=CROSSWALK_LENGTH_METERS-.6, offset=CROSSWALK_SETBACK_METERS+CROSSWALK_LENGTH_METERS/2
      for(const side of [-1,1]) {
        paint(x,y+side*(crossing.streetWidth/2+offset),crossing.avenueWidth+4,width,3)
        paint(x+side*(crossing.avenueWidth/2+offset),y,width,crossing.streetWidth+4,3)
      }
    }
    // The supported civic arrival occupies the pedestrian corner of the square.
    const squareX=wrapAngle(-start.azimuth)*radius, squareY=-start.axial
    paint(squareX+13.25,squareY+12.25,6,5,1)
    if(park) for(const p of park.paths) paint(wrapAngle(park.azimuth-start.azimuth)*radius+p.x,park.axial-start.axial+p.y,p.width,p.depth,1)
  }
  let indoorExit: SurfacePoint[] = []
  for(const b of plan.buildings) {
    const [x,y]=local(b)
    if (Math.abs(x-gx/2)>b.width/2+Math.abs(gx)/2+pad+3 || Math.abs(y-gy/2)>b.depth/2+Math.abs(gy)/2+pad+3) continue
    paint(x,y,b.width+(driving?2.2:.8),b.depth+(driving?2.2:.8),0)
    if(!driving && Math.abs(x)<b.width/2+.5 && Math.abs(y)<b.depth/2+.5 && b.access) {
      // Keep the initial leg inside this one interior, then pass through its
      // real opening. No blanket permission to walk through other buildings.
      const door=b.access.entrance, edge=b.access.roadEdge
      const aligned = b.front?.axis==='axial' ? {azimuth:door.azimuth,axial:start.axial} : {azimuth:start.azimuth,axial:door.axial}
      indoorExit=[start,aligned,door,edge]
    }
  }
  const nearest = (p:SurfacePoint) => {
    const [x,y]=local(p), ix=Math.round((x-minX)/step), iy=Math.round((y-minY)/step)
    let best=-1, distance=Infinity
    for(let j=iy-2;j<=iy+2;j++)for(let i=ix-2;i<=ix+2;i++) {
      if(i<0||j<0||i>=nx||j>=ny||!cost[j*nx+i]) continue
      // Do not snap across the handrail, or from the motorway above, onto the
      // new link. An endpoint must already be in the walk's clear strip.
      if(cost[j*nx+i]===2&&link&&(Math.abs(x-linkX)>link.length/2||Math.abs(y-linkY)>(link.width-.7)/2||
        p.groundHeight!==undefined&&Math.abs(p.groundHeight-UNDERPASS_HEIGHT)>.6))continue
      const d=Math.hypot(minX+i*step-x,minY+j*step-y)
      if(d<distance && d<4){best=j*nx+i;distance=d}
    }
    return best
  }
  const from = nearest(indoorExit.at(-1)??start), to=nearest(goal)
  if(from<0||to<0)return null
  const distance = new Float64Array(nx*ny).fill(Infinity), parent=new Int32Array(nx*ny).fill(-1), closed=new Uint8Array(nx*ny)
  const heap: {id:number;score:number}[]=[]
  const push=(id:number,score:number)=>{let i=heap.length;heap.push({id,score});while(i){const p=(i-1)>>1;if(heap[p].score<=score)break;heap[i]=heap[p];i=p}heap[i]={id,score}}
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c}heap[i]=last}return first.id}
  const heuristic=(id:number)=>Math.hypot(id%nx-to%nx,Math.floor(id/nx)-Math.floor(to/nx))
  const weight=(value:number)=>value===2?1:value
  distance[from]=0;push(from,heuristic(from))
  while(heap.length){
    const id=pop();if(closed[id])continue;if(id===to)break;closed[id]=1
    const x=id%nx,y=Math.floor(id/nx)
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const xx=x+dx,yy=y+dy, next=yy*nx+xx
      if(xx<0||xx>=nx||yy<0||yy>=ny||!cost[next]||closed[next])continue
      if(dx&&dy&&(!cost[y*nx+xx]||!cost[yy*nx+x]))continue
      const d=distance[id]+Math.hypot(dx,dy)*(weight(cost[id])+weight(cost[next]))/2
      if(d<distance[next]){distance[next]=d;parent[next]=id;push(next,d+heuristic(next))}
    }
  }
  if(!Number.isFinite(distance[to]))return null
  const ids:number[]=[];for(let id=to;id>=0;id=parent[id]){ids.push(id);if(id===from)break}ids.reverse()
  // Only collapse collinear cells: smoothing across a corner could cut a
  // building or turn an inexpensive pavement path into a road diagonal.
  const simplified=ids.filter((id,i)=>i===0||i===ids.length-1||id-ids[i-1]!==ids[i+1]-id||
    (cost[id]===3)!==(cost[ids[i-1]]===3)||(cost[id]===3)!==(cost[ids[i+1]]===3)||
    (cost[id]===2)!==(cost[ids[i-1]]===2)||(cost[id]===2)!==(cost[ids[i+1]]===2))
  const points=simplified.map(id=>({azimuth:start.azimuth+(minX+id%nx*step)/radius,axial:start.axial+minY+Math.floor(id/nx)*step,
    ...(cost[id]===3?{crosswalk:true}:{}),...(cost[id]===2?{coveredWalk:true,groundHeight:UNDERPASS_HEIGHT}:{})}))
  return [...(indoorExit.length?indoorExit:[start]),...points,goal]
}

export class NeighborhoodJourney {
  action: GuideAction | null = null
  points: SurfacePoint[] = []
  index = 1
  status: 'idle'|'active'|'arrived'|'unavailable' = 'idle'
  driving = false
  label = ''
  remaining = 0
  nextDistance = 0
  bearing = 0
  offRoute = 0
  setRoute(points:SurfacePoint[]|null,driving:boolean,label:string) {
    this.points=points??[];this.index=1;this.driving=driving;this.label=label
    this.status=points?'active':'unavailable';this.offRoute=0;this.remaining=0
  }
  private sameLevel(a:SurfacePoint,b:SurfacePoint){return b.groundHeight===undefined||a.groundHeight!==undefined&&Math.abs(a.groundHeight-b.groundHeight)<.65}
  cancel(){this.action=null;this.points=[];this.status='idle';this.remaining=0}
  update(position:SurfacePoint,radius:number,dt:number) {
    if(this.status!=='active')return
    const threshold=this.driving?3:2.3
    // Keep crossing turns tight so the arrow does not cut outside the stripes.
    // Ordinary walking corners and final arrival retain their forgiving radius.
    while(this.index<this.points.length-1) {
      const tight=this.points[this.index].crosswalk||this.points[this.index+1]?.crosswalk||this.points[this.index].coveredWalk||this.points[this.index+1]?.coveredWalk||this.points[this.index].riverWalk||this.points[this.index+1]?.riverWalk
      if(!this.sameLevel(position,this.points[this.index])||surfaceDistance(position,this.points[this.index],radius)>=(this.driving ? 3 : tight ? .8 : threshold))break
      this.index++
    }
    const next=this.points[this.index];if(!next)return
    this.nextDistance=surfaceDistance(position,next,radius)
    this.remaining=this.nextDistance
    for(let i=this.index;i<this.points.length-1;i++)this.remaining+=surfaceDistance(this.points[i],this.points[i+1],radius)
    this.bearing=Math.atan2(wrapAngle(next.azimuth-position.azimuth)*radius,next.axial-position.axial)
    if(this.index===this.points.length-1&&this.nextDistance<threshold&&this.sameLevel(position,next)){this.status='arrived';this.remaining=0}
    const prev=this.points[this.index-1]
    const dx=wrapAngle(next.azimuth-prev.azimuth)*radius,dy=next.axial-prev.axial
    const px=wrapAngle(position.azimuth-prev.azimuth)*radius,py=position.axial-prev.axial
    const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)))
    const offset=Math.hypot(px-t*dx,py-t*dy)
    this.offRoute=offset>8||!this.sameLevel(position,{...next,groundHeight:prev.groundHeight===undefined||next.groundHeight===undefined?undefined:prev.groundHeight+(next.groundHeight-prev.groundHeight)*t})?this.offRoute+dt:0
  }
}

/** Exit beyond the nearest kerb, with an actual building-clearance check.
 * Elevated/experimental dismounts keep their existing momentum separately. */
export function pavementExit(plan:CityPlan,radius:number,car:SurfacePoint,heading:number):SurfacePoint|null {
  const roads=plan.roads.filter(r=>r.kind!=='alley'&&Math.abs(wrapAngle(car.azimuth-r.azimuth)*radius)<r.tangentWidth/2+1&&Math.abs(car.axial-r.axial)<r.axialLength/2+1)
  const candidates:SurfacePoint[]=[]
  for(const r of roads)for(const side of [-1,1]) candidates.push(r.axialLength>r.tangentWidth
    ? {azimuth:r.azimuth+side*(r.tangentWidth/2+1.1)/radius,axial:car.axial}
    : {azimuth:car.azimuth,axial:r.axial+side*(r.axialLength/2+1.1)})
  if(!candidates.length)for(const side of [-1,1])candidates.push({azimuth:car.azimuth-Math.cos(heading)*side*2.6/radius,axial:car.axial+Math.sin(heading)*side*2.6})
  return candidates.filter(p=>surfaceDistance(car,p,radius)<=5 && !plan.buildings.some(b=>Math.abs(wrapAngle(p.azimuth-b.azimuth)*radius)<b.width/2+.7&&Math.abs(p.axial-b.axial)<b.depth/2+.7)
    && !plan.roads.some(r=>Math.abs(wrapAngle(p.azimuth-r.azimuth)*radius)<r.tangentWidth/2+.4&&Math.abs(p.axial-r.axial)<r.axialLength/2+.4))
    .sort((a,b)=>surfaceDistance(car,a,radius)-surfaceDistance(car,b,radius))[0]??null
}

export function canParkAt(car:SurfacePoint,heading:number,speed:number,elevation:number,bay:CarShareBay,radius:number) {
  return speed<.6 && elevation<.8 && surfaceDistance(car,bay,radius)<2 && Math.abs(Math.sin(heading-bay.heading))<.3
}
