import type { CityBuilding, CityPlan, CityRoad } from './cityLayout'
import type { NativeDistrict, DistrictTrafficStreet } from './nativeDistricts'
import { growPlaceStreets, type StreetDestination } from './placeStreetGrowth'
import type { StreetPath } from './streetPath'

type Point = [number, number]
export type SettlementCentre = {
  id: string; point: Point; reach: number; character: 'centre' | 'residential'
}
export type SettlementSite = {
  id: string; azimuth: number; axial: number; width: number; length: number
  centres: SettlementCentre[]
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Land coordinates are planning inputs. They do not depend on old street
 * spacing, intersections, building budgets or which lots happened to survive. */
export function settlementSite(): SettlementSite {
  return { id: 'district-settlement', azimuth: 0, axial: -7500, width: 1100, length: 2600,
    centres: [
      { id: 'market', point: [-210, -590], reach: 430, character: 'centre' },
      { id: 'housing', point: [235, 570], reach: 470, character: 'residential' }
    ] }
}

/** One through corridor visits the district centres in land order. The old
 * network supplies only the two boundary ports. Its row/column topology never
 * enters the core, and the local accesses are grown before boundary adapters. */
export function planSettlementCore(site: SettlementSite, throughX: number, width: number, approaches: StreetDestination[] = []) {
  const centres = [...site.centres].sort((a,b) => a.point[1] - b.point[1])
  const points: Point[] = [[throughX, -site.length/2], ...centres.map(c => c.point), [throughX, site.length/2]]
  if (centres.length < 2 || points.some((p,i) => Math.abs(p[0]) > site.width/2-60 ||
    i > 0 && p[1]-points[i-1][1] < 200)) throw Error('Settlement centres need clear land and separated through stations')
  const trunk: StreetPath = { id: `${site.id}:spine`, azimuth: site.azimuth, axial: site.axial,
    width, kind: 'arterial', level: 0, groundHeight: 0, walkHeight: .32,
    knots: points.map((point,i) => {
      const a = points[Math.max(0,i-1)], b = points[Math.min(points.length-1,i+1)]
      return { point, tangent: (i === 0 || i === points.length-1 ? [0,b[1]-a[1]] : [(b[0]-a[0])/2,(b[1]-a[1])/2]) as Point }
    }) }
  const destinations: StreetDestination[] = centres.flatMap(c => {
    const offsets: Point[] = c.character === 'centre' ? [[.72,-.65],[-.62,.25],[.5,.76]] : [[-.83,-.22],[.38,.52],[-.52,.8]]
    return offsets.map(([x,y],i) => ({ id: `${c.id}-${i}`, point: [c.point[0]+x*c.reach,c.point[1]+y*c.reach] as Point,
      kind: c.character === 'centre' && i === 0 ? 'collector' : 'local', width: c.character === 'centre' && i === 0 ? 12 : 6 }))
  })
  return growPlaceStreets({ ...site, bounds: { x0:-site.width/2,x1:site.width/2,y0:-site.length/2,y1:site.length/2 },
    reserves: [], trunks: [trunk], destinations, approaches,
    links: centres.filter(c=>c.character==='centre').map(c=>({id:`${c.id}-connection`,from:`${c.id}-0`,to:`${c.id}-2`,maxDetour:1.5})) })
}

export function settlementCharacter(site: Pick<SettlementSite,'centres'>, x: number, y: number) {
  return site.centres.reduce((best,c) => Math.hypot(x-c.point[0],y-c.point[1])/c.reach <
    Math.hypot(x-best.point[0],y-best.point[1])/best.reach ? c : best).character
}

/** Migrate one continuous site containing both centres. Clipping is solely an
 * interface to surviving legacy streets; it cannot move the site or its core. */
export function appendSettlementCorridor(city: CityPlan, roads: CityRoad[], buildings: CityBuilding[], radius: number) {
  const site = settlementSite(), main = city.roads.find(r => r.kind === 'arterial' && r.axialLength > 30000 && Math.abs(wrap(r.azimuth-site.azimuth))*radius < .01)
  if (!main) return null
  const x0=-site.width/2,x1=site.width/2,y0=site.axial-site.length/2,y1=site.axial+site.length/2
  const inside=(p:{azimuth:number;axial:number})=>{const x=wrap(p.azimuth-site.azimuth)*radius;return x>x0&&x<x1&&p.axial>y0&&p.axial<y1}
  // A perimeter can cut an old lot rather than a road row. Rebuild the whole
  // affected lot, including an outside centre whose door loses its old road.
  const affected=(b:CityBuilding)=>{
    const x=wrap(b.azimuth-site.azimuth)*radius,c=Math.abs(Math.cos(b.yaw??0)),s=Math.abs(Math.sin(b.yaw??0))
    const hw=(c*b.width+s*b.depth)/2,hh=(s*b.width+c*b.depth)/2
    return x+hw>x0&&x-hw<x1&&b.axial+hh>y0&&b.axial-hh<y1||!!b.access&&inside(b.access.roadEdge)
  }
  const kept: CityRoad[] = [], approaches: StreetDestination[] = []
  let replacedRoads=0
  for (const r of roads) {
    const vertical=r.axialLength>r.tangentWidth,x=wrap(r.azimuth-site.azimuth)*radius
    const at=vertical?x:r.axial,lo=vertical?x0:y0,hi=vertical?x1:y1
    if(at<=lo+.01||at>=hi-.01){kept.push(r);continue}
    const mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2,a=vertical?y0:x0,b=vertical?y1:x1
    if(mid+half<=a||mid-half>=b){kept.push(r);continue}
    replacedRoads++
    for(const [side,start,end] of [[-1,mid-half,Math.min(mid+half,a)],[1,Math.max(mid-half,b),mid+half]]){
      if(end-start<.01)continue
      kept.push({...r,id:`${r.id}:${site.id}:${side}`,azimuth:vertical?r.azimuth:site.azimuth+(start+end)/(2*radius),
        axial:vertical?(start+end)/2:r.axial,tangentWidth:vertical?r.tangentWidth:end-start,axialLength:vertical?end-start:r.axialLength})
      // Keep outside block-access lanes as cul-de-sacs. Only through streets
      // need migration links; copying every old alley port would propagate
      // the old block subdivision into the new settlement again.
      if(r.id!==main.id&&Math.max(r.tangentWidth,r.axialLength)>1000)approaches.push({id:`approach-${approaches.length}`,point:vertical?[x,(side<0?y0:y1)-site.axial]:[side<0?x0:x1,r.axial-site.axial],
        direction:vertical?[0,-side]:[-side,0],kind:r.kind,width:Math.min(r.tangentWidth,r.axialLength)})
    }
  }
  const growth=planSettlementCore(site,wrap(main.azimuth-site.azimuth)*radius,main.tangentWidth,approaches)
  if(growth.unconnected.length)throw Error(`Unconnected settlement access: ${growth.unconnected.join(', ')}`)
  const district:NativeDistrict={...site,band:0,character:'mixed',layout:'anchor-led',
    streets:growth.streets,buildings:[],replacedBuildings:buildings.filter(affected).length,replacedRoads,
    growth:{connections:growth.connections,links:growth.links,deferredLinks:growth.deferredLinks}}
  city.patches=city.patches.filter(p=>!inside(p));city.trees=city.trees.filter(p=>!inside(p));city.intersections=city.intersections.filter(p=>!inside(p))
  const traffic:DistrictTrafficStreet={road:main,path:growth.streets[0],sourceRoadIds:[]}
  return{district,roads:kept,buildings:buildings.filter(b=>!affected(b)),traffic}
}
