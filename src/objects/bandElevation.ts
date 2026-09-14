import { bandRiverCentre } from './bandLand'
import type { BandExpressway } from './bandExpressway'
import type { BandPoint } from './bandStreetPlan'
import { intersectStreetPolygons, polygonArea, positivePolygon, type StreetPolygon } from './streetPolygon'

/** Colony design values in metres above the pressure hull, not civil standards.
 * Soil is added above the hull: the channel never cuts through its zero level. */
export const BAND_LEVELS={bed:.12,water:.65,lowerWalk:1.2,bank:5,paving:.2,
  riverDeckDepth:.55,expressway:10.2,expressDeckDepth:1,flyoverRise:7,
  vehicleClearance:4.5,maximumGrade:.06} as const
export type BandVertex=[x:number,y:number,height:number]
export type BandMesh={vertices:BandVertex[];indices:number[]}
export type ElevatedRoad={id:string;from:string;to:string;width:number;depth:number;samples:BandVertex[]}
const smooth=(t:number)=>t*t*(3-2*t)
const clamp=(t:number)=>Math.max(0,Math.min(1,t))

export function bandBankHeight(offset:number) {
  return BAND_LEVELS.bank*(1-smooth(clamp((Math.abs(offset)-30)/125)))
}
export function bandSoilHeight(point:BandPoint) {
  const d=Math.abs(point[0]-bandRiverCentre(point[1]))
  return d<9.5?BAND_LEVELS.bed:d<18?BAND_LEVELS.lowerWalk:bandBankHeight(d)
}
export function bandRoadHeight(point:BandPoint,bridge=false) {
  return BAND_LEVELS.paving+(bridge?bandBankHeight(point[0]-bandRiverCentre(point[1])):bandSoilHeight(point))
}

/** Arclength samples, including every source knot. Heights are evaluated here
 * once and consumed by both the deck mesh and the clearance/grade audit. */
export function sampleElevatedRoad(points:BandPoint[],height:(fraction:number)=>number,step=5):BandVertex[] {
  if(points.length<2||!Number.isFinite(step)||step<=0||!points.flat().every(Number.isFinite))throw Error('Invalid elevation path')
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),total=lengths.reduce((a,b)=>a+b,0)
  if(lengths.some(l=>l<1e-6))throw Error('Degenerate elevation path')
  const out:BandVertex[]=[];let distance=0
  lengths.forEach((length,i)=>{
    const count=Math.ceil(length/step),a=points[i],b=points[i+1]
    for(let k=0;k<count;k++){
      const t=k/count,h=height((distance+length*t)/total)
      if(!Number.isFinite(h))throw Error('Invalid elevation')
      out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,h])
    }
    distance+=length
  })
  const h=height(1);if(!Number.isFinite(h))throw Error('Invalid elevation')
  out.push([...points.at(-1)!,h]);return out
}

/** A structure label alone cannot prove clearance. Current and legacy
 * alignments use the same sampled heights and finite-width audit. */
export function proposeExpresswayElevations(plan:BandExpressway):ElevatedRoad[] {
  const nodes=new Map(plan.nodes.map(n=>[n.id,n]))
  return plan.edges.map(e=>{
    const start=nodes.get(e.from)!.level===0?BAND_LEVELS.paving:BAND_LEVELS.expressway
    const end=nodes.get(e.to)!.level===0?BAND_LEVELS.paving:BAND_LEVELS.expressway
    const flat=e.levelEndLength??0
    if(!Number.isFinite(flat)||flat<0||2*flat>=e.length)throw Error('Invalid level ramp ends')
    const rise=e.structure==='flyover'?BAND_LEVELS.flyoverRise:e.structure==='underpass'?-BAND_LEVELS.flyoverRise:0
    return {id:e.id,from:e.from,to:e.to,width:e.lanes*3.5+2,depth:e.structure==='ground'?.2:BAND_LEVELS.expressDeckDepth,
      samples:sampleElevatedRoad(e.points,t=>{const u=clamp((t*e.length-flat)/(e.length-2*flat));return start+(end-start)*smooth(u)+rise*Math.sin(Math.PI*u)**2})}
  })
}

/** Shared mitered ribbon. The top triangles below are exactly those audited.
 * The geometry adapter extrudes these same triangles into a solid deck. */
export function elevatedRoadMesh(road:ElevatedRoad):BandMesh {
  const vertices:BandVertex[]=[],indices:number[]=[],p=road.samples
  for(let i=0;i<p.length;i++){
    const direction=(a:BandVertex,b:BandVertex)=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]);return [(b[0]-a[0])/l,(b[1]-a[1])/l]}
    const a=direction(p[Math.max(0,i-1)],p[Math.max(1,i)]),b=direction(p[Math.min(i,p.length-2)],p[Math.min(i+1,p.length-1)])
    const nx=-a[1]-b[1],ny=a[0]+b[0],l=Math.hypot(nx,ny),dot=(nx*-b[1]+ny*b[0])/l
    if(!Number.isFinite(dot)||dot<.5)throw Error('Road corner requires a turning design: '+road.id)
    const scale=road.width/2/(l*dot)
    for(const s of [-1,1])vertices.push([p[i][0]+s*nx*scale,p[i][1]+s*ny*scale,p[i][2]])
  }
  for(let i=1;i<p.length;i++){const a=(i-1)*2,b=i*2;indices.push(a,b,a+1,b,b+1,a+1)}
  return {vertices,indices}
}

type Face={road:number;points:BandVertex[];polygon:StreetPolygon;x0:number;x1:number;y0:number;y1:number}
const heightOn=(f:Face,x:number,y:number)=>{
  const [a,b,c]=f.points,den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const u=((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/den,v=((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/den
  return a[2]+u*(b[2]-a[2])+v*(c[2]-a[2])
}

/** Finite-width, piecewise-planar audit in developed cylinder coordinates.
 * Exact overlap clipping tests edges even when their centrelines never cross.
 * Small co-planar overlaps at an explicit shared endpoint are join areas, not
 * grade-separated crossings. Their geometry still needs a single surface owner.
 * This does not certify curve speed, bank/crossfall, supports or crash barriers. */
export function auditElevatedRoads(roads:ElevatedRoad[],clearance:number=BAND_LEVELS.vehicleClearance) {
  const faces:Face[]=[],grid=new Map<string,number[]>(),cell=64
  const keys=(f:Face)=>{const out:string[]=[];for(let x=Math.floor(f.x0/cell);x<=Math.floor(f.x1/cell);x++)for(let y=Math.floor(f.y0/cell);y<=Math.floor(f.y1/cell);y++)out.push(`${x}:${y}`);return out}
  const overlaps=new Map<string,{a:string;b:string;minimumClearance:number;point:BandPoint;sharedNode:boolean;pieces:number}>()
  roads.forEach((road,ri)=>{
    const mesh=elevatedRoadMesh(road)
    for(let i=0;i<mesh.indices.length;i+=3){
      const points=mesh.indices.slice(i,i+3).map(j=>mesh.vertices[j]),polygon=positivePolygon(points.map(p=>({x:p[0],y:p[1],u:0,v:0})))
      const f:Face={road:ri,points,polygon,x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1]))}
      for(const j of new Set(keys(f).flatMap(k=>grid.get(k)??[]))){
        const g=faces[j];if(g.road===ri||f.x0>=g.x1||f.x1<=g.x0||f.y0>=g.y1||f.y1<=g.y0)continue
        const clip=intersectStreetPolygons(f.polygon,g.polygon)
        if(Math.abs(polygonArea(clip))<1e-5)continue
        const other=roads[g.road],shared=[road.from,road.to].filter(id=>id===other.from||id===other.to)
        const deltas=clip.map(p=>heightOn(f,p.x,p.y)-heightOn(g,p.x,p.y))
        const joint=shared.some(id=>{
          const p=road.samples[id===road.from?0:road.samples.length-1]
          return clip.every(q=>Math.hypot(q.x-p[0],q.y-p[1])<=60)&&deltas.every(d=>Math.abs(d)<=.15)
        })
        if(joint)continue
        const low=Math.min(...deltas),high=Math.max(...deltas),sign=low>=0?1:high<=0?-1:0
        const gaps=deltas.map(d=>sign===1?d-road.depth:sign===-1?-d-other.depth:-Math.max(road.depth,other.depth))
        const min=Math.min(...gaps),p=clip[gaps.indexOf(min)],key=`${g.road}:${ri}`,old=overlaps.get(key)
        if(!old)overlaps.set(key,{a:other.id,b:road.id,minimumClearance:min,point:[p.x,p.y],sharedNode:shared.length>0,pieces:1})
        else {old.pieces++;if(min<old.minimumClearance){old.minimumClearance=min;old.point=[p.x,p.y]}}
      }
      const index=faces.length;faces.push(f);for(const k of keys(f)){const row=grid.get(k)??[];row.push(index);grid.set(k,row)}
    }
  })
  const grades=roads.map(r=>({id:r.id,maximum:Math.max(...r.samples.slice(1).map((p,i)=>Math.abs(p[2]-r.samples[i][2])/Math.hypot(p[0]-r.samples[i][0],p[1]-r.samples[i][1])))}))
  const crossings=[...overlaps.values()]
  return {grades,crossings,conflicts:crossings.filter(c=>c.minimumClearance<clearance),steep:grades.filter(g=>g.maximum>BAND_LEVELS.maximumGrade),
    limits:{clearance,grade:BAND_LEVELS.maximumGrade},scope:'sampled finite-width deck tops and underside thickness; excludes support design and cylinder curvature in headroom'}
}
