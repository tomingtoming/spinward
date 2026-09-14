import { streetPathSurfaces, relativeStreetPolygon } from './streetSurfacePlan'
import { sampleStreetPath, streetPathSamples, type StreetPath } from './streetPath'
import { getStreetProfile } from './streetProfile'
import { clipStreetPolygon, containsStreetPolygon, intersectStreetPolygons, polygonArea, subtractStreetPolygon, type StreetPolygon } from './streetPolygon'

type Point = { x:number; y:number }
type Bounds = { x0:number; x1:number; y0:number; y1:number }
export type StreetParcelSite = {
  id:string; azimuth:number; axial:number; bounds:Bounds
  streets:StreetPath[]; reserves:StreetPolygon[]; seed:number
  /** Optional full frontage span in metres. Whole-band end cells otherwise
   * extend to distant bisectors in large, sparsely served land blocks. */
  maximumFrontage?:number
}
export type StreetLandBlock = { id:string; pieces:StreetPolygon[]; area:number }
export type StreetParcel = {
  id:string; blockId:string; pieces:StreetPolygon[]; area:number
  front:{ streetId:string; t:number; side:1|-1; point:Point; heading:number }
  building:{ x:number; y:number; width:number; depth:number; yaw:number }
}
const vertex=(x:number,y:number)=>({x,y,u:0,v:0})
const rectangle=(b:Bounds):StreetPolygon=>[vertex(b.x0,b.y0),vertex(b.x1,b.y0),vertex(b.x1,b.y1),vertex(b.x0,b.y1)]
// The subdivision never mutates a polygon; share its broad phase across cuts
// and footprint fits instead of rescanning thousands of retained vertices.
const boxes=new WeakMap<StreetPolygon,Bounds>()
function bounds(p:StreetPolygon):Bounds{
  let b=boxes.get(p)
  if(!b){b={x0:Infinity,x1:-Infinity,y0:Infinity,y1:-Infinity};for(const v of p){b.x0=Math.min(b.x0,v.x);b.x1=Math.max(b.x1,v.x);b.y0=Math.min(b.y0,v.y);b.y1=Math.max(b.y1,v.y)}boxes.set(p,b)}
  return b
}
const close=(a:Bounds,b:Bounds)=>a.x0<=b.x1+1e-6&&a.x1>=b.x0-1e-6&&a.y0<=b.y1+1e-6&&a.y1>=b.y0-1e-6
const area=(pieces:StreetPolygon[])=>pieces.reduce((sum,p)=>sum+polygonArea(p),0)

/** Pieces retain their shared cut edges. Only a positive-length shared edge
 * connects land: two corners touching across a road do not form one block. */
function components(pieces:StreetPolygon[]):StreetPolygon[][] {
  const parents=pieces.map((_,i)=>i),boxes=pieces.map(bounds)
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i}
  const adjacent=(p:StreetPolygon,q:StreetPolygon)=>{
    for(let i=0;i<p.length;i++){
      const a=p[i],b=p[(i+1)%p.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)
      if(length<1e-6)continue
      const ux=dx/length,uy=dy/length
      for(let j=0;j<q.length;j++){
        const c=q[j],d=q[(j+1)%q.length]
        if(Math.abs(ux*(c.y-a.y)-uy*(c.x-a.x))>1e-6||Math.abs(ux*(d.y-a.y)-uy*(d.x-a.x))>1e-6)continue
        const x=ux*(c.x-a.x)+uy*(c.y-a.y),y=ux*(d.x-a.x)+uy*(d.y-a.y)
        if(Math.min(length,Math.max(x,y))-Math.max(0,Math.min(x,y))>1e-5)return true
      }
    }
    return false
  }
  const order=pieces.map((_,i)=>i).sort((a,b)=>boxes[a].x0-boxes[b].x0)
  for(let a=0;a<order.length;a++)for(let b=a+1;b<order.length&&boxes[order[b]].x0<=boxes[order[a]].x1+1e-6;b++){
    const i=order[a],j=order[b]
    if(root(i)!==root(j)&&close(boxes[i],boxes[j])&&adjacent(pieces[i],pieces[j]))parents[root(j)]=root(i)
  }
  const groups=new Map<number,StreetPolygon[]>()
  pieces.forEach((p,i)=>{const id=root(i),group=groups.get(id);if(group)group.push(p);else groups.set(id,[p])})
  return [...groups.values()]
}

/** Exact convex-piece area containment also detects a road or reservation
 * crossing the middle of a footprint whose four corners look valid. */
export function landContains(pieces:StreetPolygon[],polygon:StreetPolygon){
  const box=bounds(polygon),covered=pieces.reduce((sum,p)=>sum+(close(box,bounds(p))?polygonArea(intersectStreetPolygons(polygon,p)):0),0)
  return Math.abs(covered-polygonArea(polygon))<1e-5
}

/** Roads and reserved land are subtracted before any buildings are proposed.
 * Connected remnants are blocks; frontage seeds partition each block with
 * bisectors, then a depth cap keeps unserved interiors unallocated. All shapes
 * are convex pieces, so concave blocks and reservation holes need no fake
 * rectangle or loss of land. This is a flat, local subdivision, not zoning. */
export function planStreetParcels(site:StreetParcelSite,radius:number){
  if(site.maximumFrontage!==undefined&&(!Number.isFinite(site.maximumFrontage)||site.maximumFrontage<=0))throw Error('Invalid parcel frontage limit')
  const origin={...site.streets[0],azimuth:site.azimuth,axial:site.axial}
  let pieces=[rectangle(site.bounds)]
  const obstacles=[...site.reserves,...site.streets.filter(p=>p.level===0).flatMap(path=>{
    const expanded={...path,width:path.width+2*(getStreetProfile(path.kind,radius).sidewalk+1)}
    return streetPathSurfaces(expanded,radius).map(s=>relativeStreetPolygon(s,origin,radius))
  })]
  for(const obstacle of obstacles){
    const box=bounds(obstacle)
    pieces=pieces.flatMap(p=>close(bounds(p),box)?subtractStreetPolygon(p,obstacle):[p])
  }
  const blocks:StreetLandBlock[]=components(pieces).map((pieces,i)=>({id:`${site.id}:block-${i}`,pieces,area:area(pieces)}))
  let seed=site.seed
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  type Seed={front:StreetParcel['front'];point:Point;block:StreetLandBlock;pitch:number;depth:number}
  const seeds:Seed[]=[]
  for(const path of site.streets.filter(p=>p.level===0))for(const side of [-1,1] as const){
    const samples=streetPathSamples(path),distances=[0]
    for(let i=1;i<samples.length;i++)distances.push(distances[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y))
    for(let s=24;s<distances.at(-1)!-24;){
      const pitch=22+random()*18,depth=24+random()*28;s+=pitch/2
      if(s>distances.at(-1)!-20)break
      let i=1;while(i<distances.length-1&&distances[i]<s)i++
      const t=samples[i-1].t+(samples[i].t-samples[i-1].t)*(s-distances[i-1])/(distances[i]-distances[i-1])
      const p=sampleStreetPath(path,t,side*(path.width/2+getStreetProfile(path.kind,radius).sidewalk+1.5))
      const x=Math.atan2(Math.sin(path.azimuth-site.azimuth),Math.cos(path.azimuth-site.azimuth))*radius+p.x,y=path.axial-site.axial+p.y
      const block=blocks.find(b=>b.pieces.some(p=>containsStreetPolygon(p,x,y)))
      if(block&&!seeds.some(q=>q.block===block&&Math.hypot(q.point.x-x,q.point.y-y)<12))seeds.push({front:{streetId:path.id,t,side,point:{x,y},heading:p.heading},point:{x,y},block,pitch,depth})
      s+=pitch/2
    }
  }
  const parcels:StreetParcel[]=[]
  for(const [i,s] of seeds.entries()){
    let cell=rectangle(site.bounds)
    if(site.maximumFrontage!==undefined){
      const x=Math.cos(s.front.heading),y=Math.sin(s.front.heading),centre=x*s.point.x+y*s.point.y,half=site.maximumFrontage/2
      cell=clipStreetPolygon(cell,x,y,half-centre)
      cell=clipStreetPolygon(cell,-x,-y,half+centre)
    }
    for(const other of seeds){
      if(other===s||other.block!==s.block)continue
      const dx=s.point.x-other.point.x,dy=s.point.y-other.point.y
      cell=clipStreetPolygon(cell,dx,dy,(other.point.x**2+other.point.y**2-s.point.x**2-s.point.y**2)/2)
      if(!cell.length)break
    }
    if(!cell.length)continue
    const normal={x:-Math.sin(s.front.heading)*s.front.side,y:Math.cos(s.front.heading)*s.front.side}
    cell=clipStreetPolygon(cell,-normal.x,-normal.y,normal.x*s.point.x+normal.y*s.point.y+s.depth)
    if(!cell.length)continue
    const box=bounds(cell),clipped=s.block.pieces.filter(p=>close(box,bounds(p))).map(p=>intersectStreetPolygons(p,cell)).filter(p=>p.length)
    const owned=components(clipped).find(ps=>ps.some(p=>containsStreetPolygon(p,s.point.x,s.point.y)))
    if(!owned)continue
    // Fit from the certified road-facing edge inward. A narrow corner reduces
    // the building; it never expands the parcel into its neighbour or pavement.
    const c=Math.cos(s.front.heading),sn=Math.sin(s.front.heading)
    let fit:StreetParcel['building']|undefined
    const sizes:{width:number;depth:number}[]=[]
    for(let width=Math.min(34,s.pitch-4);width>=10;width-=2)for(let depth=Math.min(42,s.depth-3);depth>=10;depth-=2){
      sizes.push({width,depth})
    }
    sizes.sort((a,b)=>b.width*b.depth-a.width*a.depth)
    for(const{width,depth}of sizes){
      const x=s.point.x+normal.x*(depth/2+.6),y=s.point.y+normal.y*(depth/2+.6)
      const footprint=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>vertex(x+c*a*(width/2+1)-sn*b*(depth/2+.4),y+sn*a*(width/2+1)+c*b*(depth/2+.4)))
      if(landContains(owned,footprint)){fit={x,y,width,depth,yaw:s.front.heading};break}
    }
    if(fit)parcels.push({id:`${site.id}:parcel-${i}`,blockId:s.block.id,pieces:owned,area:area(owned),front:s.front,building:fit})
  }
  return{blocks,parcels,unallocatedArea:area(pieces)-parcels.reduce((sum,p)=>sum+p.area,0)}
}
