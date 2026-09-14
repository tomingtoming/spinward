import { ShapeUtils, Vector2 } from 'three'
import { planStreetParcels } from './streetParcels'
import { positivePolygon, polygonArea } from './streetPolygon'
import type { BandReserve, BandStreetPlan } from './bandStreetPlan'
import { prepareBandStreetGeometry } from './bandStreetGeometry'
import {bandShopFootprint} from './bandShopFrontage'

/** The parcel clipper accepts convex pieces. Whole-band river and transport
 * reserves may be concave: triangulate them, without bridging their concavities
 * or treating the triangles' internal edges as new street/block boundaries. */
export function bandReservePieces(reserve:BandReserve) {
  const contour=reserve.polygon.map(([x,y])=>new Vector2(x,y))
  const pieces=ShapeUtils.triangulateShape(contour,[]).map(ids=>positivePolygon(ids.map(i=>({x:contour[i].x,y:contour[i].y,u:0,v:0}))))
  const expected=Math.abs(ShapeUtils.area(contour)),actual=pieces.reduce((n,p)=>n+polygonArea(p),0)
  if(Math.abs(expected-actual)>Math.max(1e-5,expected*1e-10))throw Error(`Cannot triangulate band reservation ${reserve.id}`)
  return pieces
}

/** One subdivision over the complete unrolled band, after reserving transport
 * land. No district rectangles or old grid edges constrain its land blocks.
 * Only road-facing cells with a fitting footprint become building candidates;
 * the rest remains explicitly unallocated. This is an offline planning stage,
 * not a request to spawn every candidate as a runtime building. */
export function planBandParcels(plan:BandStreetPlan,radius=3200,geometry=prepareBandStreetGeometry(plan,radius)) {
  const site=plan.site,reserves=site.reserves.flatMap(bandReservePieces)
  if(site.id==='band-0-proposal')reserves.push(positivePolygon(bandShopFootprint(3).map(([x,y])=>({x,y,u:0,v:0}))))
  // Include the actual bevelled junctions as well as expanded path ribbons.
  // A safe centreline offset alone does not certify a corner footprint.
  const pavement=[...geometry.carriageways,...geometry.sidewalks].map(s=>s.polygon)
  const land=planStreetParcels({id:site.id,azimuth:0,axial:0,
    bounds:{x0:-site.width/2,x1:site.width/2,y0:-site.length/2,y1:site.length/2},
    streets:geometry.paths,reserves:[...reserves,...pavement],seed:site.seed,maximumFrontage:40},radius)
  return {...land,site,geometry,reserves,totalArea:site.width*site.length,
    landArea:land.blocks.reduce((n,b)=>n+b.area,0),parcelArea:land.parcels.reduce((n,p)=>n+p.area,0)}
}
