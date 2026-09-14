import {StreetNetwork} from './streetNetwork'
import {streetRibbon,type StreetPath} from './streetPath'
import {getStreetProfile} from './streetProfile'
import {intersectStreetPolygons,polygonArea,subtractStreetPolygon,type StreetPolygon} from './streetPolygon'

type Point=[number,number]
type Site={areas:StreetPolygon[];reserves:StreetPolygon[];eligible:(p:StreetPath)=>boolean;maximumLength:number;minimumDetour:number;limit:number;onRejected?:(from:string,to:string,reason:string)=>void}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const point=(n:{azimuth:number;axial:number},radius:number):Point=>[n.azimuth*radius,n.axial]
const global=(p:StreetPath,polygon:StreetPolygon,radius:number)=>polygon.map(v=>({...v,x:v.x+p.azimuth*radius,y:v.y+p.axial}))
const bounds=(p:StreetPolygon)=>({x0:Math.min(...p.map(v=>v.x)),x1:Math.max(...p.map(v=>v.x)),y0:Math.min(...p.map(v=>v.y)),y1:Math.max(...p.map(v=>v.y))})
const overlap=(a:ReturnType<typeof bounds>,b:ReturnType<typeof bounds>)=>a.x0<=b.x1&&b.x0<=a.x1&&a.y0<=b.y1&&b.y0<=a.y1
const ribbon=(p:StreetPath,start:number,end:number,half:number):StreetPolygon=>streetRibbon(p,start,end,-half,half).map(({x,y})=>({x,y,u:0,v:0}))

/** Bounded Dijkstra over the real street graph; no Euclidean estimate is
 * reported as an existing road distance. The heap avoids scanning the city. */
function distances(network:StreetNetwork,start:number,maximum:number,exclude?:string){
 const cost=new Float64Array(network.nodes.length).fill(Infinity),queue:{id:number;cost:number}[]=[]
 const push=(id:number,c:number)=>{let i=queue.length;queue.push({id,cost:c});while(i){const p=(i-1)>>1;if(queue[p].cost<=c)break;queue[i]=queue[p];i=p}queue[i]={id,cost:c}}
 const pop=()=>{const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let c=i*2+1;if(c+1<queue.length&&queue[c+1].cost<queue[c].cost)c++;if(queue[c].cost>=last.cost)break;queue[i]=queue[c];i=c}queue[i]=last}return first}
 cost[start]=0;push(start,0)
 while(queue.length){
  const current=pop();if(current.cost!==cost[current.id])continue
  for(const id of network.nodes[current.id].edges){const e=network.edges[id];if(network.streets[e.street].id===exclude)continue
   const next=e.from===current.id?e.to:e.from,c=current.cost+e.length
   if(c<cost[next]&&c<=maximum){cost[next]=c;push(next,c)}
  }
 }
 return cost
}

/** Connect genuinely circuitous street ends across available land. Candidate
 * positions are existing ends and projections onto streets, never a lattice.
 * The entire road + pavements must fit, including at reservations and buildings. */
export function planLocalStreetLinks(network:StreetNetwork,site:Site){
 const radius=network.radius,profile=getStreetProfile('local',radius),half=profile.carriageway/2+profile.sidewalk+1
 const junction=(id:number)=>{
  const n=network.nodes[id],edges=n.edges.map(i=>network.edges[i])
  return {id,point:point(n,radius),neighbors:[...new Set(edges.map(e=>e.from===id?e.to:e.from))].map(i=>point(network.nodes[i],radius)),streets:new Set(edges.map(e=>e.street))}
 }
 const ends=network.nodes.flatMap((n,i)=>{
  const edges=n.edges.map(id=>network.edges[id]),neighbors=[...new Set(edges.map(e=>e.from===i?e.to:e.from))]
  return neighbors.length===1&&edges.every(e=>site.eligible(network.streets[e.street]))&&n.level===0?
   [junction(i)]:[]
 })
 const cached=new Map<number,Float64Array>(),reserved=site.reserves.map(p=>({polygon:p,bounds:bounds(p)}))
 const targets=network.edges.filter(e=>site.eligible(network.streets[e.street])&&network.nodes[e.from].level===0)
 const pairs=ends.flatMap(a=>targets.flatMap(e=>{
  if(a.streets.has(e.street))return[]
  const u=point(network.nodes[e.from],radius),v=point(network.nodes[e.to],radius),dx=v[0]-u[0],dy=v[1]-u[1],length=distance(u,v)
  let t=Math.max(0,Math.min(1,((a.point[0]-u[0])*dx+(a.point[1]-u[1])*dy)/(length*length)))
  if(t*length<40)t=0;else if((1-t)*length<40)t=1
  const b=t===0?junction(e.from):t===1?junction(e.to):{id:-1,point:[u[0]+t*dx,u[1]+t*dy] as Point,neighbors:[u,v],streets:new Set([e.street])}
  const direct=distance(a.point,b.point)
  if(direct<80||direct>site.maximumLength)return[]
  const acute=(start:typeof b,end:typeof b)=>start.neighbors.some(n=>{
   const u=[n[0]-start.point[0],n[1]-start.point[1]],v=[end.point[0]-start.point[0],end.point[1]-start.point[1]]
   return (u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v))>.5
  })
  if(acute(a,b)||acute(b,a))return[]
  if(!cached.has(a.id))cached.set(a.id,distances(network,a.id,5000))
  const cost=cached.get(a.id)!,before=Math.min(cost[e.from]+t*e.length,cost[e.to]+(1-t)*e.length)
  return Number.isFinite(before)&&before>direct*site.minimumDetour&&before-direct>200?[{a,b,length:direct,before}]:[]
 })).sort((a,b)=>(b.before-b.length)-(a.before-a.length)||a.a.id-b.a.id||a.b.point[0]-b.b.point[0]||a.b.point[1]-b.b.point[1])
 const links:{path:StreetPath;before:number;after:number;from:string;to:string}[]=[],used=new Set<number>()
 for(const candidate of pairs){
  if(links.length>=site.limit)break
  const {a,b,length,before}=candidate
  const rejected=(reason:string)=>site.onRejected?.(network.streets[[...a.streets][0]].id,network.streets[[...b.streets][0]].id,reason)
  if(used.has(a.id)||used.has(b.id))continue
  const tangent:Point=[b.point[0]-a.point[0],b.point[1]-a.point[1]]
  const path:StreetPath={id:`local-link-${links.length}`,azimuth:0,axial:0,kind:'local',width:profile.carriageway,level:0,groundHeight:0,walkHeight:.32,
   knots:[a.point,b.point].map(point=>({point,tangent}))}
  const envelope=ribbon(path,0,1,half),box=bounds(envelope)
  let outside=[envelope]
  for(const area of site.areas)outside=outside.flatMap(p=>subtractStreetPolygon(p,area))
  if(outside.reduce((sum,p)=>sum+polygonArea(p),0)>1e-5){rejected('outside');continue}
  if(reserved.some(r=>overlap(box,r.bounds)&&polygonArea(intersectStreetPolygons(envelope,r.polygon))>1e-5)){rejected('reserve');continue}
  const roads=network.query((a.point[0]+b.point[0])/(2*radius),(a.point[1]+b.point[1])/2,box.x1-box.x0+50,box.y1-box.y0+50)
  if(roads.some(s=>{
   const other=network.streets[s.street];if(other.level!==0)return false
   const width=other.width/2+getStreetProfile(other.kind,radius).sidewalk+1
   const polygon=global(other,ribbon(other,s.start.t,s.end.t,width),radius)
   if(!overlap(box,bounds(polygon)))return false
   const shared=intersectStreetPolygons(envelope,polygon);if(polygonArea(shared)<1e-5)return false
   return ![a,b].some(end=>end.streets.has(s.street)&&shared.every(p=>distance([p.x,p.y],end.point)<30))
  })){rejected('road');continue}
  if(links.some(l=>polygonArea(intersectStreetPolygons(envelope,ribbon(l.path,0,1,half)))>1e-5))continue
  // Earlier additions can remove the need for another edge. Measure again on
  // the augmented graph instead of preserving a stale detour justification.
  let current=before
  if(links.length){
   const graph=new StreetNetwork([...network.streets,...links.map(l=>l.path),path],radius)
   const node=(p:Point)=>graph.nodes.findIndex(n=>distance(point(n,radius),p)<1e-4)
   current=distances(graph,node(a.point),5000,path.id)[node(b.point)]
  }
  if(!Number.isFinite(current)||current<=length*site.minimumDetour||current-length<=200)continue
  links.push({path,before:current,after:length,from:network.streets[[...a.streets][0]].id,to:network.streets[[...b.streets][0]].id})
  used.add(a.id);if(b.id>=0)used.add(b.id)
 }
 return links
}
