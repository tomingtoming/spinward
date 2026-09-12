import { getArrivalSquare, getCityBlockLength, type CityBuilding, type CityRoad } from './cityLayout'
import { cityBlockSpec, type BlockSpec, type BlockVolume } from './authoredCityBlockPlan'
import { colonyBuildingSpec } from './colonyBuildingPlan'
import { colonyBuildingDesign } from './colonyBuildingDesign'
import { colonyBuildingSeed } from './colonyBuildingUse'
import { colonyRoofSurface, colonyRoofUnits } from './colonyRoofs'
import { SurfaceIndex } from './streetAccess'

export const OLD_TOWN_LOT_LIMIT = 16
export type OldTownModule = 'water_tank' | 'header_tank' | 'meter_bank' | 'laundry'
export type OldTownPart = BlockVolume & { module: OldTownModule | 'box'; tint: string; range: 'street' | 'roof'; solid?: boolean }
export type OldTownLot = { spec: BlockSpec; parts: OldTownPart[] }
export type OldTownPaving = { azimuth: number; axial: number; tangentWidth: number; axialLength: number }

/** Find a real gap from a rear wall to the arrival street. A failed fit simply
 * omits the court; neither lots nor obstacles move to make a decoration fit. */
export function planOldTownCourt(lots: OldTownLot[], buildings: CityBuilding[], roads: CityRoad[], radius: number, length: number, obstacles: CityBuilding[] = []): OldTownPaving[] {
  const square = getArrivalSquare(radius, length)
  if (!square) return []
  const street = roads.find(r => Math.abs(r.axial - square.axial) < .01 && r.tangentWidth > r.axialLength && Math.abs(r.azimuth) * radius < r.tangentWidth / 2)
  if (!street) return []
  const occupied = [...buildings, ...obstacles].map(b => ({ azimuth: b.azimuth, axial: b.axial, tangentWidth: b.width, axialLength: b.depth }))
  const index = new SurfaceIndex(radius)
  occupied.forEach((r, i) => index.insert(r, i))
  const clear = (r: OldTownPaving) => ![...index.query(r)].some(i => {
    const o = occupied[i]
    return Math.abs(Math.atan2(Math.sin(r.azimuth - o.azimuth), Math.cos(r.azimuth - o.azimuth))) * radius < (r.tangentWidth + o.tangentWidth) / 2 + .25 &&
      Math.abs(r.axial - o.axial) < (r.axialLength + o.axialLength) / 2 + .25
  }) && !roads.some(o => Math.abs(r.azimuth - o.azimuth) * radius < (r.tangentWidth + o.tangentWidth) / 2 && Math.abs(r.axial - o.axial) < (r.axialLength + o.axialLength) / 2 - 1e-6)
  for (const lot of lots) {
    const b = lot.spec.building
    if (b.front?.axis !== 'axial' || b.front.side !== -1 || b.height < 12) continue
    const start = b.axial + b.depth / 2 + .3, end = street.axial - street.axialLength / 2
    if (end - start < 12 || end - start > 100) continue
    const courtLength = Math.min(18, (end - start) * .45)
    for (const width of [Math.min(18, b.width * .8), 10, 6]) {
      const court = { azimuth: b.azimuth, axial: start + courtLength / 2, tangentWidth: width, axialLength: courtLength }
      const pathStart = start + courtLength
      const path = { azimuth: b.azimuth, axial: (pathStart + end) / 2, tangentWidth: 1.4, axialLength: end - pathStart }
      if (clear(court) && clear(path)) return [court, path]
    }
  }
  return []
}

/** One existing block beside the port arrival square. Its street boundaries,
 * certified entrances and procedural building seeds remain authoritative. */
export function planOldTownBlock(buildings: CityBuilding[], roads: CityRoad[], radius: number, length: number,
  interiors: ReadonlyMap<CityBuilding, unknown> = new Map()): OldTownLot[] {
  const square = getArrivalSquare(radius, length)
  if (!square || radius < 800) return []
  const pitch = getCityBlockLength(radius, length)
  // First parallel avenue east of arrival, rather than a radius-specific coordinate.
  const avenue = roads.filter(r => r.kind !== 'alley' && r.axialLength > length * .5 && r.azimuth > 1e-5)
    .sort((a, b) => a.azimuth - b.azimuth)[0]
  if (!avenue) return []
  return buildings.filter(b => b.azimuth > 0 && b.azimuth < avenue.azimuth &&
    b.axial < square.axial && b.axial > square.axial - pitch && (b.oldTown ?? 0) > .5 &&
    !b.industrial && b.front && b.parcel && !interiors.has(b) && !cityBlockSpec(b, radius))
    .sort((a, b) => b.axial - a.axial || a.azimuth - b.azimuth).slice(0, OLD_TOWN_LOT_LIMIT)
    .map(b => oldTownLot(colonyBuildingSpec(b)))
}

function oldTownLot(spec: BlockSpec): OldTownLot {
  const parts: OldTownPart[] = [], seed = colonyBuildingSeed(spec.building)
  const add = (module: OldTownPart['module'], v: BlockVolume, tint: string, range: OldTownPart['range'], solid = false) =>
    parts.push({ ...v, module, tint, range, solid })
  const wall = spec.volumes.filter(v => v.y - v.h / 2 < .01).sort((a, b) => b.w * b.d - a.w * a.d)[0]
  if (wall && wall.w > 3 && wall.h > 2) {
    // Rear corner: clear of the door, balcony and window bays. Every bracket
    // meets the wall; no wires hang across a road or an external stair flight.
    const x = wall.x + (seed % 2 ? 1 : -1) * (wall.w / 2 - .13), z = wall.z - wall.d / 2
    const top = wall.y + wall.h / 2 - .16
    const pipe = ['78827b', '8c8270', '687779'][seed % 3]
    add('box', { x, y: (top + .18) / 2, z: z - .105, w: .085, h: top - .18, d: .085 }, pipe, 'street')
    for (let y = .5; y < top; y += 2.5)
      add('box', { x, y, z: z - .064, w: .22, h: .065, d: .13 }, '505c5a', 'street')
    // Repaired splash zone sits below the lowest sill. Physical thickness
    // avoids coplanar overlays, while leaving the original window grammar intact.
    const span = Math.min(wall.w - .6, 3.2 + seed % 5)
    add('box', { x: wall.x, y: .23, z: z - .018, w: span, h: .42, d: .04 },
      ['878980', '9d998b', '807f78'][seed % 3], 'street')
    add('meter_bank', { x: x + (x > wall.x ? -.72 : .72), y: .08, z: z - .16, w: 1.05, h: .64, d: .3 }, 'ffffff', 'street')
    const serviceDoor = colonyBuildingDesign(spec.building).use.groundHeight >= 2.4 && wall.h > 4
    const conduitEnd = wall.x + (serviceDoor ? Math.sign(x - wall.x) * .68 : 0)
    add('box', { x: (conduitEnd + x) / 2, y: .5, z: z - .06, w: Math.abs(x - conduitEnd), h: .035, d: .045 }, pipe, 'street')
    // Mixed-use podium backs have a blank service zone below the upper windows.
    // A closed maintenance door gives that zone a use without advertising entry.
    if (serviceDoor) {
      add('box', { x: wall.x, y: 1.09, z: z - .025, w: 1.06, h: 2.18, d: .06 }, '9c9e91', 'street')
      add('box', { x: wall.x, y: 1.04, z: z - .065, w: .9, h: 2.06, d: .025 }, '596c69', 'street')
      add('box', { x: wall.x + .32, y: 1.06, z: z - .095, w: .045, h: .19, d: .04 }, 'b1b1a0', 'street')
    }
  }

  const roof = colonyRoofSurface(spec)
  if (!roof) return { spec, parts }
  const occupied = colonyRoofUnits(spec, colonyBuildingDesign(spec.building)).map(u =>
    ({ ...u, w: u.yaw ? u.d : u.w, d: u.yaw ? u.w : u.d }))
  const top = roof.y + roof.h / 2
  const reserve = (module: OldTownModule, w: number, h: number, d: number, solid: boolean) => {
    // Edge middles and quarter points: corners already house HVAC. Retain an
    // 80 cm equipment aisle, a metre at the parapet and the beacon at the centre.
    for (const [sx, sz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [.5, -.5], [-.5, .5]]) {
      const x = roof.x + sx * (roof.w / 2 - 1.1 - w / 2)
      const z = roof.z + sz * (roof.d / 2 - 1.1 - d / 2)
      if (Math.abs(x - roof.x) + w / 2 > roof.w / 2 - 1 || Math.abs(z - roof.z) + d / 2 > roof.d / 2 - 1) continue
      if (Math.abs(x - roof.x) < w / 2 + 1.1 && Math.abs(z - roof.z) < d / 2 + 1.1) continue
      if (occupied.some(u => Math.abs(x - u.x) < (w + u.w) / 2 + .8 && Math.abs(z - u.z) < (d + u.d) / 2 + .8)) continue
      const v = { x, y: top, z, w, h, d }
      add(module, v, 'ffffff', 'roof', solid); occupied.push({ ...v, kind: 'roof_hvac', yaw: 0, tint: 0 })
      return true
    }
    return false
  }
  if (seed % 3 === 0) reserve('header_tank', 3.2, 2.4, 2.2, true)
  else reserve('water_tank', 2.4, 3.4, 2.4, true)
  if (colonyBuildingDesign(spec.building).use.primary === 'apartments' && seed % 2 === 0)
    reserve('laundry', 3.2, 1.9, 1.3, false)
  return { spec, parts }
}

export function oldTownColliders(lots: OldTownLot[], radius: number) {
  return lots.flatMap(lot => lot.parts.filter(p => p.solid).map(p => {
    const b = lot.spec.building, side = b.front!.side, tangent = b.front!.axis === 'tangent'
    // Convert the actual raised mesh centre to cylinder coordinates. Dividing
    // its tangential offset by the ground radius displaces wide-roof equipment.
    const radial = radius - p.y - p.h / 2, across = side * (tangent ? p.z : -p.x)
    return { ...b, azimuth: b.azimuth + Math.atan2(across, radial), axial: b.axial + side * (tangent ? p.x : p.z),
      width: tangent ? p.d : p.w, depth: tangent ? p.w : p.d, height: p.h,
      baseHeight: radius - Math.hypot(radial, across) - p.h / 2, collisionMargin: 0, groundMargin: 0 }
  }))
}

export function oldTownPavingColliders(paving: OldTownPaving[]): CityBuilding[] {
  return paving.map(p => ({ azimuth: p.azimuth, axial: p.axial, width: p.tangentWidth, depth: p.axialLength,
    height: .12, baseHeight: 0, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5 }))
}

/** Keep roof silhouettes beyond the alley-detail range, with hysteresis. */
export function oldTownLod(distance: number, previous: number): 0 | 1 | 2 | 3 {
  if (distance < (previous === 0 ? 100 : 85)) return 0
  if (distance < (previous <= 1 ? 280 : 250)) return 1
  if (distance < (previous <= 2 ? 780 : 700)) return 2
  return 3
}
