import { bandGraph, clearBandSegment, nodeBandRoads, type BandPoint, type BandRoad, type BandSite, type BandStreetPlan } from './bandStreetPlan'
import { getStreetProfile } from './streetProfile'
import type { StreetPath } from './streetPath'
import { StreetSurfacePlan } from './streetSurfacePlan'

const distance=(a:BandPoint,b:BandPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const same=(a:BandPoint,b:BandPoint)=>distance(a,b)<.0001
const key=(p:BandPoint)=>p.map(n=>Math.round(n*1e5)).join(':')
const protectedRoad=(r:BandRoad)=>Boolean(r.bridge||r.underpass||r.frontage)
function projection(p:BandPoint,a:BandPoint,b:BandPoint):BandPoint {
  const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)))
  return [a[0]+dx*t,a[1]+dy*t]
}

/** Design diagnostics, not highway engineering standards. Degree-two samples
 * around a reserved curve are not separate short junction approaches. */
export function bandGeometryIssues(roads:BandRoad[],minimumAngle=30,minimumLink=20) {
  const g=bandGraph(roads),degrees=new Map(g.points.map((p,i)=>[key(p),g.degree[i]]))
  const sharp=g.points.flatMap((p,i)=>{
    if(g.degree[i]<3)return []
    const rays=g.adjacency[i].map(e=>({point:g.points[e.to],angle:Math.atan2(g.points[e.to][1]-p[1],g.points[e.to][0]-p[0])})).sort((a,b)=>a.angle-b.angle)
    return rays.flatMap((a,j)=>{
      const b=rays[(j+1)%rays.length],angle=(b.angle-a.angle+2*Math.PI)%(2*Math.PI)*180/Math.PI
      return angle<minimumAngle?[{point:p,a:a.point,b:b.point,angle}]:[]
    })
  }).sort((a,b)=>a.angle-b.angle)
  const short=roads.filter(r=>(degrees.get(key(r.from))??0)>=3&&(degrees.get(key(r.to))??0)>=3&&distance(r.from,r.to)<minimumLink)
    .map(r=>({from:r.from,to:r.to,length:distance(r.from,r.to)})).sort((a,b)=>a.length-b.length)
  return {sharp,short}
}

/** Share nearly coincident approaches and combine adjacent junctions before
 * allocating pavement or lots. Never move named centres, gates or crossing
 * endpoints. Unresolvable cases remain in the returned diagnostics. */
export function refineBandRoads(input:BandRoad[],site:BandSite,servedPoints:BandPoint[]=[]) {
  let roads=nodeBandRoads(input)
  const original=bandGraph(roads),fixed=[...site.centres.map(c=>c.point),...(site.accesses??[]).map(a=>a.point),...site.crossings.flatMap(c=>[c.from,c.to]),...(site.frontages??[]).flatMap(r=>[r.from,r.to])]
    .filter(p=>original.points.some(q=>same(p,q)))
  const isFixed=(p:BandPoint)=>fixed.some(q=>same(p,q))
  const edits:{kind:'merge-junctions'|'share-approach';from:BandPoint;to:BandPoint}[]=[]
  let issues=bandGeometryIssues(roads)
  const before=issues
  const reaches=(p:BandPoint,list:BandRoad[])=>list.some(r=>{
    const q=projection(p,r.from,r.to)
    return distance(p,q)<=90.0001&&clearBandSegment(p,q,site.reserves)
  })
  const served=servedPoints.filter(p=>reaches(p,roads))
  const accept=(candidate:BandRoad[])=>{
    const changed=candidate.filter(r=>!roads.includes(r))
    if(changed.some(r=>protectedRoad(r)||![r.from,r.to].every(p=>Math.abs(p[0])<=site.width/2+.0001&&Math.abs(p[1])<=site.length/2+.0001)||!clearBandSegment(r.from,r.to,site.reserves)))return false
    const next=nodeBandRoads(candidate),graph=bandGraph(next)
    if(graph.components!==original.components||fixed.some(p=>!graph.points.some(q=>same(p,q))))return false
    const remaining=bandGeometryIssues(next)
    // A fix must improve the geometry without trading one problem for another.
    if(remaining.sharp.length>issues.sharp.length||remaining.short.length>issues.short.length)return false
    if(remaining.sharp.length+remaining.short.length===issues.sharp.length+issues.short.length&&next.length>=roads.length)return false
    if(served.some(p=>!reaches(p,next)))return false
    roads=next;issues=remaining;return true
  }
  for(let iteration=0;iteration<input.length;iteration++) {
    let improved=false
    for(const short of issues.short) {
      for(const [remove,keep] of [[short.from,short.to],[short.to,short.from]]) {
        if(isFixed(remove)||roads.some(r=>protectedRoad(r)&&(same(r.from,remove)||same(r.to,remove))))continue
        const candidate=roads.flatMap(r=>{
          const from=same(r.from,remove)?keep:r.from,to=same(r.to,remove)?keep:r.to
          return same(from,to)?[]:from===r.from&&to===r.to?[r]:[{...r,from,to}]
        })
        if(accept(candidate)){edits.push({kind:'merge-junctions',from:remove,to:keep});improved=true;break}
      }
      if(improved)break
    }
    if(improved)continue
    for(const sharp of issues.sharp) {
      const p=sharp.point
      const alternatives=[[sharp.a,sharp.b],[sharp.b,sharp.a]].map(([end,hostEnd])=>({
        end,hostEnd,branch:roads.find(r=>(same(r.from,p)&&same(r.to,end))||(same(r.to,p)&&same(r.from,end)))!
      })).sort((a,b)=>Number(a.branch.kind==='arterial')-Number(b.branch.kind==='arterial')||distance(p,a.end)-distance(p,b.end))
      for(const {end,hostEnd,branch} of alternatives) {
        if(protectedRoad(branch))continue
        let host=roads.find(r=>(same(r.from,p)&&same(r.to,hostEnd))||(same(r.to,p)&&same(r.from,hostEnd)))!
        let hostFrom=p,hostTo=hostEnd,join=projection(end,p,hostEnd)
        const branchProfile=getStreetProfile(branch.kind),hostProfile=getStreetProfile(host.kind)
        const localEnvelope=(branchProfile.carriageway+hostProfile.carriageway)/2+branchProfile.sidewalk+hostProfile.sidewalk
        const followHost=distance(end,join)>localEnvelope
        // A junction splits a continuous host into graph edges. Follow its
        // forward continuation so a parallel approach can join at the far end,
        // rather than just moving the needle to the next intersection.
        const visited=new Set<BandRoad>([host,branch])
        let previous=p,current=hostEnd,travel=distance(p,hostEnd)
        while(followHost&&!isFixed(current)&&travel<distance(p,end)*1.5+100){
          const dx=current[0]-previous[0],dy=current[1]-previous[1],span=Math.hypot(dx,dy)
          const continuations=roads.flatMap(r=>{
            if(visited.has(r)||protectedRoad(r)||r.kind!==host.kind)return []
            const point=same(r.from,current)?r.to:same(r.to,current)?r.from:null
            if(!point)return []
            const length=distance(current,point),alignment=((point[0]-current[0])*dx+(point[1]-current[1])*dy)/(span*length)
            return alignment>Math.cos(Math.PI/6)?[{r,point,alignment,length}]:[]
          }).sort((a,b)=>b.alignment-a.alignment)
          const next=continuations[0]
          if(!next)break
          visited.add(next.r)
          const q=projection(end,current,next.point)
          if(distance(end,q)<distance(end,join)){join=q;host=next.r;hostFrom=current;hostTo=next.point}
          previous=current;current=next.point;travel+=next.length
        }
        if(distance(join,hostTo)<20)join=hostTo
        else if(distance(join,hostFrom)<20)join=hostFrom
        if(distance(p,join)<20)continue
        // If the entire approach lies within one pavement envelope, move its
        // unfixed outer meeting onto the shared road instead of retaining a
        // tiny connector inside the carriageway. All attached roads follow.
        const a=getStreetProfile(branch.kind),b=getStreetProfile(host.kind),envelope=(a.carriageway+b.carriageway)/2+a.sidewalk+b.sidewalk
        if(distance(end,join)<envelope&&!isFixed(end)&&!roads.some(r=>protectedRoad(r)&&(same(r.from,end)||same(r.to,end)))) {
          const candidate=roads.flatMap(r=>{
            if(r===branch)return []
            const from=same(r.from,end)?join:r.from,to=same(r.to,end)?join:r.to
            return same(from,to)?[]:from===r.from&&to===r.to?[r]:[{...r,from,to}]
          })
          if(accept(candidate)){edits.push({kind:'share-approach',from:end,to:join});improved=true;break}
        }
        const candidate=roads.filter(r=>r!==branch)
        if(!same(end,join))candidate.push({...branch,from:end,to:join})
        if(accept(candidate)){edits.push({kind:'share-approach',from:p,to:join});improved=true;break}
      }
      if(improved)break
    }
    if(!improved)break
  }
  return {roads,edits,before,remaining:issues}
}

/** Adapter into the simulation's existing width, surface and cylindrical
 * geometry pipeline. This stage does not invent bridge heights or IC grades. */
export function prepareBandStreetGeometry(plan:BandStreetPlan,radius=3200) {
  const refined=refineBandRoads(plan.roads,plan.site,plan.demand.filter(d=>d.served).map(d=>d.point))
  const paths:StreetPath[]=refined.roads.map((r,i)=>{
    const tangent:BandPoint=[r.to[0]-r.from[0],r.to[1]-r.from[1]]
    return {id:`${plan.site.id}:surface-${i}`,azimuth:0,axial:0,kind:r.kind,width:getStreetProfile(r.kind,radius).carriageway,
      level:0,groundHeight:0,knots:[{point:r.from,tangent},{point:r.to,tangent}]}
  })
  const surfaces=new StreetSurfacePlan(paths,radius,true)
  return {...refined,paths,carriageways:surfaces.roadSurfaces(),sidewalks:surfaces.sidewalks()}
}
