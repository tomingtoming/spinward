import shops from '../../assets/blender/neighborhood-fronts.json'
import {clearBandSegment,type BandPoint,type BandRoad,type BandSite} from './bandStreetPlan'
import {getStreetProfile} from './streetProfile'

export function bandShopFootprint(margin=0):BandPoint[]{
  const b=shops.building,x=b.azimuth*shops.radius,y=b.axial,w=b.width/2+margin,d=b.depth/2+margin
  return [[x-w,y-d],[x+w,y-d],[x+w,y+d],[x-w,y+d]]
}

/** The occupied shop was absent from the original transport reservations.
 * Keep the existing road endpoints and divert only an obstructed segment
 * around its finite-width envelope. This correction belongs to the shared
 * band geometry, before either offline parcels or runtime snapshots use it. */
export function avoidBandShop(roads:BandRoad[],site:BandSite,radius:number){
  if(site.id!=='band-0-proposal')return roads
  return roads.flatMap(r=>{
    const profile=getStreetProfile(r.kind,radius),polygon=bandShopFootprint(profile.carriageway/2+profile.sidewalk+1)
    const obstacle={id:'occupied-shops',kind:'facility' as const,polygon}
    if(clearBandSegment(r.from,r.to,[obstacle]))return[r]
    if(r.bridge||r.underpass||r.frontage)throw Error('A fixed band road obstructs the occupied shops')
    const reserves=[...site.reserves,obstacle]
    const candidates=polygon.filter(p=>clearBandSegment(r.from,p,reserves)&&clearBandSegment(p,r.to,reserves))
      .map(point=>({point,length:Math.hypot(point[0]-r.from[0],point[1]-r.from[1])+Math.hypot(point[0]-r.to[0],point[1]-r.to[1])}))
      .sort((a,b)=>a.length-b.length)
    if(!candidates.length)throw Error('The occupied shop needs a wider road redesign')
    const point=candidates[0].point
    return [{...r,to:point},{...r,from:point}]
  })
}
