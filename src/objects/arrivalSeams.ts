import type {CityPlan,CityRoad} from './cityLayout'
import type {DistrictTrafficStreet,NativeDistrict} from './nativeDistricts'
import {arrivalStreets,arrivalTrafficStreet,isArrivalStreet} from './arrivalDistrict'
import {legacyStreetPaths} from './streetPath'
import {StreetNetwork} from './streetNetwork'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {certifyStreetAccess} from './streetFrontage'

const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
type Seam={vertical:boolean;at:number;low:number;high:number}
const epsilon=1e-5

/** Only a boundary with rebuilt land on BOTH sides can lose its old road.
 * The outside perimeter continues to serve the surrounding legacy city. */
export function arrivalSeams(districts:readonly NativeDistrict[],radius:number):Seam[]{
  const areas=districts.filter(d=>d.layout==='band-plan'&&d.streets.some(isArrivalStreet)).map(d=>({
    x0:wrap(d.azimuth)*radius-d.width/2,x1:wrap(d.azimuth)*radius+d.width/2,y0:d.axial-d.length/2,y1:d.axial+d.length/2}))
  const seams:Seam[]=[]
  for(let i=0;i<areas.length;i++)for(const b of areas.slice(i+1)){
    const a=areas[i]
    for(const vertical of [true,false]){
      const [axis,along]=vertical?['x','y'] as const:['y','x'] as const
      if(Math.abs(a[`${axis}1`]-b[`${axis}0`])>epsilon&&Math.abs(a[`${axis}0`]-b[`${axis}1`])>epsilon)continue
      const at=Math.abs(a[`${axis}1`]-b[`${axis}0`])<epsilon?a[`${axis}1`]:a[`${axis}0`]
      const low=Math.max(a[`${along}0`],b[`${along}0`]),high=Math.min(a[`${along}1`],b[`${along}1`])
      if(high-low>epsilon)seams.push({vertical,at,low,high})
    }
  }
  return seams
}

export function retireArrivalSeams(city:CityPlan,radius:number){
  const districts=city.nativeDistricts??[],seams=arrivalSeams(districts,radius)
  if(!seams.length||!city.streetNetwork)return {retiredLength:0,retiredPieces:0,seams}
  const surviving=new Map<string,CityRoad[]>()
  let retiredLength=0,retiredPieces=0
  const roads:CityRoad[]=city.roads.flatMap(r=>{
    const vertical=r.axialLength>r.tangentWidth,x=wrap(r.azimuth)*radius,at=vertical?x:r.axial,mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2
    let pieces:[number,number][]=[[mid-half,mid+half]]
    for(const seam of seams.filter(s=>s.vertical===vertical&&Math.abs(s.at-at)<epsilon))pieces=pieces.flatMap(([a,b])=>{
      const low=Math.max(a,seam.low),high=Math.min(b,seam.high)
      if(high-low<=epsilon)return [[a,b]]
      retiredLength+=high-low;retiredPieces++
      return [[a,low],[high,b]].filter(([u,v])=>v-u>epsilon) as [number,number][]
    })
    if(pieces.length===1&&pieces[0][0]===mid-half&&pieces[0][1]===mid+half)return[r]
    const remaining=pieces.map(([a,b],i)=>({...r,id:`${r.id}:arrival-seams:${i}`,azimuth:vertical?r.azimuth:(a+b)/(2*radius),axial:vertical?(a+b)/2:r.axial,
      tangentWidth:vertical?r.tangentWidth:b-a,axialLength:vertical?b-a:r.axialLength}))
    surviving.set(r.id!,remaining);return remaining
  })
  if(!retiredPieces)return {retiredLength,retiredPieces,seams}
  // A short terminal may have been deferred while the next district was still
  // legacy land. Restore the source fragment once its other half is applied;
  // removing the perimeter must not truncate it at a migration-only boundary.
  const applied=districts.flatMap(d=>d.streets),restored=[] as string[]
  for(const d of districts.filter(d=>d.streets.some(isArrivalStreet))){
    const x=wrap(d.azimuth)*radius,bounds={x0:x-d.width/2,x1:x+d.width/2,y0:d.axial-d.length/2,y1:d.axial+d.length/2}
    for(const p of arrivalStreets(radius,d.id,bounds)){
      if(applied.some(s=>s.id===p.id))continue
      const band=p.id.match(/:band-\d+$/)![0]
      const joins=p.knots.some(k=>seams.some(s=>Math.abs(k.point[s.vertical?0:1]-s.at)<epsilon&&k.point[s.vertical?1:0]>=s.low-epsilon&&k.point[s.vertical?1:0]<=s.high+epsilon)
        &&applied.some(other=>other.id.endsWith(band)&&other.knots.some(v=>Math.hypot(v.point[0]-k.point[0],v.point[1]-k.point[1])<epsilon)))
      if(joins){d.streets.push(p);applied.push(p);restored.push(p.id)}
    }
  }
  const paths=[...legacyStreetPaths(roads),...districts.flatMap(d=>d.streets)],network=new StreetNetwork(paths,radius)
  if(new Set(network.components).size!==new Set(city.streetNetwork.components).size)throw Error('Retiring an arrival seam disconnects a street')
  const certified=certifyStreetAccess(city.buildings,network,radius,6)
  const walkDoors=city.entranceWalks??[]
  const blocked=certified.rejected.filter(r=>!walkDoors.some(w=>r.building.access?.entrance.azimuth===w.source.azimuth&&r.building.access?.entrance.axial===w.source.axial))
  // An unchanged outer lot may already be invalid in the staged migration.
  // Retain that evidence, but never exempt a newly obstructed or nearby lot.
  const unchangedRejections=blocked.filter(r=>{
    const b=r.building,x=wrap(b.azimuth)*radius,y=b.axial,extent=Math.max(b.width,b.depth)/2+30
    if(seams.some(s=>Math.abs((s.vertical?x:y)-s.at)<extent&&(s.vertical?y:x)>s.low-extent&&(s.vertical?y:x)<s.high+extent))return false
    const neighbors=city.buildings.filter(o=>Math.hypot(wrap(o.azimuth-b.azimuth)*radius,o.axial-b.axial)<150+Math.max(o.width,o.depth))
    return certifyStreetAccess(neighbors,city.streetNetwork!,radius,6).rejected.some(p=>p.building===b&&p.reason===r.reason)
  })
  if(unchangedRejections.length!==blocked.length)throw Error('Retiring an arrival seam obstructs an entrance')
  const byPosition=new Map(certified.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b.access]))
  city.buildings=city.buildings.map(b=>{
    let access=byPosition.get(`${b.azimuth}:${b.axial}`)??b.access
    const pieces=access&&surviving.get(access.roadId)
    if(pieces){
      const edge=access!.roadEdge,r=pieces.find(r=>Math.abs(wrap(edge.azimuth-r.azimuth)*radius)<=r.tangentWidth/2+epsilon&&Math.abs(edge.axial-r.axial)<=r.axialLength/2+epsilon)
      if(!r)throw Error('A retained entrance lost its surviving road segment')
      access={...access!,roadId:r.id!,roadIndex:network.streets.findIndex(p=>p.id===r.id)}
    }
    return {...b,access}
  })
  city.roads=roads;city.streetNetwork=network
  city.intersections=city.intersections.filter(p=>!seams.some(s=>{
    const x=wrap(p.azimuth)*radius,at=s.vertical?x:p.axial,along=s.vertical?p.axial:x
    return Math.abs(at-s.at)<epsilon&&along>=s.low-epsilon&&along<=s.high+epsilon
  }))
  // Regenerate the nearby joined surfaces: old boundary roads must no longer
  // punch holes in the pavements stored for walking guidance.
  const areas=districts.filter(d=>d.streets.some(isArrivalStreet))
  const nearby=paths.filter(p=>areas.some(d=>{
    const x=wrap(p.azimuth-d.azimuth)*radius,y=p.axial-d.axial,xs=p.knots.map(k=>x+k.point[0]),ys=p.knots.map(k=>y+k.point[1])
    return Math.max(...xs)>-d.width/2-30&&Math.min(...xs)<d.width/2+30&&Math.max(...ys)>-d.length/2-30&&Math.min(...ys)<d.length/2+30
  }))
  const surface=new StreetSurfacePlan(nearby,radius,isArrivalStreet),carriageways=surface.roadSurfaces(),sidewalks=surface.sidewalks()
  for(const d of areas)d.surfaces={carriageways:carriageways.filter(s=>d.streets.includes(s.source)),sidewalks:sidewalks.filter(s=>d.streets.includes(s.source))}
  return {retiredLength,retiredPieces,seams,restored,unchangedRejections:unchangedRejections.map(r=>({azimuth:r.building.azimuth,axial:r.building.axial,reason:r.reason}))}
}

/** Co-linear fragments of one band road share a single fleet coordinate.
 * Their visible paths/IDs stay distinct, so each keeps its signal approaches.
 * Non-touching fragments never gain an invisible traffic connection. */
export function joinedArrivalTraffic(city:CityPlan,radius:number):DistrictTrafficStreet[]{
  const sources=(city.nativeDistricts??[]).flatMap(d=>d.streets.filter(isArrivalStreet)).map(p=>arrivalTrafficStreet(p,radius))
  const groups:DistrictTrafficStreet[][]=[]
  for(const source of sources){
    const band=source.path.id.match(/:band-(\d+)$/)?.[1]
    const ends=source.path.knots.map(k=>k.point)
    const matches=groups.filter(g=>band!==undefined&&g[0].path.id.endsWith(`:band-${band}`)&&g.some(p=>p.path.knots.some(k=>ends.some(v=>Math.hypot(k.point[0]-v[0],k.point[1]-v[1])<epsilon))))
    if(!matches.length)groups.push([source])
    else{matches[0].push(source,...matches.slice(1).flat());for(const g of matches.slice(1))groups.splice(groups.indexOf(g),1)}
  }
  return groups.flatMap(group=>{
    const points=group.flatMap(s=>s.path.knots.map(k=>k.point)),ends=group[0].path.knots.map(k=>k.point),vertical=Math.abs(ends[1][1]-ends[0][1])>Math.abs(ends[1][0]-ends[0][0]),axis=vertical?1:0
    points.sort((a,b)=>a[axis]-b[axis]);const a=points[0],b=points.at(-1)!
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<=60)return[]
    const road={...group[0].road,azimuth:(a[0]+b[0])/(2*radius),axial:(a[1]+b[1])/2,
      tangentWidth:vertical?group[0].path.width:b[0]-a[0],axialLength:vertical?b[1]-a[1]:group[0].path.width}
    return group.map(source=>({...source,road}))
  })
}
