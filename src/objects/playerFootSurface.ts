import type { CityPlan } from './cityLayout'
import type { SidewalkSegment } from './sidewalks'
import { SurfaceIndex } from './streetAccess'
import { SIDEWALK_LIFT } from './streetProfile'
import { ROAD_SURFACE_LIFT_METERS, ROAD_SURFACE_MAX_SAGITTA_METERS } from './roadSurfaceGeometry'

type Surface = { azimuth: number; axial: number; tangentWidth: number; axialLength: number; height: number }

/** Visible finish levels for foot placement, separate from the existing
 * physical ground/roof controller. Query only nearby indexed surface bands. */
export class PlayerFootSurface {
  private surfaces: Surface[] = []
  private index = new SurfaceIndex(3200)
  private radius = 3200
  setPlan(plan: CityPlan | null, sidewalks: SidewalkSegment[], radius: number) {
    this.radius = radius
    this.index = new SurfaceIndex(radius)
    this.surfaces = [
      ...(plan?.roads ?? []).map(r => ({ ...r, height: ROAD_SURFACE_LIFT_METERS + ROAD_SURFACE_MAX_SAGITTA_METERS })),
      ...sidewalks.map(s => ({ ...s, tangentWidth: s.tangentExtent, axialLength: s.axialExtent,
        height: SIDEWALK_LIFT + (s.isAvenue ? 0 : .01) + .02 }))
    ]
    this.surfaces.forEach((s, i) => this.index.insert(s, i))
  }
  sample(azimuth: number, axial: number, groundHeight: number, indoors: boolean) {
    if (groundHeight > .5) return groundHeight + .015
    if (indoors) return .25
    let height = .1
    for (const i of this.index.query({ azimuth, axial, tangentWidth: .01, axialLength: .01 })) {
      const s = this.surfaces[i]
      if (Math.abs(Math.atan2(Math.sin(azimuth - s.azimuth), Math.cos(azimuth - s.azimuth))) * this.radius <= s.tangentWidth / 2 &&
        Math.abs(axial - s.axial) <= s.axialLength / 2) height = Math.max(height, s.height)
    }
    return height
  }
}
