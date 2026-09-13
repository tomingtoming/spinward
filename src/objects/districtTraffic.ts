import type { DistrictTrafficStreet } from './nativeDistricts'
import { sampleStreetPath, streetPathSamples } from './streetPath'
import type { StreetSignalPlan } from './streetSignals'
import type { TrafficPosition } from './riverTraffic'
import { trafficRoadKey,planTrafficRoadSpans,type TrafficRoadSpan } from './trafficRoadSpans'
import type { CityRoad } from './cityLayout'
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
/** Keep a through car's station, identity and queue across the old/new boundary.
 * Only the bounded bend is sampled; the long outside approaches remain exact. */
export class DistrictTrafficPath {
  readonly samples
  readonly vertical
  readonly stations: number[]
  private readonly yields: {along:number;azimuth:number;axial:number;heading:number;setback:number}[]=[]
  constructor(readonly source:DistrictTrafficStreet,readonly radius:number,signals?:StreetSignalPlan){
    this.vertical=source.road.axialLength>source.road.tangentWidth
    this.samples=streetPathSamples(source.path)
    this.stations=this.samples.map(p=>this.vertical?source.path.axial+p.y:wrap(source.path.azimuth-source.road.azimuth)*radius+p.x)
    if(this.stations.some((s,i)=>i>0&&s<=this.stations[i-1]))throw Error('Traffic station must advance along a district road')
    if(signals){
      const network=signals.markings.network,rank={arterial:3,collector:2,local:1,alley:0}
      for(const junction of signals.markings.junctions){
        const own=junction.arms.find(a=>network.streets[a.street].id===source.path.id)
        if(!own)continue
        const node=network.nodes[junction.node]
        if(signals.controlsJunction(node.azimuth,node.axial))continue
        const others=junction.arms.filter(a=>Math.abs(a.dx*own.dy-a.dy*own.dx)>.1)
        // At the perimeter, existing through traffic keeps priority. Within
        // the new district, class then the axial spine breaks equal-road ties.
        const minor=others.some(a=>{const p=network.streets[a.street];return !p.id.startsWith('district-')||rank[p.kind]>rank[source.path.kind]||rank[p.kind]===rank[source.path.kind]&&!this.vertical})
        if(!minor)continue
        const half=Math.max(...others.map(a=>network.streets[a.street].width/2/Math.abs(a.dx*own.dy-a.dy*own.dx)))
        this.yields.push({along:this.vertical?node.axial:wrap(node.azimuth-source.road.azimuth)*radius,azimuth:node.azimuth,axial:node.axial,
          heading:Math.atan2(own.dx,own.dy),setback:half+4})
      }
    }
  }
  sample(along:number,offset:number,direction:1|-1){
    const {path,road}=this.source,n=this.stations.length
    if(along<this.stations[0]||along>this.stations[n-1])return{
      azimuth:road.azimuth+(this.vertical?-offset:along)/this.radius,axial:this.vertical?along:road.axial+offset,
      heading:this.vertical?(direction===1?0:Math.PI):direction*Math.PI/2,height:.2,stationRate:1
    }
    let lo=0,hi=n-1
    while(hi-lo>1){const mid=(lo+hi)>>>1;if(this.stations[mid]<=along)lo=mid;else hi=mid}
    const a=this.samples[lo],b=this.samples[hi],t=a.t+(b.t-a.t)*(along-this.stations[lo])/(this.stations[hi]-this.stations[lo])
    const p=sampleStreetPath(path,t,offset)
    // Physical speed remains in metres/second; progression in the old station
    // coordinate contracts on an oblique segment instead of accelerating cars.
    const stationRate=Math.abs(this.vertical?Math.sin(p.heading):Math.cos(p.heading))
    return{azimuth:path.azimuth+p.x/this.radius,axial:path.axial+p.y,heading:Math.PI/2-p.heading+(direction===1?0:Math.PI),height:.2,stationRate}
  }
  yieldGap(along:number,direction:1|-1,cars:readonly TrafficPosition[]){
    let gap=Infinity
    for(const gate of this.yields){
      const ahead=(gate.along-along)*direction-gate.setback
      if(ahead<0||ahead>45)continue
      const busy=cars.some(car=>{
        if(car.height>1||Math.abs(Math.sin(car.heading-gate.heading))<.25)return false
        const dx=wrap(car.azimuth-gate.azimuth)*this.radius,dy=car.axial-gate.axial
        const across=dx*Math.cos(car.heading)-dy*Math.sin(car.heading),forward=dx*Math.sin(car.heading)+dy*Math.cos(car.heading)
        return Math.abs(across)<8&&forward> -10-car.speed*2&&forward<8
      })
      if(busy)gap=Math.min(gap,ahead+3.2)
    }
    return gap
  }
}

/** One physical through road may bend through several adjacent districts.
 * Preserve one car/queue/visibility identity and dispatch to its local piece. */
export class DistrictTrafficRoute {
  readonly pieces: DistrictTrafficPath[]
  readonly source: DistrictTrafficStreet
  constructor(readonly sources:readonly DistrictTrafficStreet[],radius:number,signals?:StreetSignalPlan){
    this.pieces=sources.map(s=>new DistrictTrafficPath(s,radius,signals)).sort((a,b)=>a.stations[0]-b.stations[0])
    if(!this.pieces.length)throw Error('A district traffic route needs a source')
    for(let i=1;i<this.pieces.length;i++)if(this.pieces[i].stations[0]<this.pieces[i-1].stations.at(-1)!-.01)throw Error('Overlapping district traffic pieces')
    this.source={...sources[0],sourceRoadIds:[...new Set(sources.flatMap(s=>s.sourceRoadIds))]}
  }
  sample(along:number,offset:number,direction:1|-1){
    const piece=this.pieces.find(p=>along>=p.stations[0]&&along<=p.stations.at(-1)!)??this.pieces[0]
    return piece.sample(along,offset,direction)
  }
  yieldGap(along:number,direction:1|-1,cars:readonly TrafficPosition[]){
    return Math.min(...this.pieces.map(p=>p.yieldGap(along,direction,cars)))
  }
}

export function planDistrictTraffic(sources:readonly DistrictTrafficStreet[],radius:number,signals?:StreetSignalPlan){
  const groups=new Map<string,DistrictTrafficStreet[]>()
  for(const source of sources){const key=trafficRoadKey(source.road),group=groups.get(key)??[];group.push(source);groups.set(key,group)}
  return new Map([...groups].map(([key,group])=>[key,new DistrictTrafficRoute(group,radius,signals)]))
}

/** A later district may terminate a former through road. Only existing legacy
 * ribbons and authored curved pieces can carry its fleet; straight fallback
 * sampling alone is not evidence that a road still exists at that station. */
export function districtTrafficCoverage(routes:ReadonlyMap<string,DistrictTrafficRoute>,roads:readonly CityRoad[],radius:number){
  const mapped=new Map<string,DistrictTrafficRoute>(),spans:TrafficRoadSpan[]=[]
  for(const route of routes.values()){
    const source=route.source,vertical=source.road.axialLength>source.road.tangentWidth
    let covered:CityRoad[]=[source.road]
    if(vertical){
      const ids=new Set(source.sourceRoadIds)
      covered=[...roads.filter(r=>ids.has(r.id??'')),...route.pieces.map(p=>({...source.road,axial:(p.stations[0]+p.stations.at(-1)!)/2,axialLength:p.stations.at(-1)!-p.stations[0]}))]
    }
    for(const span of planTrafficRoadSpans(covered,radius)){
      spans.push({...span,sourceRoadIds:source.sourceRoadIds})
      mapped.set(trafficRoadKey(span.road),route)
    }
  }
  return{routes:mapped,spans}
}
