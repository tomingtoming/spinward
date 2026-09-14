/** A planning graph for an entire unrolled land band. Metres, no CityRoad,
 * block rows, old exits, building budget or renderer dependencies. Geometry is
 * a centreline proposal: elevation, junction radii and parcel construction
 * must be resolved before this can replace the inhabited simulation. */
export type BandPoint = [number, number]
export type BandReserve = { id: string; kind: 'water' | 'facility' | 'green' | 'transport'; polygon: BandPoint[] }
export type BandCentre = {
  id: string; point: BandPoint; use: 'centre' | 'housing' | 'industry' | 'port'
  reach: number; demand: number
}
export type BandCrossing = { id: string; from: BandPoint; to: BandPoint; reserve: string; mode?: 'bridge' | 'underpass' }
export type BandAccess = { id: string; point: BandPoint; serves: string[] }
export type BandSite = {
  id: string; width: number; length: number; seed: number
  centres: BandCentre[]; reserves: BandReserve[]; crossings: BandCrossing[]
  localDemand: number; detourRatio: number
  accesses?: BandAccess[]
  frontages?: BandRoad[]
}
export type BandRoad = { from: BandPoint; to: BandPoint; kind: 'arterial' | 'collector'; bridge?: string; underpass?: string; frontage?: string; reason: string }
const EPS = 1e-6
const distance = (a: BandPoint, b: BandPoint) => Math.hypot(a[0]-b[0],a[1]-b[1])
const mix = (a: BandPoint,b: BandPoint,t: number): BandPoint => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
const cross = (a: BandPoint,b: BandPoint) => a[0]*b[1]-a[1]*b[0]
const delta = (a: BandPoint,b: BandPoint): BandPoint => [a[0]-b[0],a[1]-b[1]]
const key = (p: BandPoint) => p.map(n=>Math.round(n*1e5)).join(':')

function project(p: BandPoint,a: BandPoint,b: BandPoint) {
  const d=delta(b,a),l=d[0]*d[0]+d[1]*d[1]
  return mix(a,b,Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/l)))
}
/** Strict interior of a simple polygon, including concave river corridors.
 * A centreline may run on the reservation boundary; that boundary already
 * includes the road/sidewalk setback, not just the water's edge. */
export function insideBandReserve(p: BandPoint,polygon: BandPoint[]) {
  let inside=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j],b=polygon[i]
    if(distance(p,project(p,a,b))<EPS)return false
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
  }
  return inside
}
function intersection(a: BandPoint,b: BandPoint,c: BandPoint,d: BandPoint): number | null {
  const u=delta(b,a),v=delta(d,c),den=cross(u,v)
  if(Math.abs(den)<EPS)return null
  const w=delta(c,a),t=cross(w,v)/den,s=cross(w,u)/den
  return t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS?Math.max(0,Math.min(1,t)):null
}
export { intersection as bandSegmentIntersection }
export function clearBandSegment(a: BandPoint,b: BandPoint,reserves: BandReserve[]) {
  return reserves.every(({polygon})=>{
    const cuts=[0,1]
    for(let i=0;i<polygon.length;i++) {
      const t=intersection(a,b,polygon[i],polygon[(i+1)%polygon.length])
      if(t!==null)cuts.push(t)
    }
    cuts.sort((a,b)=>a-b)
    return cuts.every((t,i)=>!i||t-cuts[i-1]<EPS||!insideBandReserve(mix(a,b,(t+cuts[i-1])/2),polygon))
  })
}
function shortest(adjacency: {to:number;length:number}[][],start: number) {
  const cost=adjacency.map(()=>Infinity),previous=adjacency.map(()=>-1),done=new Set<number>();cost[start]=0
  for(let count=0;count<adjacency.length;count++) {
    let n=-1
    for(let i=0;i<cost.length;i++)if(!done.has(i)&&(n<0||cost[i]<cost[n]))n=i
    if(n<0||!Number.isFinite(cost[n]))break
    done.add(n)
    for(const e of adjacency[n])if(cost[n]+e.length<cost[e.to]-EPS){cost[e.to]=cost[n]+e.length;previous[e.to]=n}
  }
  return {cost,previous}
}

function router(site: BandSite) {
  const valid=(p: BandPoint)=>Math.abs(p[0])<=site.width/2+EPS&&Math.abs(p[1])<=site.length/2+EPS
  const points: BandPoint[]=[]
  const id=(p: BandPoint)=>{let n=points.findIndex(q=>distance(p,q)<EPS);if(n<0){n=points.length;points.push(p)}return n}
  for(const r of site.reserves)for(const p of r.polygon)if(valid(p)&&!site.reserves.some(s=>insideBandReserve(p,s.polygon)))id(p)
  for(const c of site.crossings){id(c.from);id(c.to)}
  const adjacency=points.map(()=>[] as {to:number;length:number}[])
  const bridgeByEdge=new Map<string,string>()
  const edgeKey=(a:number,b:number)=>[Math.min(a,b),Math.max(a,b)].join(':')
  for(const c of site.crossings) {
    const kind=c.mode==='underpass'?'transport':'water'
    if(!valid(c.from)||!valid(c.to)||!site.reserves.some(r=>r.id===c.reserve&&r.kind===kind))throw Error('Invalid crossing '+c.id)
    if(site.reserves.some(r=>insideBandReserve(c.from,r.polygon)||insideBandReserve(c.to,r.polygon)))throw Error('Crossing ends inside reserved land')
    const water=site.reserves.find(r=>r.id===c.reserve)!
    if(clearBandSegment(c.from,c.to,[water])||!clearBandSegment(c.from,c.to,site.reserves.filter(r=>r!==water)))throw Error('Crossing must cross only its named reserve')
    bridgeByEdge.set(edgeKey(id(c.from),id(c.to)),c.id)
  }
  for(let i=0;i<points.length;i++)for(let j=0;j<i;j++) {
    if(!bridgeByEdge.has(edgeKey(i,j))&&!clearBandSegment(points[i],points[j],site.reserves))continue
    const length=distance(points[i],points[j]);adjacency[i].push({to:j,length});adjacency[j].push({to:i,length})
  }
  // Reservations and bridge candidates are the only reusable routing vertices.
  // No old roads or regular sampling lattice enter this visibility graph.
  return (a: BandPoint,b: BandPoint): {points:BandPoint[];bridges:(string|undefined)[];length:number} | null => {
    if(clearBandSegment(a,b,site.reserves))return {points:[a,b],bridges:[undefined],length:distance(a,b)}
    const all=[...points,a,b],edges=adjacency.map(row=>[...row]),start=points.length,end=start+1
    edges.push([],[])
    for(const i of [start,end])for(let j=0;j<points.length;j++)if(clearBandSegment(all[i],all[j],site.reserves)) {
      const length=distance(all[i],all[j]);edges[i].push({to:j,length});edges[j].push({to:i,length})
    }
    const {cost,previous}=shortest(edges,start)
    if(!Number.isFinite(cost[end]))return null
    const route:number[]=[];for(let i=end;i>=0;i=previous[i])route.unshift(i)
    return {points:route.map(i=>all[i]),bridges:route.slice(1).map((i,j)=>bridgeByEdge.get(edgeKey(route[j],i))),length:cost[end]}
  }
}

/** Split every geometric meeting (including overlapping collinear routes).
 * Deduplicate shared road pieces so repeated demand cannot manufacture cycles. */
export function nodeBandRoads(roads: BandRoad[]) {
  const cuts=roads.map(()=>[0,1])
  for(let i=0;i<roads.length;i++)for(let j=0;j<i;j++) {
    const a=roads[i],b=roads[j],t=intersection(a.from,a.to,b.from,b.to),u=intersection(b.from,b.to,a.from,a.to)
    if(t!==null&&u!==null){cuts[i].push(t);cuts[j].push(u);continue}
    for(const [r,s,k] of [[a,b,i],[b,a,j]] as const)for(const p of [s.from,s.to]) {
      const q=project(p,r.from,r.to)
      if(distance(p,q)<EPS)cuts[k].push(distance(r.from,q)/distance(r.from,r.to))
    }
  }
  const unique=new Map<string,BandRoad>()
  roads.forEach((r,i)=>{
    const values=[...new Set(cuts[i])].sort((a,b)=>a-b)
    for(let j=1;j<values.length;j++) {
      const from=mix(r.from,r.to,values[j-1]),to=mix(r.from,r.to,values[j])
      if(distance(from,to)<.01)continue
      const k=[key(from),key(to)].sort().join('|'),old=unique.get(k)
      if(!old||r.frontage||(!old.frontage&&r.kind==='arterial'))unique.set(k,{...r,from,to})
    }
  })
  return [...unique.values()]
}
export function bandGraph(roads: BandRoad[]) {
  const points: BandPoint[]=[],ids=new Map<string,number>(),adjacency:{to:number;length:number}[][]=[]
  const id=(p:BandPoint)=>{const k=key(p);let i=ids.get(k);if(i===undefined){i=points.length;ids.set(k,i);points.push(p);adjacency.push([])}return i}
  for(const r of roads){const a=id(r.from),b=id(r.to),length=distance(r.from,r.to);adjacency[a].push({to:b,length});adjacency[b].push({to:a,length})}
  const visited=new Set<number>();let components=0
  for(let i=0;i<points.length;i++)if(!visited.has(i)){components++;const queue=[i];visited.add(i);for(const n of queue)for(const e of adjacency[n])if(!visited.has(e.to)){visited.add(e.to);queue.push(e.to)}}
  return {points,adjacency,components,cycles:roads.length-points.length+components,degree:adjacency.map(r=>r.length)}
}
function roadDistance(roads: BandRoad[],a: BandPoint,b: BandPoint) {
  const g=bandGraph(nodeBandRoads(roads)),i=g.points.findIndex(p=>distance(p,a)<.01),j=g.points.findIndex(p=>distance(p,b)<.01)
  return i<0||j<0?Infinity:shortest(g.adjacency,i).cost[j]
}

export function planBandStreets(site: BandSite) {
  const coordinates=[site.width,site.length,site.seed,site.detourRatio,...site.centres.flatMap(c=>[...c.point,c.reach,c.demand]),...site.reserves.flatMap(r=>r.polygon.flat()),...site.crossings.flatMap(c=>[...c.from,...c.to]),...(site.accesses??[]).flatMap(a=>a.point),...(site.frontages??[]).flatMap(r=>[...r.from,...r.to])]
  if(!coordinates.every(Number.isFinite)||!(site.width>0&&site.length>0&&site.detourRatio>1)||!Number.isInteger(site.localDemand)||site.localDemand<0||site.localDemand>1000)throw Error('Invalid band planning budget')
  if(new Set(site.reserves.map(r=>r.id)).size!==site.reserves.length||new Set(site.crossings.map(c=>c.id)).size!==site.crossings.length||site.reserves.some(r=>r.polygon.length<3||r.polygon.some((p,i)=>distance(p,r.polygon[(i+1)%r.polygon.length])<EPS)))throw Error('Invalid land reservation')
  const inside=(p: BandPoint)=>Math.abs(p[0])<site.width/2&&Math.abs(p[1])<site.length/2&&!site.reserves.some(r=>insideBandReserve(p,r.polygon))
  if(site.centres.length<2||new Set(site.centres.map(c=>c.id)).size!==site.centres.length||new Set(site.centres.map(c=>key(c.point))).size!==site.centres.length||site.centres.some(c=>!inside(c.point)||!(c.reach>0&&c.demand>0)))throw Error('Invalid district centre')
  if(new Set((site.accesses??[]).map(a=>a.id)).size!==(site.accesses??[]).length||(site.accesses??[]).some(a=>!inside(a.point)||!a.serves.length||a.serves.some(id=>!site.centres.some(c=>c.id===id))))throw Error('Invalid transport access')
  if((site.frontages??[]).some(r=>!r.frontage||!inside(r.from)||!inside(r.to)||distance(r.from,r.to)<20||!clearBandSegment(r.from,r.to,site.reserves)))throw Error('Invalid retained frontage')
  const route=router(site),roads:BandRoad[]=structuredClone(site.frontages??[]),unconnected:string[]=[],links:{from:string;to:string;before:number;after:number;added:boolean}[]=[]
  const append=(r:NonNullable<ReturnType<typeof route>>,kind:BandRoad['kind'],reason:string)=>{
    r.points.slice(1).forEach((to,i)=>{
      const crossing=site.crossings.find(c=>c.id===r.bridges[i])
      if(distance(r.points[i],to)>.01)roads.push({from:r.points[i],to,kind,reason,
        ...(crossing?.mode==='underpass'?{underpass:crossing.id}:{bridge:r.bridges[i]})})
    })
  }
  // First connect centres with a minimum routed tree. Add a connection only
  // when two nearby centres would otherwise incur a substantial detour.
  const pairs=site.centres.flatMap((a,i)=>site.centres.slice(0,i).flatMap((b,j)=>{const r=route(a.point,b.point);return r?[{i,j,r}]:[]})).sort((a,b)=>a.r.length-b.r.length||a.i-b.i||a.j-b.j)
  const parents=site.centres.map((_,i)=>i),root=(i:number):number=>parents[i]===i?i:(parents[i]=root(parents[i]))
  for(const p of pairs)if(root(p.i)!==root(p.j)){parents[root(p.i)]=root(p.j);append(p.r,'arterial',`connect:${site.centres[p.i].id}:${site.centres[p.j].id}`)}
  for(const [i,c] of site.centres.entries())if(root(i)!==root(0))unconnected.push(c.id)
  for(const {i,j,r} of pairs) {
    const a=site.centres[i],b=site.centres[j]
    if(r.length>Math.max(a.reach,b.reach)*4)continue
    const before=roadDistance(roads,a.point,b.point),added=before>r.length*site.detourRatio
    if(added)append(r,'arterial',`detour:${a.id}:${b.id}`)
    links.push({from:a.id,to:b.id,before,after:added?r.length:before,added})
  }
  // Interchange frontage connects to named destinations without becoming a
  // residential demand centre or exposing the limited-access road to locals.
  const accessLinks:{access:string;centre:string;length:number}[]=[]
  for(const a of site.accesses??[])for(const id of a.serves) {
    const c=site.centres.find(c=>c.id===id)!
    let connected=roadDistance(roads,a.point,c.point)
    if(!Number.isFinite(connected)) {
      const r=route(a.point,c.point)
      if(!r){unconnected.push(`${a.id}:${id}`);continue}
      // Join the first existing arterial that already reaches this district.
      // Repeating each full gate-to-centre route creates nearly coincident
      // roads converging on the same bridge, leaving unusable needle parcels.
      let joined=false
      for(let i=1;i<r.points.length&&!joined;i++) {
        const start=r.points[i-1],end=r.points[i]
        const meetings=roads.flatMap(road=>{const t=intersection(start,end,road.from,road.to);return t!==null&&t>EPS?[{t,road}]:[]}).sort((a,b)=>a.t-b.t)
        for(const meeting of meetings)if(Number.isFinite(roadDistance(roads,meeting.road.from,c.point))) {
          r.points=[...r.points.slice(0,i),mix(start,end,meeting.t)];r.bridges=r.bridges.slice(0,i);joined=true;break
        }
      }
      append(r,'arterial',`interchange:${a.id}:${id}`)
      connected=roadDistance(roads,a.point,c.point)
    }
    if(Number.isFinite(connected))accessLinks.push({access:a.id,centre:id,length:connected})
    else unconnected.push(`${a.id}:${id}`)
  }
  let seed=site.seed>>>0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const demand:{id:string;centre:string;point:BandPoint;served:boolean}[]=[],weight=site.centres.reduce((s,c)=>s+c.demand,0)
  for(let tries=0;tries<site.localDemand*80&&demand.length<site.localDemand;tries++) {
    let pick=random()*weight,c=site.centres[0]
    for(const v of site.centres){pick-=v.demand;if(pick<=0){c=v;break}}
    const angle=random()*Math.PI*2,length=Math.sqrt(random())*c.reach,p:BandPoint=[c.point[0]+Math.cos(angle)*length,c.point[1]+Math.sin(angle)*length]
    const spacing=c.use==='centre'?170:c.use==='industry'?310:240
    if(!inside(p)||demand.some(q=>distance(q.point,p)<spacing)||site.centres.some(q=>distance(q.point,p)<100))continue
    demand.push({id:`access-${demand.length}`,centre:c.id,point:p,served:false})
  }
  for(const d of demand) {
    const candidates=[...new Map(roads.map(r=>{const p=project(d.point,r.from,r.to);return [key(p),p]})).values()].sort((a,b)=>distance(d.point,a)-distance(d.point,b))
    const targets=candidates.slice(0,8)
    if(targets.length&&distance(d.point,targets[0])<90){d.served=true;continue}
    // A barrier can put every nearest candidate on the opposite side. Also
    // consider the nearest directly reachable road, so later demand shares
    // an existing approach instead of drawing parallel routes to its tunnel.
    const visible=candidates.find(p=>clearBandSegment(d.point,p,site.reserves))
    if(visible&&!targets.includes(visible))targets.push(visible)
    let best:ReturnType<typeof route>=null
    for(const p of targets){const r=route(d.point,p);if(r&&(!best||r.length<best.length))best=r}
    if(!best){unconnected.push(d.id);continue}
    // Stop at the first existing road met on the approach. This creates a T
    // rather than crossing that road merely to reach a preselected target.
    let stop=false
    for(let i=1;i<best.points.length;i++) {
      const a=best.points[i-1],b=best.points[i]
      let first=1
      for(const r of roads){const t=intersection(a,b,r.from,r.to);if(t!==null&&t>EPS)first=Math.min(first,t)}
      if(first<1-EPS){best.points=[...best.points.slice(0,i),mix(a,b,first)];best.bridges=best.bridges.slice(0,i);stop=true}
      if(stop)break
    }
    append(best,'collector',`access:${d.centre}`);d.served=true
  }
  let noded=nodeBandRoads(roads),graph=bandGraph(noded)
  const localLinks:{from:string;to:string;before:number;after:number}[]=[]
  const nodeAt=(p:BandPoint)=>graph.points.findIndex(q=>distance(p,q)<.01)
  const leaves=demand.filter(d=>nodeAt(d.point)>=0)
  const nearby=leaves.flatMap((a,i)=>leaves.slice(0,i).map(b=>({a,b,length:distance(a.point,b.point)}))
    .filter(p=>p.length<600).sort((a,b)=>a.length-b.length).slice(0,3)).sort((a,b)=>a.length-b.length)
  for(const {a,b,length} of nearby) {
    if(localLinks.length>=Math.ceil(site.localDemand*.12))break
    if(!clearBandSegment(a.point,b.point,site.reserves))continue
    const before=shortest(graph.adjacency,nodeAt(a.point)).cost[nodeAt(b.point)]
    if(before<length*2.1)continue
    roads.push({from:a.point,to:b.point,kind:'collector',reason:`local-detour:${a.centre}:${b.centre}`})
    localLinks.push({from:a.id,to:b.id,before,after:length})
    noded=nodeBandRoads(roads);graph=bandGraph(noded)
  }
  for(const a of site.accesses??[]) {
    const start=nodeAt(a.point)
    if(start<0)continue
    const costs=shortest(graph.adjacency,start).cost
    for(const link of accessLinks)if(link.access===a.id)link.length=costs[nodeAt(site.centres.find(c=>c.id===link.centre)!.point)]??Infinity
  }
  return {site,roads:noded,demand,unallocatedDemand:site.localDemand-demand.length,unconnected,links,localLinks,accessLinks}
}
export type BandStreetPlan = ReturnType<typeof planBandStreets>
