import type { BuildingInterior } from './buildingInteriors'
import { interiorPartBuilding } from './buildingInteriors'

export const MAX_RAIN_ROOFS = 16
export type RainRoof = {
  cos: number; sin: number; axial: number; radial: number
  halfWidth: number; halfDepth: number
}
type Point = { x: number; y: number; z: number }

/** Use the actual upper-floor/ceiling footprints, preserving the open light
 * well in a courtyard. Their shadow reaches down to the continuous floor. */
export function planRainRoofs(interiors: readonly BuildingInterior[], radius: number): RainRoof[] {
  return interiors.flatMap(interior => interior.parts.filter(part =>
    part.material === 'upper' || part.y > 2.5 && part.height < .3 && part.width > 3 && part.depth > .5
  ).map(part => {
    const b = interiorPartBuilding(interior, part, radius)
    return { cos: Math.cos(b.azimuth), sin: Math.sin(b.azimuth), axial: b.axial,
      radial: radius - (b.baseHeight ?? 0) - b.height,
      halfWidth: b.width / 2 + .015, halfDepth: b.depth / 2 + .015 }
  }))
}

/** Same surface-space test as the rain vertex shader. This is a bounded roof
 * occlusion approximation, not per-drop wind/solid collision simulation. */
export function rainRoofCoversPoint(roof: RainRoof, point: Point) {
  return point.x * roof.cos + point.z * roof.sin >= roof.radial &&
    Math.abs(-point.x * roof.sin + point.z * roof.cos) <= roof.halfWidth &&
    Math.abs(point.y - roof.axial) <= roof.halfDepth
}

export function rainRoofNearBox(roof: RainRoof, center: Point, halfSize: number) {
  const radialReach = halfSize * Math.SQRT2
  return center.x * roof.cos + center.z * roof.sin >= roof.radial - radialReach &&
    Math.abs(-center.x * roof.sin + center.z * roof.cos) <= roof.halfWidth + radialReach &&
    Math.abs(center.y - roof.axial) <= roof.halfDepth + halfSize
}
