import { bandSegmentIntersection, clearBandSegment, insideBandReserve, planBandStreets,
  type BandPoint, type BandReserve, type BandSite } from './bandStreetPlan'

/** Planning only: levels identify separate networks, not engineered heights.
 * The explicit directed graph must never be noded from XY intersections. */
export type ExpressRoute = { id: string; name: string; points: BandPoint[]; reservationWidth: number; waterBridges: string[] }
export type ExpressInterchange = { id: string; name: string; route: string; station: number; side: -1 | 1; serves: string[] }
export type ExpressJunction = { id: string; name: string; main: string; station: number; branch: string }
export type ExpressDesign = {
  routes: ExpressRoute[]; interchanges: ExpressInterchange[]; junction: ExpressJunction
  underpasses: { id: string; route: string; station: number }[]
}
export type ExpressNode = { id: string; point: BandPoint; level: 0 | 1; role: 'gate' | 'carriageway' }
export type ExpressEdge = {
  id: string; from: string; to: string; points: BandPoint[]
  kind: 'mainline' | 'spur' | 'ic-ramp' | 'jct-ramp'; owner: string
  length: number; lanes: number; structure: 'elevated' | 'transition' | 'flyover'
}
const dist=(a:BandPoint,b:BandPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const lerp=(a:BandPoint,b:BandPoint,t:number):BandPoint=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
const length=(p:BandPoint[])=>p.slice(1).reduce((s,b,i)=>s+dist(p[i],b),0)
const offsets=(p:BandPoint[])=>p.map((_,i)=>length(p.slice(0,i+1)))
function at(route:ExpressRoute,station:number,offset=0):BandPoint {
  const spans=offsets(route.points),end=spans.at(-1)!
  if(!Number.isFinite(station)||station<-.001||station>end+.001)throw Error('Station outside '+route.id)
  const i=Math.max(1,spans.findIndex(s=>s>=station)),a=route.points[i-1],b=route.points[i]
  const p=lerp(a,b,(station-spans[i-1])/(spans[i]-spans[i-1])),l=dist(a,b)
  return [p[0]-(b[1]-a[1])/l*offset,p[1]+(b[0]-a[0])/l*offset]
}
function tangentAt(route:ExpressRoute,station:number):BandPoint {
  const a=at(route,Math.max(0,station-.1)),b=at(route,Math.min(length(route.points),station+.1)),l=dist(a,b)
  return [(b[0]-a[0])/l,(b[1]-a[1])/l]
}
export function expressStationAtAxial(route:ExpressRoute,y:number) {
  const i=route.points.findIndex((p,j)=>j>0&&p[1]>=y)
  if(i<1||y<route.points[0][1])throw Error('Axial station outside route')
  return length(route.points.slice(0,i))+dist(route.points[i-1],route.points[i])*(y-route.points[i-1][1])/(route.points[i][1]-route.points[i-1][1])
}
function ribbon(route:ExpressRoute):BandPoint[] {
  const side=(sign:number)=>route.points.map((p,i)=>{
    const prev=route.points[Math.max(0,i-1)],next=route.points[Math.min(route.points.length-1,i+1)]
    const l=dist(prev,next),w=route.reservationWidth/2*sign
    return [p[0]-(next[1]-prev[1])/l*w,p[1]+(next[0]-prev[0])/l*w] as BandPoint
  })
  return [...side(1),...side(-1).reverse()]
}
function hull(points:BandPoint[]):BandPoint[] {
  const p=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a:BandPoint,b:BandPoint,c:BandPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const half=(v:BandPoint[])=>{const out:BandPoint[]=[];for(const q of v){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,q)<=0)out.pop();out.push(q)}return out.slice(0,-1)}
  return [...half(p),...half([...p].reverse())]
}
function curve(a:BandPoint,b:BandPoint,ta:BandPoint,tb:BandPoint):BandPoint[] {
  const reach=Math.min(400,dist(a,b)*.45),c:BandPoint=[a[0]+ta[0]*reach,a[1]+ta[1]*reach],d:BandPoint=[b[0]-tb[0]*reach,b[1]-tb[1]*reach]
  return Array.from({length:25},(_,i)=>{const t=i/24,u=1-t;return [u*u*u*a[0]+3*u*u*t*c[0]+3*u*t*t*d[0]+t*t*t*b[0],u*u*u*a[1]+3*u*u*t*c[1]+3*u*t*t*d[1]+t*t*t*b[1]]})
}

export function reserveBandExpressway(site:BandSite,design:ExpressDesign) {
  const routes=new Map(design.routes.map(r=>[r.id,r])),nodes:ExpressNode[]=[],edges:ExpressEdge[]=[],reserves:BandReserve[]=[]
  if(routes.size!==design.routes.length||new Set(design.interchanges.map(i=>i.id)).size!==design.interchanges.length)throw Error('Duplicate transport identifier')
  for(const r of design.routes) {
    if(r.points.length<2||!r.points.flat().every(Number.isFinite)||!Number.isFinite(r.reservationWidth)||r.reservationWidth<40||r.points.some((p,i)=>i>0&&dist(p,r.points[i-1])<1))throw Error('Invalid express route')
    for(const id of r.waterBridges)if(!site.reserves.some(s=>s.id===id&&s.kind==='water')||r.points.slice(1).every((p,i)=>clearBandSegment(r.points[i],p,[site.reserves.find(s=>s.id===id)!])))throw Error('Invalid express bridge')
    if(r.points.slice(1).some((p,i)=>!clearBandSegment(r.points[i],p,site.reserves.filter(s=>!r.waterBridges.includes(s.id)))))throw Error('Express route enters protected land')
    reserves.push({id:`express:${r.id}`,kind:'transport',polygon:ribbon(r)})
  }
  const route=(id:string)=>{const r=routes.get(id);if(!r)throw Error('Unknown express route '+id);return r}
  const slots=new Map(design.routes.map(r=>[r.id,new Set([0,length(r.points)])]))
  const addSlot=(id:string,s:number)=>{at(route(id),s);slots.get(id)!.add(s)}
  const j=design.junction,main=route(j.main),branch=route(j.branch)
  if(j.main===j.branch||j.station<600||j.station>length(main.points)-600)throw Error('Invalid junction')
  for(const s of [j.station-600,j.station+600])addSlot(j.main,s)
  const gateSlots=new Map<string,{lo:number;hi:number;station:number}>()
  for(const ic of design.interchanges) {
    const r=route(ic.route),end=length(r.points),station=ic.station
    if(!Number.isFinite(station)||!(ic.side===-1||ic.side===1)||!ic.serves.length||ic.serves.some(id=>!site.centres.some(c=>c.id===id)))throw Error('Invalid interchange')
    const lo=Math.max(0,station-350),hi=Math.min(end,station+350)
    if(station<0||station>end||hi-lo<300)throw Error('Interchange outside route')
    if(design.interchanges.some(other=>other!==ic&&other.route===ic.route&&Math.abs(other.station-station)<1100)||ic.route===j.main&&Math.abs(station-j.station)<1500)throw Error('Overlapping interchange approaches')
    gateSlots.set(ic.id,{lo,hi,station});addSlot(ic.route,lo);addSlot(ic.route,hi)
  }
  const nodeId=(id:string,s:number,d:1|-1)=>`${id}:${s.toFixed(5)}:${d}`
  const addNode=(id:string,point:BandPoint,level:0|1,role:ExpressNode['role'])=>{nodes.push({id,point,level,role});return id}
  const addEdge=(from:string,to:string,points:BandPoint[],kind:ExpressEdge['kind'],owner:string,structure:ExpressEdge['structure'])=>{
    edges.push({id:`${owner}:${from}>${to}`,from,to,points,kind,owner,length:length(points),lanes:kind.endsWith('ramp')?1:2,structure})
  }
  for(const r of design.routes) {
    const stations=[...slots.get(r.id)!].sort((a,b)=>a-b),breaks=offsets(r.points)
    for(const s of stations)for(const d of [1,-1] as const)addNode(nodeId(r.id,s,d),at(r,s,d*6),1,'carriageway')
    for(let i=1;i<stations.length;i++)for(const d of [1,-1] as const) {
      const lo=stations[i-1],hi=stations[i],p=[lo,...breaks.filter(s=>s>lo&&s<hi),hi].map(s=>at(r,s,d*6))
      if(d===-1)p.reverse()
      addEdge(nodeId(r.id,d===1?lo:hi,d),nodeId(r.id,d===1?hi:lo,d),p,r.id===j.main?'mainline':'spur',r.id,'elevated')
    }
  }
  const node=(id:string)=>nodes.find(n=>n.id===id)!
  const accesses=[] as NonNullable<BandSite['accesses']>
  const interchanges=design.interchanges.map(ic=>{
    const r=route(ic.route),s=gateSlots.get(ic.id)!,end=length(r.points),centre=at(r,s.station),gate=at(r,s.station,ic.side*330)
    const tangent=tangentAt(r,s.station),normal:BandPoint=[-tangent[1]*ic.side,tangent[0]*ic.side],terminal=s.station===0||s.station===end
    const id=addNode(`gate:${ic.id}`,gate,0,'gate'),rampStart=edges.length
    accesses.push({id:ic.id,point:gate,serves:[...ic.serves]})
    for(const d of [1,-1] as const) {
      // Terminals have one entry and one exit, not roads dangling past an IC.
      if(d===1?s.station>0:s.station<end) {
        const from=nodeId(r.id,terminal?s.station:d===1?s.lo:s.hi,d)
        addEdge(from,id,curve(node(from).point,gate,[tangent[0]*d,tangent[1]*d],normal),'ic-ramp',ic.id,'transition')
      }
      if(d===1?s.station<end:s.station>0) {
        const to=nodeId(r.id,terminal?s.station:d===1?s.hi:s.lo,d)
        addEdge(id,to,curve(gate,node(to).point,[-normal[0],-normal[1]],[tangent[0]*d,tangent[1]*d]),'ic-ramp',ic.id,'transition')
      }
    }
    // Reserve the complete ramp envelope before routing local roads. Its
    // surface gate lies on the boundary and is the sole network transfer.
    const samples=edges.slice(rampStart).flatMap(e=>e.points),sidePoints=samples.flatMap(p=>[-1,1].flatMap(u=>[-1,1].map(v=>{
      const q:BandPoint=[p[0]+45*(tangent[0]*u+normal[0]*v),p[1]+45*(tangent[1]*u+normal[1]*v)]
      const beyond=Math.max(0,(q[0]-gate[0])*normal[0]+(q[1]-gate[1])*normal[1])
      return [q[0]-beyond*normal[0],q[1]-beyond*normal[1]] as BandPoint
    })))
    const polygon=hull([...sidePoints,gate,at(r,s.lo,-90*ic.side),at(r,s.hi,-90*ic.side)])
    reserves.push({id:`ic:${ic.id}`,kind:'transport',polygon})
    return {...ic,point:centre,gate,id:ic.id,node:id}
  })
  const rampsStart=edges.length,branchOut=nodeId(branch.id,0,1),branchIn=nodeId(branch.id,0,-1)
  const branchTangent:BandPoint=[(branch.points[1][0]-branch.points[0][0])/dist(branch.points[0],branch.points[1]),(branch.points[1][1]-branch.points[0][1])/dist(branch.points[0],branch.points[1])]
  for(const d of [1,-1] as const) {
    const incoming=nodeId(main.id,j.station-d*600,d),outgoing=nodeId(main.id,j.station+d*600,d)
    addEdge(incoming,branchOut,curve(node(incoming).point,node(branchOut).point,[0,d],branchTangent),'jct-ramp',j.id,d===1?'elevated':'flyover')
    addEdge(branchIn,outgoing,curve(node(branchIn).point,node(outgoing).point,[-branchTangent[0],-branchTangent[1]],[0,d]),'jct-ramp',j.id,d===1?'flyover':'elevated')
  }
  const rampPoints=edges.slice(rampsStart).flatMap(e=>e.points)
  reserves.push({id:`jct:${j.id}`,kind:'transport',polygon:hull(rampPoints.flatMap(p=>[[-55,-55],[-55,55],[55,-55],[55,55]].map(([x,y])=>[p[0]+x,p[1]+y] as BandPoint)))})
  for(const reserve of reserves) {
    if(reserve.polygon.some(p=>Math.abs(p[0])>site.width/2||Math.abs(p[1])>site.length/2))throw Error('Transport reservation outside land band: '+reserve.id)
    if(site.centres.some(c=>insideBandReserve(c.point,reserve.polygon)))throw Error('Transport displaces district centre: '+reserve.id)
    const water=design.routes.find(r=>`express:${r.id}`===reserve.id)?.waterBridges??[]
    const protectedLand=site.reserves.filter(r=>!water.includes(r.id))
    if(reserve.polygon.some((p,i)=>!clearBandSegment(p,reserve.polygon[(i+1)%reserve.polygon.length],protectedLand))||protectedLand.some(r=>r.polygon.some(p=>insideBandReserve(p,reserve.polygon))))throw Error('Transport footprint enters protected land: '+reserve.id)
  }
  const crossings=design.underpasses.map(p=>{
    const r=route(p.route)
    // A margin keeps endpoints outside the ribbon at shallow bends.
    return {id:p.id,reserve:`express:${r.id}`,mode:'underpass' as const,from:at(r,p.station,r.reservationWidth/2+2),to:at(r,p.station,-r.reservationWidth/2-2)}
  })
  const bridges:{route:string;reserve:string;from:BandPoint;to:BandPoint}[]=[]
  for(const r of design.routes)for(const id of r.waterBridges) {
    const polygon=site.reserves.find(s=>s.id===id)!.polygon
    for(let i=1;i<r.points.length;i++) {
      const a=r.points[i-1],b=r.points[i],cuts=[0,1]
      polygon.forEach((p,j)=>{const t=bandSegmentIntersection(a,b,p,polygon[(j+1)%polygon.length]);if(t!==null)cuts.push(t)})
      cuts.sort((a,b)=>a-b)
      for(let k=1;k<cuts.length;k++)if(cuts[k]-cuts[k-1]>.000001&&insideBandReserve(lerp(a,b,(cuts[k]+cuts[k-1])/2),polygon))bridges.push({route:r.id,reserve:id,from:lerp(a,b,cuts[k-1]),to:lerp(a,b,cuts[k])})
    }
  }
  const surfaceSite:BandSite={...site,reserves:[...site.reserves,...reserves],crossings:[...site.crossings,...crossings],accesses:[...(site.accesses??[]),...accesses]}
  return {design,nodes,edges,reserves,interchanges,bridges,junction:{...j,point:at(main,j.station)},surfaceSite}
}
export type BandExpressway=ReturnType<typeof reserveBandExpressway>

/** No implicit transfer at equal XY, and no intermediate gate shortcuts.
 * Closures remove directed movements without changing the reserved land. */
export function expressJourney(plan:BandExpressway,from:string,to:string,closedOwners:string[]=[]):{edges:string[];length:number}|null {
  if(!plan.nodes.some(n=>n.id===from)||!plan.nodes.some(n=>n.id===to))throw Error('Unknown journey endpoint')
  const costs=new Map([[from,0]]),prev=new Map<string,ExpressEdge>(),done=new Set<string>()
  while(true) {
    const next=[...costs].filter(([id])=>!done.has(id)).sort((a,b)=>a[1]-b[1])[0]
    if(!next) return null
    const [id,cost]=next
    if(id===to){const path:string[]=[];for(let n=to;n!==from;){const e=prev.get(n)!;path.unshift(e.id);n=e.from}return {edges:path,length:cost}}
    done.add(id)
    if(id!==from&&plan.nodes.find(n=>n.id===id)!.role==='gate')continue
    for(const e of plan.edges)if(e.from===id&&!closedOwners.includes(e.owner)&&cost+e.length<(costs.get(e.to)??Infinity)){costs.set(e.to,cost+e.length);prev.set(e.to,e)}
  }
}

export function planBandTransport(site:BandSite,design:ExpressDesign) {
  const expressway=reserveBandExpressway(site,design),surface=planBandStreets(expressway.surfaceSite)
  const crossings:{road:number;edge:string;point:BandPoint;transfer:boolean}[]=[]
  surface.roads.forEach((r,road)=>{for(const edge of expressway.edges)for(let i=1;i<edge.points.length;i++) {
    const t=bandSegmentIntersection(r.from,r.to,edge.points[i-1],edge.points[i])
    if(t===null)continue
    const point=lerp(r.from,r.to,t),transfer=expressway.interchanges.some(ic=>dist(ic.gate,point)<.01&&(edge.from===ic.node||edge.to===ic.node))
    if(!crossings.some(c=>c.road===road&&c.edge===edge.id&&dist(c.point,point)<.01))crossings.push({road,edge:edge.id,point,transfer})
  }})
  return {expressway,surface,crossings}
}
