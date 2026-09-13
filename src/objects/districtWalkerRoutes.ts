import type { CityPlan } from './cityLayout'
import type { StreetWalkerRoute,WalkerPathPoint } from './streetWalkerRoutes'
import { sampleStreetPath,streetRibbon } from './streetPath'
import { getStreetProfile } from './streetProfile'
import { containsStreetPolygon } from './streetPolygon'

type RouteCache={graph:CityPlan['streetNetwork'];markings:CityPlan['streetMarkings'];chunks:Map<string,StreetWalkerRoute[]>}
const nearbyCaches=new WeakMap<CityPlan,RouteCache>()

/** Compile only nearby, stable 64 m walks. Crossroads are cut out before a
 * resident is allocated, and the existing population/instance cap stays final. */
export function planDistrictWalkerRoutes(city:CityPlan,focus:{azimuth:number;axial:number;range:number}):StreetWalkerRoute[]{
 const graph=city.streetNetwork,markings=city.streetMarkings
 if(!graph||!markings||!city.nativeDistricts?.length)return[]
 let cache=nearbyCaches.get(city)
 if(!cache||cache.graph!==graph||cache.markings!==markings){cache={graph,markings,chunks:new Map()};nearbyCaches.set(city,cache)}
 const radius=graph.radius,ids=new Set(city.nativeDistricts.flatMap(d=>d.streets.map(p=>p.id))),chunks=new Set<string>(),routes:StreetWalkerRoute[]=[]
 for(const segment of graph.query(focus.azimuth,focus.axial,focus.range*2,focus.range*2)){
  if(!ids.has(graph.streets[segment.street].id))continue
  for(let i=Math.floor(segment.distanceStart/64);i<=Math.floor(segment.distanceEnd/64);i++)chunks.add(`${segment.street}:${i}`)
 }
 for(const key of chunks){
  const previous=cache.chunks.get(key)
  if(previous){routes.push(...previous);continue}
  const compiled:StreetWalkerRoute[]=[]
  cache.chunks.set(key,compiled)
  const [street,chunk]=key.split(':').map(Number),source=graph.streets[street],start=chunk*64+3,end=Math.min((chunk+1)*64-3,graph.streetLengths[street]-3)
  if(end-start<14)continue
  for(const side of [-1,1]){
   const path:WalkerPathPoint[]=[],offset=side*(source.width/2+getStreetProfile(source.kind,radius).sidewalk-.7),count=Math.ceil(end-start)
   let clear=true
   for(let i=0;i<=count;i++){
    const p=sampleStreetPath(source,markings.parameterAt(street,start+(end-start)*i/count),offset)
    const azimuth=source.azimuth+p.x/radius,axial=source.axial+p.y
    if(graph.query(azimuth,axial,1.2,1.2).some(s=>{
     if(s.street===street)return false
     const other=graph.streets[s.street],x=Math.atan2(Math.sin(azimuth-other.azimuth),Math.cos(azimuth-other.azimuth))*radius
     return containsStreetPolygon(streetRibbon(other,s.start.t,s.end.t,-other.width/2-.6,other.width/2+.6),x,axial-other.axial)
    })){clear=false;break}
    const previous=path.at(-1),distance=previous?previous.distance+Math.hypot((azimuth-previous.azimuth)*radius,axial-previous.axial):0
    path.push({azimuth,axial,height:source.walkHeight??.32,distance})
   }
   if(!clear)continue
   const variant=(street+chunk+(side>0?3:0))%6
   compiled.push({id:`native:${source.id}:${chunk}:${side}`,azimuth:path[0].azimuth,axial:path[0].axial,tangentWidth:1,axialLength:1,axis:'axial',
    length:path.at(-1)!.distance,height:.32,speed:.88+variant*.06,phase:chunk*17+variant*9,variant,path})
  }
  routes.push(...compiled)
 }
 // Cache only the current neighbourhood; travelling does not retain a city of
 // paths. Existing residents keep their own route until they leave the range.
 for(const key of cache.chunks.keys())if(!chunks.has(key))cache.chunks.delete(key)
 return routes
}
