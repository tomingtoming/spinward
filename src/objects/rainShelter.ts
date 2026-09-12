import type { BuildingInterior } from './buildingInteriors'
import { interiorPartBuilding } from './buildingInteriors'
import type { CityExpressway } from './cityLayout'

export const MAX_RAIN_ROOFS = 16
export const MAX_RAIN_ARCS = 8
/** A cylindrical deck or a ramp whose radial height changes along its arc. */
export type RainArcRoof = {
  start: number; span: number; axial: number; halfDepth: number
  radiusStart: number; radiusEnd: number
}
export type RainRoof = {
  cos: number; sin: number; axial: number; radial: number
  halfWidth: number; halfDepth: number; yaw?: number
}
type Point = { x: number; y: number; z: number }

export function planExpresswayRainRoofs(road: CityExpressway | null, radius: number): RainArcRoof[] {
  if (!road) return []
  const top = radius - road.deckHeight
  const roofs: RainArcRoof[] = [{ start: 0, span: Math.PI * 2, axial: road.axial,
    halfDepth: road.deckWidth / 2, radiusStart: top, radiusEnd: top }]
  for (const ramp of road.ramps) {
    const axial = road.axial + road.deckWidth / 2 + road.rampWidth / 2
    roofs.push({ start: ramp.azimuthStart, span: ramp.azimuthSpan, axial, halfDepth: road.rampWidth / 2,
      radiusStart: radius - .22, radiusEnd: top })
    roofs.push({ start: ramp.azimuthStart + ramp.azimuthSpan, span: road.collectorSpan, axial,
      halfDepth: road.rampWidth / 2, radiusStart: top, radiusEnd: top })
  }
  return roofs
}

const turn = Math.PI * 2
const progress = (angle: number, start: number) => ((angle - start) % turn + turn) % turn

export function rainArcCoversPoint(roof: RainArcRoof, point: Point) {
  const angle = progress(Math.atan2(point.z, point.x), roof.start)
  return angle <= roof.span && Math.abs(point.y - roof.axial) <= roof.halfDepth &&
    Math.hypot(point.x, point.z) >= roof.radiusStart + (roof.radiusEnd - roof.radiusStart) * angle / roof.span
}

/** Open-sided cover softens the direct rain sound near its edge. It does not
 * turn a public walkway into an enclosed room or silence the rain outside. */
export function sampleRainShelter(roofs: readonly RainRoof[], arcs: readonly RainArcRoof[], point: Point) {
  let inset = 0
  for (const roof of roofs) if (rainRoofCoversPoint(roof, point)) {
    const {x,y}=roofOffsets(roof,point)
    inset = Math.max(inset, Math.min(roof.halfWidth - Math.abs(x), roof.halfDepth - Math.abs(y)))
  }
  for (const roof of arcs) if (rainArcCoversPoint(roof, point)) {
    const angle = progress(Math.atan2(point.z, point.x), roof.start)
    const edge = roof.span >= turn - 1e-6 ? Infinity : Math.min(angle, roof.span - angle) * Math.hypot(point.x, point.z)
    inset = Math.max(inset, Math.min(edge, roof.halfDepth - Math.abs(point.y - roof.axial)))
  }
  return Math.min(1, inset / 1.5)
}

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
  const {x,y}=roofOffsets(roof,point)
  return point.x * roof.cos + point.z * roof.sin >= roof.radial &&
    Math.abs(x) <= roof.halfWidth && Math.abs(y) <= roof.halfDepth
}

const localRoofPoint = { x: 0, y: 0 }
function roofOffsets(roof: RainRoof, point: Point) {
  const tangent=-point.x*roof.sin+point.z*roof.cos,axial=point.y-roof.axial
  const c=Math.cos(roof.yaw??0),s=Math.sin(roof.yaw??0)
  localRoofPoint.x=tangent*c+axial*s;localRoofPoint.y=-tangent*s+axial*c
  return localRoofPoint
}

export function rainRoofNearBox(roof: RainRoof, center: Point, halfSize: number) {
  const radialReach = halfSize * (roof.yaw ? Math.sqrt(3) : Math.SQRT2)
  const {x,y}=roofOffsets(roof,center)
  return center.x * roof.cos + center.z * roof.sin >= roof.radial - radialReach &&
    Math.abs(x) <= roof.halfWidth + radialReach &&
    Math.abs(y) <= roof.halfDepth + (roof.yaw ? radialReach : halfSize)
}
