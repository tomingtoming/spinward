import { metroSurfaceLocation } from './metroPlacement'
import type { SurfacePoint } from '../app/neighborhoodRoute'

export const METRO_DIRECTIONS = [
  { id: 'guide-metro-tokyo', label: '東京駅周辺' },
  { id: 'guide-metro-palace', label: '皇居・竹橋' },
  { id: 'guide-metro-suidobashi', label: '水道橋駅周辺' }
] as const

export function metroRoadsMatchStudy(roads:{version:number;region:string;band:number;radius:number;span:number;frames:unknown;bridges:{band:number}[]},
  study:{radius:number;span:number;samples:{id:string;band:number;frame:unknown}[]}) {
  return roads.version===1&&roads.radius===study.radius&&roads.span===study.span&&
    study.samples.some(s=>s.id===roads.region&&s.band===roads.band)&&
    JSON.stringify(roads.frames)===JSON.stringify(study.samples.map(s=>[s.id,s.band,s.frame]))&&
    roads.bridges.every(b=>b.band===roads.band)
}

type XY = readonly number[]
export type RoadNetwork = {
  band: number; radius: number; nodes: number[][]; edges: number[][]
  walkable: number[][][][]; places: { id: string; label: string; node: number }[]
}
const cross = (a: XY, b: XY) => a[0]*b[1]-a[1]*b[0]
const subtract = (a: XY, b: XY) => [a[0]-b[0], a[1]-b[1]]

function inRing(point: XY, ring: number[][]) {
  let inside = false
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i],d=subtract(b,a),q=subtract(point,a)
    if(d[0]*d[0]+d[1]*d[1]<1e-16)continue
    if(Math.abs(cross(d,q))<1e-6 && q[0]*d[0]+q[1]*d[1]>=0 && q[0]*d[0]+q[1]*d[1]<=d[0]*d[0]+d[1]*d[1])return true
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
  }
  return inside
}

/** Test every interval between polygon crossings. Clear endpoints alone would
 * allow a snap through a thin wall or a moat; fixed-step sampling would too. */
export function roadConnectorClear(polygons: number[][][][], a: XY, b: XY) {
  const covers=(p:XY)=>polygons.some(poly=>inRing(p,poly[0])&&!poly.slice(1).some(hole=>inRing(p,hole)))
  if(!covers(a)||!covers(b))return false
  const d=subtract(b,a),cuts=[0,1]
  for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++) {
    const e=subtract(ring[i],ring[i-1]),delta=subtract(ring[i-1],a),den=cross(d,e)
    if(Math.abs(den)<1e-10)continue
    const t=cross(delta,e)/den,u=cross(delta,d)/den
    if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t)
  }
  cuts.sort((a,b)=>a-b)
  return cuts.slice(1).every((end,i)=>{const t=(end+cuts[i])/2;return covers([a[0]+d[0]*t,a[1]+d[1]*t])})
}

export class MetroRoads {
  private neighbors: {to:number;length:number;crossing:boolean;bridge:boolean}[][]
  constructor(readonly data:RoadNetwork) {
    this.neighbors=data.nodes.map(()=>[])
    for(const [a,b,crossing,bridge] of data.edges) {
      const p=data.nodes[a],q=data.nodes[b],length=Math.hypot(p[0]-q[0],p[1]-q[1])
      this.neighbors[a].push({to:b,length,crossing:!!crossing,bridge:!!bridge})
      this.neighbors[b].push({to:a,length,crossing:!!crossing,bridge:!!bridge})
    }
  }
  route(start:SurfacePoint,placeId:string):SurfacePoint[]|null {
    const {data}=this,goal=data.places.find(p=>p.id===placeId)
    if(!goal)return null
    const angle=-start.azimuth-data.band*Math.PI*2/3
    const origin=[Math.atan2(Math.sin(angle),Math.cos(angle))*data.radius,-start.axial]
    const costs=data.nodes.map(()=>Infinity),previous=data.nodes.map(()=>-1),roots=new Map<number,number[]>(),flags=new Map<number,{crossing:boolean;bridge:boolean}>()
    const candidates=data.edges.map(([a,b,crossing,bridge])=>{
      const p=data.nodes[a],q=data.nodes[b],dx=q[0]-p[0],dy=q[1]-p[1]
      const t=Math.max(0,Math.min(1,((origin[0]-p[0])*dx+(origin[1]-p[1])*dy)/(dx*dx+dy*dy||1)))
      const point=p.map((v,i)=>v+(q[i]-v)*t)
      return{a,b,t,point,crossing:!!crossing,bridge:!!bridge,distance:Math.hypot(point[0]-origin[0],point[1]-origin[1])}
    }).filter(c=>c.distance<=8&&start.groundHeight!==undefined&&Math.abs(c.point[2]-start.groundHeight)<1.2).sort((a,b)=>a.distance-b.distance)
    for(const c of candidates.slice(0,12)) {
      if(!roadConnectorClear(data.walkable,origin,c.point))continue
      for(const node of [c.a,c.b]){
        const p=data.nodes[node],cost=c.distance+Math.hypot(p[0]-c.point[0],p[1]-c.point[1])
        if(cost<costs[node]){costs[node]=cost;roots.set(node,c.point);flags.set(node,c)}
      }
    }
    const visited=new Set<number>()
    for(;;){
      let a=-1,best=Infinity
      for(let i=0;i<costs.length;i++)if(!visited.has(i)&&costs[i]<best){a=i;best=costs[i]}
      if(a<0)return null
      if(a===goal.node)break
      visited.add(a)
      for(const e of this.neighbors[a])if(best+e.length<costs[e.to]){
        costs[e.to]=best+e.length;previous[e.to]=a;roots.delete(e.to);flags.set(e.to,e)
      }
    }
    const path:number[]=[];let n=goal.node
    while(n>=0){path.push(n);n=previous[n]}
    path.reverse()
    const point=(p:number[],flag?:{crossing:boolean;bridge:boolean}):SurfacePoint=>({
      ...metroSurfaceLocation(data.band,p[0],p[1],data.radius),groundHeight:p[2],
      ...(flag?.crossing?{crosswalk:true}:{}),...(flag?.bridge?{riverWalk:'bridge' as const}:{})
    })
    const result=[start,point(roots.get(path[0])!,flags.get(path[0])),...path.map(n=>point(data.nodes[n],flags.get(n)))]
    const compact=result.filter((p,i)=>i===0||Math.hypot((p.azimuth-result[i-1].azimuth)*data.radius,p.axial-result[i-1].axial)>.05)
    return compact.length>1?compact:[compact[0],compact[0]]
  }
}
