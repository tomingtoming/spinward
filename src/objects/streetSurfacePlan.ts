import type { CityRoad } from './cityLayout'
import { SurfaceIndex } from './surfaceIndex'
import { streetPathSamples, sampleStreetPath, legacyStreetPaths, type StreetPath } from './streetPath'
import { getStreetProfile, SIDEWALK_LIFT } from './streetProfile'
import { positivePolygon, intersectStreetPolygons, subtractStreetPolygon, type StreetPolygon } from './streetPolygon'

export type StreetSurface = { source:StreetPath; polygon:StreetPolygon; junction:boolean; lift:number }
type Envelope={azimuth:number;axial:number;tangentWidth:number;axialLength:number}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
export function streetSurfaceEnvelope(s:StreetSurface,radius:number):Envelope{
 let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity
 for(const p of s.polygon){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y)}
 return{azimuth:s.source.azimuth+(x0+x1)/(2*radius),axial:s.source.axial+(y0+y1)/2,tangentWidth:x1-x0,axialLength:y1-y0}
}
export function relativeStreetPolygon(s:StreetSurface,origin:StreetPath,radius:number){
 const x=wrap(s.source.azimuth-origin.azimuth)*radius,y=s.source.axial-origin.axial
 if(x===0&&y===0)return s.polygon
 return s.polygon.map(p=>({...p,x:p.x+x,y:p.y+y}))
}
export function streetPathSurfaces(path:StreetPath,radius:number,walk=false):StreetSurface[]{
 const width=getStreetProfile(path.kind,radius).sidewalk
 if(walk&&!width)return[]
 // Include the outer footway in the curvature tolerance, not just the road edge.
 const samples=streetPathSamples(walk?{...path,width:path.width+2*width}:path)
 const a=path.knots[0].point,b=path.knots.at(-1)!.point,dx=b[0]-a[0],dy=b[1]-a[1]
 const axial=Math.abs(dy)>Math.abs(dx),uvSign=axial?-1:1
 let distance=axial?path.axial+a[1]:path.azimuth*radius+a[0]
 const out:StreetSurface[]=[]
 for(let i=1;i<samples.length;i++){
  const length=Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y)
  for(const side of walk?[-1,1]:[0]){
   const lo=side===0?-path.width/2:side*path.width/2,hi=side===0?path.width/2:side*(path.width/2+width)
   const corners=[[i-1,lo],[i,lo],[i,hi],[i-1,hi]]
   const polygon=positivePolygon(corners.map(([j,offset])=>{
    const p=sampleStreetPath(path,samples[j].t,offset)
    return{x:p.x,y:p.y,u:walk?(Math.abs(offset)-path.width/2)/width:.5+uvSign*offset/path.width,v:distance+(j===i?length:0)}
   }))
   out.push({source:path,polygon,junction:false,lift:walk?(path.walkHeight??path.groundHeight+SIDEWALK_LIFT):Math.max(.2,path.groundHeight)})
  }
  distance+=length
 }
 return out
}
class SurfaceOwners{
 readonly surfaces:StreetSurface[]=[]
 private readonly index:SurfaceIndex
 private readonly envelopes:Envelope[]=[]
 private readonly wrappedX:number[]=[]
 constructor(private readonly radius:number){this.index=new SurfaceIndex(radius)}
 candidates(s:StreetSurface){
  const e=streetSurfaceEnvelope(s,this.radius),period=2*Math.PI*this.radius,x=((e.azimuth*this.radius)%period+period)%period
  const out:StreetSurface[]=[]
  for(const i of this.index.query(e)){
   const b=this.envelopes[i],dx=Math.abs(x-this.wrappedX[i])
   if(Math.abs(e.axial-b.axial)>=(e.axialLength+b.axialLength)/2-1e-7||Math.min(dx,period-dx)>=(e.tangentWidth+b.tangentWidth)/2-1e-7)continue
   out.push(this.surfaces[i])
  }
  return out
 }
 add(s:StreetSurface){
  const e=streetSurfaceEnvelope(s,this.radius),period=2*Math.PI*this.radius
  this.index.insert(e,this.surfaces.length);this.surfaces.push(s);this.envelopes.push(e);this.wrappedX.push(((e.azimuth*this.radius)%period+period)%period)
 }
 cut(s:StreetSurface,obstacles:StreetSurface[]){
  let pieces=[s.polygon]
  for(const other of obstacles){
   if(other.source.level!==s.source.level)continue
   const clip=relativeStreetPolygon(other,s.source,this.radius)
   pieces=pieces.flatMap(p=>subtractStreetPolygon(p,clip));if(!pieces.length)break
  }
  return pieces.map(polygon=>({...s,polygon}))
 }
 own(s:StreetSurface){const pieces=this.cut(s,this.candidates(s));this.add(s);return pieces}
}
/** One static pavement owner per point. The same clipping works for a diagonal
 * T junction, an ordinary crossroads and a bend; no axis-aligned road boxes. */
export class StreetSurfacePlan{
 private readonly junctions:StreetSurface[]=[]
 readonly sources:readonly StreetPath[]
 private readonly carriageways:SurfaceOwners
 constructor(paths:readonly StreetPath[],readonly radius:number){
  this.sources=paths.filter(p=>p.surfaceOwner!=='authored')
  this.carriageways=new SurfaceOwners(radius)
  const junctions=this.junctions
  for(const path of this.sources)for(const s of streetPathSurfaces(path,radius)){
   for(const other of this.carriageways.candidates(s)){
    if(other.source===path||other.source.level!==path.level)continue
    const a=s.polygon[1],b=s.polygon[0],c=other.polygon[1],d=other.polygon[0]
    // Parallel copies are subtracted too, but do not acquire crossing paint.
    const cross=(a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x)
    if(Math.abs(cross)<1e-7)continue
    const polygon=intersectStreetPolygons(s.polygon,relativeStreetPolygon(other,path,radius))
    if(polygon.length)junctions.push({...s,polygon,junction:true})
   }
   this.carriageways.add(s)
  }
 }
 roadSurfaces(){
  const owners=new SurfaceOwners(this.radius),roads:StreetSurface[]=[]
  for(const s of [...this.junctions,...this.carriageways.surfaces])roads.push(...owners.own(s))
  return roads
 }
 sidewalks(isOpenSquare:(azimuth:number,axial:number)=>boolean=()=>false,additionalCuts:CityRoad[]=[]){
  const exclusions=new SurfaceOwners(this.radius),owners=new SurfaceOwners(this.radius),out:StreetSurface[]=[]
  for(const path of legacyStreetPaths(additionalCuts))for(const s of streetPathSurfaces(path,this.radius))exclusions.add(s)
  for(const path of this.sources)for(const s of streetPathSurfaces(path,this.radius,true)){
   const pieces=owners.cut(s,[...this.carriageways.candidates(s),...exclusions.candidates(s)])
   for(const piece of pieces)for(const unique of owners.own(piece)){
    const e=streetSurfaceEnvelope(unique,this.radius)
    if(!isOpenSquare(e.azimuth,e.axial))out.push(unique)
   }
  }
  return out
 }
}
