import type { CityPlan } from './cityLayout'
import type { SidewalkSegment } from './sidewalks'
import { SurfaceIndex } from './streetAccess'
import { SIDEWALK_LIFT } from './streetProfile'
import { ROAD_SURFACE_LIFT_METERS, ROAD_SURFACE_MAX_SAGITTA_METERS } from './roadSurfaceGeometry'
import { PARK_PATH_HEIGHT, type PublicPark } from './publicPark'
import { streetPathSurfaces,streetSurfaceEnvelope } from './streetSurfacePlan'
import { containsStreetPolygon } from './streetPolygon'
import type { StreetNetwork } from './streetNetwork'
import { streetRibbon } from './streetPath'

type Surface = { azimuth: number; axial: number; tangentWidth: number; axialLength: number; height: number; polygon?:{x:number;y:number}[] }

/** Visible finish levels for foot placement, separate from the existing
 * physical ground/roof controller. Query only nearby indexed surface bands. */
export class PlayerFootSurface {
  private surfaces: Surface[] = []
  private index = new SurfaceIndex(3200)
  private radius = 3200
  private network:StreetNetwork|undefined
  private nativeRoads=new Set<string>()
  setPlan(plan: CityPlan | null, sidewalks: SidewalkSegment[], radius: number, park: PublicPark | null = null) {
    this.radius = radius
    this.network=plan?.streetNetwork
    this.nativeRoads=new Set(plan?.nativeDistricts?.flatMap(d=>d.streets.map(p=>p.id))??[])
    this.index = new SurfaceIndex(radius)
    this.surfaces = [
      ...(plan?.nativeDistricts??[]).flatMap(d=>d.streets.flatMap(p=>[...streetPathSurfaces(p,radius),...streetPathSurfaces(p,radius,true)]).map(s=>{
        const e=streetSurfaceEnvelope(s,radius),x=Math.atan2(Math.sin(s.source.azimuth-e.azimuth),Math.cos(s.source.azimuth-e.azimuth))*radius
        return{...e,height:s.lift+.02,polygon:s.polygon.map(p=>({x:p.x+x,y:p.y+s.source.axial-e.axial}))}
      })),
      ...(plan?.roads ?? []).map(r => ({ ...r, height: ROAD_SURFACE_LIFT_METERS + ROAD_SURFACE_MAX_SAGITTA_METERS })),
      ...sidewalks.map(s => ({ ...s, tangentWidth: s.tangentExtent, axialLength: s.axialExtent,
        height: SIDEWALK_LIFT + (s.isAvenue ? 0 : .01) + .02 })),
      ...(park?.paths ?? []).map(p => ({ azimuth: park!.azimuth + p.x / radius, axial: park!.axial + p.y,
        tangentWidth: p.width, axialLength: p.depth, height: PARK_PATH_HEIGHT }))
    ]
    this.surfaces.forEach((s, i) => this.index.insert(s, i))
  }
  sample(azimuth: number, axial: number, groundHeight: number, indoors: boolean) {
    if (groundHeight > .5) return groundHeight + .015
    if (indoors) return .25
    if(this.nativeRoads.size&&this.network)for(const s of this.network.query(azimuth,axial,.01,.01)){
      const path=this.network.streets[s.street]
      if(!this.nativeRoads.has(path.id))continue
      const x=Math.atan2(Math.sin(azimuth-path.azimuth),Math.cos(azimuth-path.azimuth))*this.radius
      if(containsStreetPolygon(streetRibbon(path,s.start.t,s.end.t,-path.width/2,path.width/2),x,axial-path.axial))return Math.max(groundHeight,.22)
    }
    // Low physical paving/steps also support feet. Previously any unlisted
    // surface below .5m fell back to grass and buried the shoes in its top.
    let height = Math.max(.1, groundHeight)
    for (const i of this.index.query({ azimuth, axial, tangentWidth: .01, axialLength: .01 })) {
      const s = this.surfaces[i]
      if(s.polygon){
        const x=Math.atan2(Math.sin(azimuth-s.azimuth),Math.cos(azimuth-s.azimuth))*this.radius
        if(containsStreetPolygon(s.polygon,x,axial-s.axial))height=Math.max(height,s.height)
        continue
      }
      if (Math.abs(Math.atan2(Math.sin(azimuth - s.azimuth), Math.cos(azimuth - s.azimuth))) * this.radius <= s.tangentWidth / 2 &&
        Math.abs(axial - s.axial) <= s.axialLength / 2) height = Math.max(height, s.height)
    }
    return height
  }
}
