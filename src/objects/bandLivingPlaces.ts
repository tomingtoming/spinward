import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'
import type { BandAccess, BandPoint, BandReserve } from './bandStreetPlan'

const rectangle=(x0:number,y0:number,x1:number,y1:number):BandPoint[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]

/** Retain the authored interiors' actual contracts, rather than reproducing
 * their coordinates in the new city generator. The 20 m planning envelope
 * keeps even an arterial's pavement/sidewalk away from the existing parcel.
 * Gates are road graph anchors; pedestrian crossings/entrance paths still
 * need certification before the inhabited world can switch networks. */
export function bandLivingPlaces() {
  return ([['cafe',cafe],['lobby',lobby],['apartment',apartment]] as const).map(([id,data])=>{
    const b=data.interior.building,radius=data.habitat.radius,x=b.azimuth*radius,y=b.axial,p=b.parcel
    const footprint=rectangle(x-b.width/2,y-b.depth/2,x+b.width/2,y+b.depth/2)
    const parcel=rectangle(x+p.tangentOffset-p.tangentExtent/2,y+p.axialOffset-p.axialExtent/2,
      x+p.tangentOffset+p.tangentExtent/2,y+p.axialOffset+p.axialExtent/2)
    const entrance:BandPoint=[b.access.entrance.azimuth*radius,b.access.entrance.axial]
    const points=[...footprint,...parcel,entrance],margin=20
    const x0=Math.min(...points.map(p=>p[0]))-margin,x1=Math.max(...points.map(p=>p[0]))+margin
    const y0=Math.min(...points.map(p=>p[1]))-margin,y1=Math.max(...points.map(p=>p[1]))+margin
    const point:BandPoint=b.front.axis==='axial'?[entrance[0],b.front.side<0?y0:y1]:[b.front.side<0?x0:x1,entrance[1]]
    const normal:BandPoint=b.front.axis==='axial'?[0,b.front.side]:[b.front.side,0]
    // Keep the arterial/collector width transition away from the cafe door.
    // The entrance stays fixed; only its proposed road junction moves along
    // the front boundary of the protected forecourt.
    if(id==='cafe')point[0]-=8
    const reserve:BandReserve={id:`living-${id}`,kind:'facility',polygon:rectangle(x0,y0,x1,y1)}
    const access:BandAccess={id:`living-${id}-gate`,point,serves:['arrival']}
    return {id,footprint,parcel,entrance,normal,reserve,access}
  })
}
