import { curvedStreetPoint, curvedFootwayHeight, type CurvedNeighborhood } from '../objects/curvedNeighborhood'
import { sampleCitySurface } from '../objects/citySurfaceMesh'
import type { SurfacePoint } from './neighborhoodRoute'

type Point=SurfacePoint & {groundHeight:number;curvedWalk:true}
type Attachment={point:Point;index:number;along:number;side:number}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const distance=(a:SurfacePoint,b:SurfacePoint,r:number)=>Math.hypot(wrap(a.azimuth-b.azimuth)*r,a.axial-b.axial)
const cache=new WeakMap<CurvedNeighborhood,Point[][]>()

/** Two separate footways with four certified mouths. Quarter-metre approach
 * samples follow the buried contact bevel; the bend uses sub-two-metre chords. */
export function curvedWalkPaths(p:CurvedNeighborhood,radius:number):Point[][]{
 const cached=cache.get(p);if(cached)return cached
 const at=(x:number,y:number,h:number):Point=>{
  let height=0
  for(const c of p.colliders){if(!c.surfaceMesh)continue
   const dx=x-wrap(c.azimuth-p.azimuth)*radius,dy=p.axial+y-c.axial
   if(Math.abs(dx)>c.width/2+1e-6||Math.abs(dy)>c.depth/2+1e-6)continue
   height=Math.max(height,sampleCitySurface(c.surfaceMesh,dx,dy,h+.3))
  }
  if(Math.abs(height-h)>.13)throw Error('Curved walk has no matching contact support')
  return{azimuth:p.azimuth+x/radius,axial:p.axial+y,groundHeight:height,curvedWalk:true}
 }
 const paths=[-1,1].map(side=>{
  const ends=[0,1].map(end=>p.walkConnections.find(c=>c.end===end&&c.side===side)!)
  const points:Point[]=[]
  const approach=(vs:readonly (readonly number[])[])=>{
   for(let i=1;i<vs.length;i++){
    const a=vs[i-1],b=vs[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.25)
    for(let j=0;j<=count;j++){const t=j/count;const q=at(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t)
     if(!points.length||distance(points.at(-1)!,q,radius)>1e-5)points.push(q)}
   }
  }
  approach([...ends[0].points].reverse())
  const count=Math.ceil((p.knots[2].point[0]-p.knots[0].point[0])/1.3)
  for(let i=1;i<=count;i++){const t=ends[0].t+(ends[1].t-ends[0].t)*i/count,v=curvedStreetPoint(p,t,side*4);points.push(at(v.x,v.y,curvedFootwayHeight(p,t)))}
  approach(ends[1].points)
  return points
 })
 cache.set(p,paths);return paths
}

function attach(paths:Point[][],r:number,p:SurfacePoint):Attachment|null{
 let best:Attachment|null=null,minimum=Infinity
 for(const [side,path]of paths.entries())for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=wrap(b.azimuth-a.azimuth)*r,dy=b.axial-a.axial
  const t=Math.max(0,Math.min(1,(wrap(p.azimuth-a.azimuth)*r*dx+(p.axial-a.axial)*dy)/(dx*dx+dy*dy)))
  const point:Point={azimuth:a.azimuth+dx*t/r,axial:a.axial+dy*t,groundHeight:a.groundHeight+(b.groundHeight-a.groundHeight)*t,curvedWalk:true}
  const d=distance(point,p,r)
  if(d>.6||Math.abs((p.groundHeight??0)-point.groundHeight)>.45||d>=minimum)continue
  minimum=d;best={point,index:i,along:i-1+t,side}
 }
 return best
}
function between(paths:Point[][],a:Attachment,b:Attachment):Point[]|null{
 if(a.side!==b.side)return null
 const low=a.along<=b.along?a:b,high=low===a?b:a
 const inner=paths[a.side].filter((_,i)=>i>low.along&&i<high.along)
 const path=[low.point,...inner,high.point];return low===a?path:path.reverse()
}
export function curvedLocalRoute(p:CurvedNeighborhood,r:number,start:SurfacePoint,goal:SurfacePoint):SurfacePoint[]|null{
 const paths=curvedWalkPaths(p,r),a=attach(paths,r,start),b=attach(paths,r,goal)
 if(!a||!b)return null
 const route=between(paths,a,b);return route?[start,...route,goal]:null
}
/** Off-district legs use the existing street search, including its crossing
 * rules. There is no new diagonal across a lawn or autonomous vehicle route. */
export function routeThroughCurve(p:CurvedNeighborhood,r:number,start:SurfacePoint,goal:SurfacePoint,
 streets:(a:SurfacePoint,b:SurfacePoint)=>SurfacePoint[]|null):SurfacePoint[]|null|undefined{
 const paths=curvedWalkPaths(p,r),a=attach(paths,r,start),b=attach(paths,r,goal)
 const inside=(q:SurfacePoint)=>{
  const x=wrap(q.azimuth-p.azimuth)*r,y=q.axial-p.axial
  if(x<p.knots[0].point[0]+2.5||x>p.knots[2].point[0]-2.5)return false
  let lo=0,hi=1;for(let i=0;i<25;i++){const t=(lo+hi)/2;if(curvedStreetPoint(p,t).x<x)lo=t;else hi=t}
  return Math.abs(curvedStreetPoint(p,(lo+hi)/2).y-y)<6.5
 }
 if(!a&&!b)return inside(start)||inside(goal)?null:undefined
 if(!a&&inside(start)||!b&&inside(goal))return null
 if(a&&b&&a.side===b.side)return[start,...between(paths,a,b)!,goal]
 const portals=(s:Attachment|null,point:SurfacePoint)=>s?[0,paths[s.side].length-1].map(index=>{
  const q=paths[s.side][index],node={point:q,index,along:index,side:s.side}
  return{point:q,path:[point,...between(paths,s,node)!]}
 }):[{point,path:[point]}]
 let best:SurfacePoint[]|null=null,minimum=Infinity
 for(const from of portals(a,start))for(const to of portals(b,goal)){
  const outer=streets(from.point,to.point);if(!outer)continue
  const path=[...from.path,...outer.slice(1),...to.path.slice(0,-1).reverse()]
  const length=path.reduce((n,q,i)=>n+(i?distance(path[i-1],q,r):0),0)
  if(length<minimum){minimum=length;best=path}
 }
 return best
}
