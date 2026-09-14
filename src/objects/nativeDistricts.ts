import type { CityBuilding, CityPlan, CityRoad } from './cityLayout'
import { legacyStreetPaths, sampleStreetPath, streetPathSamples, type StreetPath } from './streetPath'
import { StreetNetwork } from './streetNetwork'
import { buildingFootprint, certifyStreetAccess } from './streetFrontage'
import { getStreetProfile } from './streetProfile'
import { intersectStreetPolygons, polygonArea } from './streetPolygon'
import { SurfaceIndex } from './surfaceIndex'
import { districtBlockLinks } from './districtLinks'
import { appendPlaceDistrict } from './placeDistrict'
import type { StreetPolygon } from './streetPolygon'
import type { StreetSurface } from './streetSurfacePlan'
import type { PlaceStreetGrowth } from './placeStreetGrowth'
import { planStreetParcels } from './streetParcels'
import { appendSettlementCorridor, settlementCharacter, type SettlementCentre } from './settlementCorridor'

export type NativeDistrict = {
  id: string; azimuth: number; axial: number; width: number; length: number
  band: number; character: 'mixed' | 'residential' | 'centre'
  layout?: 'place-led' | 'anchor-led' | 'band-plan'; reserves?: StreetPolygon[]; centres?: SettlementCentre[]
  growth?: Pick<PlaceStreetGrowth,'connections'|'links'|'deferredLinks'>
  land?: ReturnType<typeof planStreetParcels>
  surfaces?: {carriageways:StreetSurface[];sidewalks:StreetSurface[]}
  streets: StreetPath[]; buildings: CityBuilding[]; replacedBuildings: number; replacedRoads: number
}
/** The axis descriptor survives only as a traffic station coordinate. All
 * visible pavement, access and guidance uses the connected native paths. */
export type DistrictTrafficStreet = { road: CityRoad; path: StreetPath; sourceRoadIds: string[] }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Rebuild connected districts along each large land band's through corridor.
 * The perimeter stays fixed; through arterials retain their destinations.
 * Selection depends on roads, never quality-dependent lot thinning. */
export function rebuildNativeDistricts(city: CityPlan, radius: number) {
  const districts: NativeDistrict[] = [], traffic: DistrictTrafficStreet[] = []
  if (radius < 2500 || radius > 4000) return { districts, traffic }
  const avenues = city.roads.filter(r => r.kind === 'arterial' && r.axialLength > 30000)
  if (avenues.length !== 3) return { districts, traffic }
  const originalRoads = city.roads, originalBuildings = city.buildings
  let roads = [...originalRoads], buildings = [...originalBuildings]
  for (const [band, main] of avenues.entries()) {
    const azimuth = main.azimuth
    const local = originalRoads.filter(r => r.axialLength > 30000 && Math.abs(wrap(r.azimuth - azimuth)) * radius < 600)
      .sort((a,b) => wrap(a.azimuth - azimuth) - wrap(b.azimuth - azimuth))
    const centre = local.indexOf(main), west = local[centre - 2], east = local[centre + 2]
    const corridor = originalRoads.filter(r => r.tangentWidth > 2500 && Math.abs(wrap(r.azimuth - azimuth)) < .01 && r.axial > 5000 && r.axial < 11500)
      .sort((a,b) => a.axial - b.axial)
    if (!west || !east || corridor.length < 7) continue
    for (const [region,first,cells,character] of [[0,0,6,'mixed'],[1,6,4,'residential'],[2,10,8,'centre']] as const) {
      if(corridor.length<first+cells+1)continue
      const cross=corridor.slice(first,first+cells+1)
      const left = wrap(west.azimuth - azimuth) * radius, right = wrap(east.azimuth - azimuth) * radius
      const bottom = cross[0].axial, top = cross[cells].axial, axial = (bottom + top) / 2
      const d: NativeDistrict = { id: `district-${band}${region?`-region-${region}`:''}`, band, character, azimuth, axial, width: right-left, length: top-bottom,
        streets: [], buildings: [], replacedBuildings: 0, replacedRoads: 0 }
      const inside = (p: {azimuth:number;axial:number}, margin = 0) => {
        const x = wrap(p.azimuth - azimuth) * radius
        return x > left + margin && x < right - margin && p.axial > bottom + margin && p.axial < top - margin
      }
      const removed = buildings.filter(b => inside(b))
      d.replacedBuildings = removed.length
      buildings = buildings.filter(b => !inside(b))
      // Clip physical legacy ribbons at the same perimeter centre lines.
      const kept: CityRoad[] = []
      for (const r of roads) {
        const vertical = r.axialLength > r.tangentWidth, x = wrap(r.azimuth - azimuth) * radius
        const at = vertical ? x : r.axial, lo = vertical ? left : bottom, hi = vertical ? right : top
        if (at <= lo + .01 || at >= hi - .01) { kept.push(r); continue }
        const mid = vertical ? r.axial : x, half = (vertical ? r.axialLength : r.tangentWidth) / 2
        const cut0 = vertical ? bottom : left, cut1 = vertical ? top : right
        if (mid + half <= cut0 || mid - half >= cut1) { kept.push(r); continue }
        d.replacedRoads++
        for (const [i,a,b] of [[0,mid-half,Math.min(mid+half,cut0)], [1,Math.max(mid-half,cut1),mid+half]]) {
          if (b-a <= .01) continue
          kept.push({ ...r, id: i===0 ? r.id : `${r.id}:${d.id}:${i}`, azimuth: vertical ? r.azimuth : azimuth+(a+b)/(2*radius),
            axial: vertical ? (a+b)/2 : r.axial, tangentWidth: vertical ? r.tangentWidth : b-a, axialLength: vertical ? b-a : r.axialLength })
        }
      }
      roads = kept
      // Smooth returns at the district edge; different bows in adjacent bands
      // break the repeating overhead grid without kinks at the old road ends.
      const selected = [...local.slice(centre-1,centre+2), ...cross.slice(1,cells)]
      for (const [i,r] of selected.entries()) {
        const vertical = i < 3, x = wrap(r.azimuth - azimuth) * radius, y = r.axial - axial
        const length = vertical ? d.length : d.width
        const bend = (i === 1 ? 82 : i < 3 ? 56 : 68) * (band === 1 ? -1 : 1) * (i % 2 ? 1 : -1) * (region===1?-.8:1)
        const points: [number,number][] = [0,.25,.5,.75,1].map((t,j) => {
          const profile = [[0,-.1,.8,.9,0],[0,-.6,.8,.35,0],[0,.7,.4,-.3,0],
            [0,-.8,-.55,.15,0],[0,-.3,.65,.8,0],[0,.1,-.2,-.8,0]][(i+region*2)%6]
          const offset = profile[j] * bend
          return vertical ? [x+offset,-d.length/2+t*length] : [left+t*length,y+offset]
        })
        const knots = points.map((point,j) => {
          const delta = j === 0 || j === 4 ? 0 : ((vertical ? points[j+1][0]-points[j-1][0] : points[j+1][1]-points[j-1][1]) / 2)
          return {point, tangent: (vertical ? [delta,length/4] : [length/4,delta]) as [number,number]}
        })
        const path: StreetPath = { id:`${d.id}:${r.id}`, azimuth, axial, width:vertical?r.tangentWidth:r.axialLength,
          kind:r.kind, level:0, groundHeight:0, walkHeight:.32, knots }
        d.streets.push(path)
        traffic.push({ road:r, path, sourceRoadIds:[path.id,...roads.filter(p=>p.id===r.id||p.id?.startsWith(`${r.id}:${d.id}:`)).map(p=>p.id!)] })
      }
      d.streets.push(...districtBlockLinks(d.streets,band,d.id,region?cells:undefined))
      // Retain landscaping outside the rebuilt blocks. Bare planted courts use
      // the habitat surface, so no rectangular field texture cuts through a bend.
      city.patches = city.patches.filter(p => !inside(p))
      city.trees = city.trees.filter(p => !inside(p))
      city.intersections = city.intersections.filter(p => !inside(p, -.01))
      districts.push(d)
    }
  }
  const place=appendPlaceDistrict(city,roads,buildings,radius)
  if(place){districts.push(place.district);traffic.push(place.traffic);roads=place.roads;buildings=place.buildings}
  const settlement=appendSettlementCorridor(city,roads,buildings,radius)
  if(settlement){districts.push(settlement.district);traffic.push(settlement.traffic);roads=settlement.roads;buildings=settlement.buildings}
  if (!districts.length) return {districts,traffic}
  const network = new StreetNetwork([...legacyStreetPaths(roads),...districts.flatMap(d=>d.streets)],radius)
  // Plan rows in metres along the centreline, with independently varied lot
  // widths, depths, massing and tones. Reject road intersections and overlapping
  // reserved footprints before accepting any doorway.
  const candidates: CityBuilding[] = [], placed: CityBuilding[] = [...buildings], index = new SurfaceIndex(radius)
  const bounds = (b:CityBuilding) => ({...b,tangentWidth:Math.abs(Math.cos(b.yaw??0))*b.width+Math.abs(Math.sin(b.yaw??0))*b.depth,
    axialLength:Math.abs(Math.sin(b.yaw??0))*b.width+Math.abs(Math.cos(b.yaw??0))*b.depth})
  placed.forEach((b,i)=>index.insert(bounds(b),i))
  for (const d of districts) {
    let seed=9187+d.band*173+(d.character==='residential'?1031:d.character==='centre'?2062:0)
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
    if(d.layout){
      d.land=planStreetParcels({id:d.id,azimuth:d.azimuth,axial:d.axial,
        bounds:{x0:-d.width/2+14,x1:d.width/2-14,y0:-d.length/2+14,y1:d.length/2-14},
        streets:d.streets,reserves:d.reserves??[],seed},radius)
      for(const parcel of d.land.parcels){
        const p=parcel.building,character=d.centres?settlementCharacter({centres:d.centres},p.x,p.y):d.character
        const heightRoll=random(),height=character==='residential'?6+Math.floor(heightRoll*7)*3:character==='centre'?16+Math.floor(heightRoll*17)*3:10+Math.floor(heightRoll*12)*3
        const b:CityBuilding={azimuth:d.azimuth+p.x/radius,axial:d.axial+p.y,
          width:p.width,depth:p.depth,yaw:p.yaw,height,
          front:{axis:'axial',side:parcel.front.side===1?-1:1},kind:random()<.35?'setback':'block',
          urban:character==='residential'?.42:character==='centre'?.84:.72,oldTown:0,tone:random(),nativeDistrict:d.id,nativeParcel:parcel.id}
        const box=bounds(b),footprint=buildingFootprint(b)
        if([...index.query(box)].some(j=>{
          const other=placed[j],dx=wrap(other.azimuth-b.azimuth)*radius,dy=other.axial-b.axial
          return polygonArea(intersectStreetPolygons(footprint,buildingFootprint(other).map(v=>({...v,x:v.x+dx,y:v.y+dy}))))>1e-6
        }))continue
        index.insert(box,placed.length);placed.push(b);candidates.push(b)
      }
      continue
    }
    for (const path of d.streets) for (const side of [-1,1] as const) {
      const samples=streetPathSamples(path), distances=[0]
      for(let i=1;i<samples.length;i++)distances.push(distances[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y))
      const length=distances.at(-1)!
      for(let s=28;s<length-28;) {
        const width=15+random()*13,depth=12+random()*14,gap=4+random()*5
        s+=width/2
        let i=1;while(i<distances.length-1&&distances[i]<s)i++
        const t=samples[i-1].t+(samples[i].t-samples[i-1].t)*(s-distances[i-1])/(distances[i]-distances[i-1])
        const p=sampleStreetPath(path,t,side*(path.width/2+getStreetProfile(path.kind,radius).sidewalk+1+depth/2))
        const heightRoll=random(),height=d.character==='residential'?6+Math.floor(heightRoll*7)*3:d.character==='centre'?16+Math.floor(heightRoll*17)*3:10+Math.floor(heightRoll*12)*3
        const b:CityBuilding={azimuth:d.azimuth+p.x/radius,axial:d.axial+p.y,width,depth,height,
          yaw:p.heading,front:{axis:'axial',side:side===1?-1:1},kind:random()<.35?'setback':'block',urban:d.character==='residential'?.42:d.character==='centre'?.84:.72,oldTown:0,tone:random(),nativeDistrict:d.id}
        s+=width/2+gap
        const box=bounds(b)
        if(Math.abs(p.x)+box.tangentWidth/2>d.width/2-14||Math.abs(p.y)+box.axialLength/2>d.length/2-14)continue
        const footprint=buildingFootprint(b)
        if(d.reserves?.some(reserve=>polygonArea(intersectStreetPolygons(footprint,reserve.map(v=>({...v,x:v.x-p.x,y:v.y-p.y}))))>1e-6))continue
        const conflict=[...index.query(box)].some(j=>{
          const other=placed[j],dx=wrap(other.azimuth-b.azimuth)*radius,dy=other.axial-b.axial
          return polygonArea(intersectStreetPolygons(footprint,buildingFootprint(other).map(v=>({...v,x:v.x+dx,y:v.y+dy}))))>1e-6
        })
        if(conflict)continue
        index.insert(box,placed.length);placed.push(b);candidates.push(b)
      }
    }
  }
  const access=certifyStreetAccess([...buildings,...candidates],network,radius,6)
  const candidateSet=new Set(candidates.map(b=>`${b.azimuth}:${b.axial}`))
  const accepted=access.buildings.filter(b=>candidateSet.has(`${b.azimuth}:${b.axial}`))
  for(const d of districts) {
    const row=accepted.filter(b=>b.nativeDistrict===d.id)
    d.buildings=row.filter((_,i)=>Math.floor(i*d.replacedBuildings/row.length)!==Math.floor((i-1)*d.replacedBuildings/row.length)||row.length<=d.replacedBuildings)
  }
  // Existing access is already certified. Rebind split road identities from
  // the fresh certification while retaining buildings outside this increment.
  const accessByPosition=new Map(access.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b.access]))
  buildings=buildings.map(b=>({...b,access:accessByPosition.get(`${b.azimuth}:${b.axial}`)??b.access}))
  city.roads=roads;city.buildings=[...buildings,...districts.flatMap(d=>d.buildings)];city.streetNetwork=network
  city.nativeDistricts=districts
  // Resolve identities after every clip, including pieces beyond later regions.
  for(const t of traffic)t.sourceRoadIds=[t.path.id,...roads.filter(r=>r.id===t.road.id||r.id?.startsWith(`${t.road.id}:district-`)).map(r=>r.id!)]
  return {districts,traffic}
}
