import { sampleStreetPath, streetPathSamples, type StreetPath } from './streetPath'
import { containsStreetPolygon, positivePolygon, type StreetPolygon } from './streetPolygon'
import { getStreetProfile } from './streetProfile'
import { StreetNetwork } from './streetNetwork'

type Point = [number, number]
export type StreetDestination = {
  id: string; point: Point; direction?: Point; kind: StreetPath['kind']; width: number
}
export type PlaceStreetSite = {
  id: string; azimuth: number; axial: number
  bounds: { x0: number; x1: number; y0: number; y1: number }
  reserves: StreetPolygon[]; trunks: StreetPath[]; destinations: StreetDestination[]
  links?: { id:string; from:string; to:string; maxDetour:number }[]
  approaches?: StreetDestination[]
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const unit = (a: Point): Point => { const l = Math.hypot(...a); return l ? [a[0] / l, a[1] / l] : [1, 0] }
const add = (a: Point, b: Point, scale: number): Point => [a[0] + b[0] * scale, a[1] + b[1] * scale]
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const intersects = (a: Point, b: Point, c: Point, d: Point) =>
  cross(a,b,c)*cross(a,b,d) < -1e-7 && cross(c,d,a)*cross(c,d,b) < -1e-7

/** Offset convex reservations by actual perpendicular clearance, not by a
 * centroid scale that loses the setback at long/thin parcels. */
function expand(polygon: StreetPolygon, clearance: number): StreetPolygon {
  const p = positivePolygon(polygon)
  return p.map((b,i) => {
    const a=p[(i+p.length-1)%p.length],c=p[(i+1)%p.length]
    const u=unit([b.x-a.x,b.y-a.y]),v=unit([c.x-b.x,c.y-b.y])
    const n:Point=[u[1]+v[1],-u[0]-v[0]],denom=1+u[0]*v[0]+u[1]*v[1]
    if(denom < 1e-5)throw Error('Reservation has a folded edge')
    return {...b,x:b.x+n[0]*clearance/denom,y:b.y+n[1]*clearance/denom}
  })
}

function visible(a: Point, b: Point, obstacles: StreetPolygon[]) {
  return !obstacles.some(p => {
    // Clip the segment against the strict interior. Travel along a clearance
    // polygon's boundary is legal; crossing through a corner into it is not.
    let lo=0,hi=1
    for(let i=0;i<p.length;i++){
      const c=p[i],d=p[(i+1)%p.length],x=cross([c.x,c.y],[d.x,d.y],a)-1e-5
      const delta=cross([c.x,c.y],[d.x,d.y],b)-1e-5-x
      if(Math.abs(delta)<1e-10){if(x<=0)return false;continue}
      if(delta>0)lo=Math.max(lo,-x/delta);else hi=Math.min(hi,-x/delta)
      if(hi<=lo)return false
    }
    return hi>lo
  })
}

/** Visibility routes run around reserved land. No row/column coordinates or
 * desired ring topology enter this search. A blocked destination stays explicit. */
function detour(a: Point, b: Point, obstacles: StreetPolygon[]): Point[] | null {
  if(visible(a,b,obstacles))return [a,b]
  const vertices:Point[]=[a,b,...obstacles.flatMap(p=>p.map(v=>[v.x,v.y] as Point))]
  const cost=vertices.map(()=>Infinity),prev=vertices.map(()=>-1),used=new Set<number>();cost[0]=0
  while(used.size<vertices.length){
    let i=-1
    for(let j=0;j<vertices.length;j++)if(!used.has(j)&&(i<0||cost[j]<cost[i]))i=j
    if(i<0||!Number.isFinite(cost[i]))return null
    if(i===1){const path:Point[]=[];for(let k=1;k>=0;k=prev[k])path.unshift(vertices[k]);return path}
    used.add(i)
    for(let j=0;j<vertices.length;j++)if(!used.has(j)&&visible(vertices[i],vertices[j],obstacles)){
      const c=cost[i]+distance(vertices[i],vertices[j])
      if(c<cost[j]){cost[j]=c;prev[j]=i}
    }
  }
  return null
}

function curved(site:PlaceStreetSite,goal:StreetDestination,points:Point[],endDirection:Point):StreetPath {
  const clean=points.filter((p,i)=>!i||distance(p,points[i-1])>.1)
  return {id:`${site.id}:${goal.id}`,azimuth:site.azimuth,axial:site.axial,kind:goal.kind,width:goal.width,
    level:0,groundHeight:0,walkHeight:.32,knots:clean.map((point,i)=>{
      const before=clean[Math.max(0,i-1)],after=clean[Math.min(clean.length-1,i+1)]
      const direction=i===clean.length-1?endDirection:i===0&&goal.direction?goal.direction:unit([after[0]-before[0],after[1]-before[1]])
      const length=i===0?distance(point,after):i===clean.length-1?distance(before,point):Math.min(distance(before,point),distance(point,after))
      return {point,tangent:add([0,0],direction,length)}
    })}
}

type CachedStreet = {path:StreetPath;samples:ReturnType<typeof streetPathSamples>}
function joinSamples(path:StreetPath){
  const [a,b]=path.knots,dx=b.point[0]-a.point[0],dy=b.point[1]-a.point[1]
  if(path.knots.length===2&&a.tangent[0]===dx&&a.tangent[1]===dy&&b.tangent[0]===dx&&b.tangent[1]===dy){
    const count=Math.ceil(Math.hypot(dx,dy)/32)
    return Array.from({length:count+1},(_,i)=>({...sampleStreetPath(path,i/count),t:i/count}))
  }
  return streetPathSamples(path)
}
function validRoad(site:PlaceStreetSite,path:StreetPath,protectedLand:StreetPolygon[],cache:CachedStreet[],allowed:{path:StreetPath;point:Point}[]):number|null{
  const goal=path,b=site.bounds
  const inBounds=(p:Point)=>p[0]>=b.x0-.01&&p[0]<=b.x1+.01&&p[1]>=b.y0-.01&&p[1]<=b.y1+.01
  const samples=streetPathSamples(path,.12),positions=samples.map(s=>[s.x,s.y] as Point)
  // Avoid sharp doglegs caused by a short connector being forced normal
  // to an unsuitable road. Try a different join instead of drawing it.
  const minRadius=goal.kind==='local'||goal.kind==='alley'?10:18
  if(samples.some((s,i)=>i>0&&Math.abs(Math.atan2(Math.sin(s.heading-samples[i-1].heading),Math.cos(s.heading-samples[i-1].heading)))>distance(positions[i-1],positions[i])/minRadius))return null
  if(positions.some(p=>!inBounds(p)||protectedLand.some(r=>containsStreetPolygon(r,...p))))return null
  if(positions.some((p,i)=>i>0&&!visible(positions[i-1],p,protectedLand)))return null
  // Reject unintended crossings and near-parallel overlap. Only the final
  // approach may enter the chosen junction's existing road envelope.
  let collision=false
  for(const other of cache){
    const minGap=(goal.width+other.path.width)/2+5
    for(let i=1;i<positions.length&&!collision;i++){
      const p=positions[i],a=positions[i-1]
      if(allowed.some(j=>other.path===j.path&&distance(p,j.point)<minGap+12))continue
      for(let j=1;j<other.samples.length;j++){
        const s=other.samples[j-1],e=other.samples[j],dx=e.x-s.x,dy=e.y-s.y
        if(Math.max(a[0],p[0])+minGap<Math.min(s.x,e.x)||Math.min(a[0],p[0])-minGap>Math.max(s.x,e.x)||Math.max(a[1],p[1])+minGap<Math.min(s.y,e.y)||Math.min(a[1],p[1])-minGap>Math.max(s.y,e.y))continue
        const t=Math.max(0,Math.min(1,((p[0]-s.x)*dx+(p[1]-s.y)*dy)/(dx*dx+dy*dy)))
        if(intersects(a,p,[s.x,s.y],[e.x,e.y])||Math.hypot(p[0]-s.x-dx*t,p[1]-s.y-dy*t)<minGap){collision=true;break}
      }
    }
    if(collision)break
  }
  if(collision)return null
  let length=0;for(let i=1;i<positions.length;i++)length+=distance(positions[i-1],positions[i])
  return length
}

function routeDistance(streets:StreetPath[],a:Point,b:Point){
  const n=new StreetNetwork(streets.map(s=>({...s,azimuth:0,axial:0})),100000)
  const nearest=(p:Point)=>n.nodes.findIndex(v=>Math.hypot(v.azimuth*100000-p[0],v.axial-p[1])<.01)
  const start=nearest(a),end=nearest(b)
  if(start<0||end<0)return Infinity
  const cost=n.nodes.map(()=>Infinity),visited=new Set<number>();cost[start]=0
  while(visited.size<n.nodes.length){
    let i=-1;for(let j=0;j<cost.length;j++)if(!visited.has(j)&&(i<0||cost[j]<cost[i]))i=j
    if(i<0||!Number.isFinite(cost[i]))return Infinity
    if(i===end)return cost[i]
    visited.add(i)
    for(const id of n.nodes[i].edges){const e=n.edges[id],j=e.from===i?e.to:e.from;cost[j]=Math.min(cost[j],cost[i]+e.length)}
  }
  return Infinity
}

/** Grow destinations into existing streets, then let later destinations join
 * those new roads. Shared access and junction hierarchy emerge from the input
 * order (major destinations before boundary approaches), not an intersection
 * lattice. This stage preserves supplied through trunks and does not yet plan
 * terrain elevation, bridges or the citywide trunk network. */
export function growPlaceStreets(site:PlaceStreetSite){
  const streets=[...site.trunks],joins:Point[]=[],unconnected:string[]=[]
  const connections:{destination:string;street:string;point:Point}[]=[]
  const b=site.bounds,inBounds=(p:Point)=>p[0]>=b.x0-.01&&p[0]<=b.x1+.01&&p[1]>=b.y0-.01&&p[1]<=b.y1+.01
  const grow=(goals:StreetDestination[])=>{for(const goal of goals){
    if(!inBounds(goal.point)||site.reserves.some(p=>containsStreetPolygon(p,...goal.point))){unconnected.push(goal.id);continue}
    const clearance=goal.width/2+getStreetProfile(goal.kind).sidewalk+2
    const protectedLand=site.reserves.map(p=>expand(p,clearance)),routingLand=site.reserves.map(p=>expand(p,clearance+28))
    const cache=streets.map(path=>({path,samples:streetPathSamples(path,.2)}))
    const candidates:{path:StreetPath;point:Point;direction:Point;score:number}[]=[]
    for(const {path} of cache){
      const samples=joinSamples(path)
      const leaf=samples[0],point:Point=[leaf.x,leaf.y],direction:Point=[Math.cos(leaf.heading),Math.sin(leaf.heading)]
      const toward=unit([point[0]-goal.point[0],point[1]-goal.point[1]])
      if(!site.trunks.includes(path)&&!joins.some(j=>distance(j,point)<82)&&direction[0]*toward[0]+direction[1]*toward[1]>.45)
        candidates.push({path,point,direction,score:distance(goal.point,point)})
      let walked=0,last=-Infinity,total=0
      const distances=[0]
      for(let i=1;i<samples.length;i++){total+=distance([samples[i-1].x,samples[i-1].y],[samples[i].x,samples[i].y]);distances.push(total)}
      for(let i=0;i<samples.length;i++){
        walked=distances[i]
        if(walked<65||total-walked<65||walked-last<32)continue
        last=walked
        const s=samples[i],p:Point=[s.x,s.y]
        if(joins.some(j=>distance(j,p)<82))continue
        let normal:Point=[-Math.sin(s.heading),Math.cos(s.heading)]
        if(normal[0]*(p[0]-goal.point[0])+normal[1]*(p[1]-goal.point[1])<0)normal=add([0,0],normal,-1)
        candidates.push({path,point:p,direction:normal,score:distance(goal.point,p)})
      }
    }
    candidates.sort((a,b)=>a.score-b.score||a.path.id.localeCompare(b.path.id))
    let best:{path:StreetPath;target:typeof candidates[number];length:number}|undefined
    for(const target of candidates){
      if(best&&target.score>best.length)break
      const approach=Math.min(45,target.score*.22),end=add(target.point,target.direction,-approach)
      const start=goal.direction?add(goal.point,unit(goal.direction),approach):goal.point
      const points=detour(start,end,routingLand)
      if(!points)continue
      const path=curved(site,goal,[goal.point,...points,target.point],target.direction)
      const length=validRoad(site,path,protectedLand,cache,[{path:target.path,point:target.point}])
      if(length===null)continue
      if(!best||length<best.length)best={path,target,length}
    }
    if(!best){unconnected.push(goal.id);continue}
    streets.push(best.path);joins.push(best.target.point)
    connections.push({destination:goal.id,street:best.target.path.id,point:best.target.point})
  }
  }
  grow(site.destinations)
  const links:{id:string;before:number;after:number;added:boolean}[]=[],deferredLinks:string[]=[]
  for(const link of site.links??[]){
    const from=streets.find(p=>p.id===`${site.id}:${link.from}`),to=streets.find(p=>p.id===`${site.id}:${link.to}`)
    if(!from||!to){deferredLinks.push(link.id);continue}
    const a=from.knots[0].point,b=to.knots[0].point,before=routeDistance(streets,a,b)
    if(before<=distance(a,b)*link.maxDetour){links.push({id:link.id,before,after:before,added:false});continue}
    const direction=add([0,0],unit(from.knots[0].tangent),-1),endDirection=unit(to.knots[0].tangent)
    const goal:StreetDestination={id:link.id,point:a,direction,kind:'local',width:6}
    const protectedLand=site.reserves.map(p=>expand(p,10)),routingLand=site.reserves.map(p=>expand(p,38))
    const approach=Math.min(80,distance(a,b)*.2)
    const points=detour(add(a,direction,approach),add(b,endDirection,-approach),routingLand)
    if(!points){deferredLinks.push(link.id);continue}
    const path=curved(site,goal,[a,...points,b],endDirection)
    const length=validRoad(site,path,protectedLand,streets.map(path=>({path,samples:streetPathSamples(path,.2)})),[{path:from,point:a},{path:to,point:b}])
    if(length===null||length*link.maxDetour>=before){deferredLinks.push(link.id);continue}
    streets.push(path);joins.push(a,b);links.push({id:link.id,before,after:length,added:true})
  }
  grow(site.approaches??[])
  return {streets,connections,unconnected,links,deferredLinks}
}
export type PlaceStreetGrowth = ReturnType<typeof growPlaceStreets>
