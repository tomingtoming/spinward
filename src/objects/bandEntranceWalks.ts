import {bandLivingPlaces} from './bandLivingPlaces'
import {bandReservePieces,planBandParcels} from './bandParcels'
import {certifyEntranceWalk} from './streetEntranceWalk'
import {positivePolygon,type StreetPolygon} from './streetPolygon'

/** Transport gates route cars; these certified strips stop on the near
 * sidewalk. Preserve the actual entrances and reserve their full width. */
export function planBandEntranceWalks(land:ReturnType<typeof planBandParcels>,radius=3200){
  const places=bandLivingPlaces()
  const polygon=(p:[number,number][]):StreetPolygon=>positivePolygon(p.map(([x,y])=>({x,y,u:0,v:0})))
  const footprints=land.parcels.map(p=>{const b=p.building,c=Math.cos(b.yaw),s=Math.sin(b.yaw)
    return polygon([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[b.x+c*x*b.width/2-s*y*b.depth/2,b.y+s*x*b.width/2+c*y*b.depth/2]))})
  return places.map(place=>{
    const [x,y]=place.entrance,[nx,ny]=place.normal
    const relevant=(p:StreetPolygon)=>Math.min(...p.map(v=>v.x))<x+40&&Math.max(...p.map(v=>v.x))>x-40&&Math.min(...p.map(v=>v.y))<y+40&&Math.max(...p.map(v=>v.y))>y-40
    const result=certifyEntranceWalk({id:place.id,entrance:{x,y},normal:{x:nx,y:ny},width:2,startHeight:.12,maxGap:40,
      sidewalks:land.geometry.sidewalks.filter(s=>relevant(s.polygon)).map(s=>({polygon:s.polygon,height:s.lift})),
      carriageways:land.geometry.carriageways.map(s=>s.polygon).filter(relevant),allowed:bandReservePieces(place.reserve),
      obstacles:[...footprints.filter(relevant),...places.filter(p=>p.id!==place.id).map(p=>polygon(p.footprint)),
        ...land.site.reserves.filter(r=>r.id!==place.reserve.id).flatMap(bandReservePieces).filter(relevant)]},radius)
    return{place,...result}
  })
}
