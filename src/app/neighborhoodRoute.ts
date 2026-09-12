import { getStreetProfile } from '../objects/streetProfile'
import type { CityPlan } from '../objects/cityLayout'
import type { PublicPark } from '../objects/publicPark'
import type { CarShareBay } from '../objects/carShare'

export type SurfacePoint = { azimuth: number; axial: number }
export const OUTING_DESTINATIONS = [
  { id: 'guide-square', label: 'Central Square' },
  { id: 'guide-cafe', label: 'Café' },
  { id: 'guide-park', label: 'Park' },
  { id: 'guide-car', label: 'Your car' }
] as const
export type GuideAction = typeof OUTING_DESTINATIONS[number]['id']
export type OutingAction = GuideAction | 'guide-cancel' | 'drive-mode-toggle' | 'park-car'
export type OutingDestination = { label: string; entrance: SurfacePoint; bay: CarShareBay | null }
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export const surfaceDistance = (a: SurfacePoint, b: SurfacePoint, radius: number) => Math.hypot(wrapAngle(a.azimuth-b.azimuth)*radius, a.axial-b.axial)

/** Local, bounded route search on actual generated streets. Road-space is
 * expensive on foot, so pavements win except for crossing the carriageway.
 * Buildings remain obstacles; an indoor start leaves via its certified door.
 * This is guidance only: it never moves the player or drives the car. */
export function planNeighborhoodRoute(plan: CityPlan, radius: number, start: SurfacePoint, goal: SurfacePoint,
  driving: boolean, park: PublicPark | null = null): SurfacePoint[] | null {
  const step = 2, pad = 100
  const gx = wrapAngle(goal.azimuth-start.azimuth)*radius, gy = goal.axial-start.axial
  if (Math.abs(gx)>1600 || Math.abs(gy)>1600) return null
  const minX = Math.floor((Math.min(0,gx)-pad)/step)*step, minY = Math.floor((Math.min(0,gy)-pad)/step)*step
  const nx = Math.ceil((Math.abs(gx)+2*pad)/step)+1, ny = Math.ceil((Math.abs(gy)+2*pad)/step)+1
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
  for(const {r,x,y} of roads) paint(x,y,r.tangentWidth-(driving?2.2:0),r.axialLength-(driving?2.2:0),driving?1:4)
  if (!driving) {
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
  distance[from]=0;push(from,heuristic(from))
  while(heap.length){
    const id=pop();if(closed[id])continue;if(id===to)break;closed[id]=1
    const x=id%nx,y=Math.floor(id/nx)
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const xx=x+dx,yy=y+dy, next=yy*nx+xx
      if(xx<0||xx>=nx||yy<0||yy>=ny||!cost[next]||closed[next])continue
      if(dx&&dy&&(!cost[y*nx+xx]||!cost[yy*nx+x]))continue
      const d=distance[id]+Math.hypot(dx,dy)*(cost[id]+cost[next])/2
      if(d<distance[next]){distance[next]=d;parent[next]=id;push(next,d+heuristic(next))}
    }
  }
  if(!Number.isFinite(distance[to]))return null
  const ids:number[]=[];for(let id=to;id>=0;id=parent[id]){ids.push(id);if(id===from)break}ids.reverse()
  // Only collapse collinear cells: smoothing across a corner could cut a
  // building or turn an inexpensive pavement path into a road diagonal.
  const simplified=ids.filter((id,i)=>i===0||i===ids.length-1||id-ids[i-1]!==ids[i+1]-id)
  const points=simplified.map(id=>({azimuth:start.azimuth+(minX+id%nx*step)/radius,axial:start.axial+minY+Math.floor(id/nx)*step}))
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
  cancel(){this.action=null;this.points=[];this.status='idle';this.remaining=0}
  update(position:SurfacePoint,radius:number,dt:number) {
    if(this.status!=='active')return
    const threshold=this.driving?3:2.3
    while(this.index<this.points.length-1 && surfaceDistance(position,this.points[this.index],radius)<threshold)this.index++
    const next=this.points[this.index];if(!next)return
    this.nextDistance=surfaceDistance(position,next,radius)
    this.remaining=this.nextDistance
    for(let i=this.index;i<this.points.length-1;i++)this.remaining+=surfaceDistance(this.points[i],this.points[i+1],radius)
    this.bearing=Math.atan2(wrapAngle(next.azimuth-position.azimuth)*radius,next.axial-position.axial)
    if(this.index===this.points.length-1&&this.nextDistance<threshold){this.status='arrived';this.remaining=0}
    const prev=this.points[this.index-1]
    const dx=wrapAngle(next.azimuth-prev.azimuth)*radius,dy=next.axial-prev.axial
    const px=wrapAngle(position.azimuth-prev.azimuth)*radius,py=position.axial-prev.axial
    const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)))
    const offset=Math.hypot(px-t*dx,py-t*dy)
    this.offRoute=offset>8?this.offRoute+dt:0
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
