import type { CityBuilding } from './cityLayout'
import { fitSuburbanHouse } from './buildingAssets'
import { wrapBuildingAngleToPi } from './buildingLod'
import { SurfaceIndex } from './streetAccess'

export type InteriorKind = 'cafe' | 'passage' | 'court' | 'apartment'
export type InteriorPart = {
  // Front-local metres: x along facade, z towards the street, y inward/up.
  x: number; y: number; z: number
  width: number; height: number; depth: number
  material: 'wall' | 'upper' | 'wood' | 'green' | 'light' | 'sign'
  detail: 3 | 2 | 1 | 0
  solid: boolean
}
export type BuildingInterior = {
  building: CityBuilding
  kind: InteriorKind
  frontage: number
  depth: number
  parts: InteriorPart[]
}

export const INTERIOR_ROOM_HEIGHT = 4.2
export const INTERIOR_DOOR_WIDTH = 3.2

// Eligibility and identity do not depend on a camera, loaded assets, or LOD.
// One suitable public building per 180m cell, spread over every land strip.
export const planBuildingInteriors = (buildings: readonly CityBuilding[], radius: number) => {
  const result = new Map<CityBuilding, BuildingInterior>()
  if (radius < 800) return result
  const cells = new Map<string, { building: CityBuilding; score: number }>()
  const circumference = Math.PI * 2 * radius
  const columns = Math.ceil(circumference / 180)
  const pitch = circumference / columns
  for (const building of buildings) {
    if (!building.front || !building.access || building.kind !== 'block' || fitSuburbanHouse(building)) continue
    const frontage = building.front.axis === 'tangent' ? building.depth : building.width
    const depth = building.front.axis === 'tangent' ? building.width : building.depth
    if (frontage < 10 || frontage > 32 || depth < 10 || depth > 32 || building.height < 8) continue
    const tangent = ((building.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * radius
    const col = Math.floor(tangent / pitch), row = Math.floor(building.axial / 180)
    const key = `${col}:${row}`
    const score = Math.hypot(tangent - (col + 0.5) * pitch, building.axial - (row + 0.5) * 180)
    const previous = cells.get(key)
    if (!previous || score < previous.score) cells.set(key, { building, score })
  }
  const footprintIndex = new SurfaceIndex(radius)
  buildings.forEach((b, index) => footprintIndex.insert({ ...b, tangentWidth: b.width, axialLength: b.depth }, index))
  for (const { building } of cells.values()) {
    const kind: InteriorKind = building.industrial ? 'passage' : building.tone < 0.34 ? 'court' : building.tone < 0.67 ? 'passage' : 'cafe'
    // Rear exits need an unobstructed landing, not merely a hole in the wall.
    // A blocked passage becomes a cafe; courtyards keep their single street entry.
    let resolvedKind = kind
    if (kind === 'passage') {
      const front = building.front!
      const backT = front.axis === 'tangent' ? -front.side * (building.width / 2 + 2) : 0
      const backA = front.axis === 'axial' ? -front.side * (building.depth / 2 + 2) : 0
      const landing = { azimuth: building.azimuth + backT / radius, axial: building.axial + backA, tangentWidth: 4, axialLength: 4 }
      const blocked = [...footprintIndex.query(landing)].some(index => {
        const other = buildings[index]
        return other !== building &&
        Math.abs(wrapBuildingAngleToPi(other.azimuth - building.azimuth) * radius - backT) < other.width / 2 + 2 &&
        Math.abs(other.axial - building.axial - backA) < other.depth / 2 + 2
      })
      if (blocked) resolvedKind = 'cafe'
    }
    result.set(building, createBuildingInterior(building, resolvedKind))
  }
  return result
}

export const createBuildingInterior = (building: CityBuilding, kind: Exclude<InteriorKind, 'apartment'>): BuildingInterior => {
  const front = building.front!
  const w = front.axis === 'tangent' ? building.depth : building.width
  const d = front.axis === 'tangent' ? building.width : building.depth
  const h = INTERIOR_ROOM_HEIGHT, wall = 0.3, door = INTERIOR_DOOR_WIDTH
  const parts: InteriorPart[] = []
  const box = (x: number, y: number, z: number, width: number, height: number, depth: number,
    material: InteriorPart['material'], detail: InteriorPart['detail'] = 3, solid = true) => {
    parts.push({ x, y, z, width, height, depth, material, detail, solid })
  }
  // The cylinder itself remains the continuous, step-free floor. All walls,
  // lintels and ceilings exist in physics regardless of rendered detail.
  const portal = (z: number) => {
    for (const side of [-1, 1]) box(side * (w + door) / 4, h / 2, z, (w - door) / 2, h, wall, 'wall')
    box(0, (h + 3.1) / 2, z, door, h - 3.1, wall, 'wall')
  }
  portal(d / 2 - wall / 2)
  if (kind === 'passage') portal(-d / 2 + wall / 2)
  else box(0, h / 2, -d / 2 + wall / 2, w, h, wall, 'wall')
  for (const side of [-1, 1]) box(side * (w / 2 - wall / 2), h / 2, 0, wall, h, d - 2 * wall, 'wall')
  const upperHeight = building.height - h
  if (kind === 'court') {
    // A light well through the entire building: the opposite city is framed
    // overhead. The upper ring retains the original exterior silhouette.
    const wing = Math.min(3, w * 0.22, d * 0.22)
    for (const side of [-1, 1]) {
      box(side * (w - wing) / 2, h + upperHeight / 2, 0, wing, upperHeight, d, 'upper')
      box(0, h + upperHeight / 2, side * (d - wing) / 2, w - 2 * wing, upperHeight, wing, 'upper')
    }
  } else box(0, h + upperHeight / 2, 0, w, upperHeight, d, 'upper')

  // Public entrances use the same warm canopy and two vertical markers.
  // They stay inside the certified footprint and leave the 3.2m portal clear.
  box(0, 3.65, d / 2 - 0.01, door + 1, 0.45, 0.04, 'sign', 2, false)
  box(0, 3.25, d / 2 - 0.6, door + 1, 0.15, 1.1, 'light', 2, false)
  for (const side of [-1, 1]) box(side * (door / 2 + 0.1), 1.5, d / 2 - 0.02, 0.08, 3, 0.04, 'light', 2, false)
  // Permanent furnishings are solid and already visible from the street.
  // Only small non-solid dressing is LOD0; no invisible furniture appears.
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 1.4)
    box(x, 0.3, 0, 1.5, 0.6, 2.4, kind === 'court' ? 'wall' : 'wood', 1)
    if (kind === 'court') box(x, 0.85, 0, 1.2, 0.5, 2, 'green', 1, false)
    else {
      box(x, 0.72, -0.95, 1.4, 0.85, 0.16, 'wood', 1)
      box(x, 0.67, 0.6, 0.24, 0.12, 0.18, 'light', 0, false)
    }
  }
  if (kind === 'cafe') {
    for (const side of [-1, 1]) {
      const x = side * Math.min(3.2, w / 2 - 2.4)
      box(x, 0.95, 1.8, 1.2, 0.12, 1.2, 'wood', 1)
      box(x, 0.45, 1.8, 0.2, 0.9, 0.2, 'wood', 1)
      box(x, 1.1, 1.8, 0.12, 0.18, 0.12, 'light', 0, false)
    }
    box(0, 0.55, -d / 2 + 1.25, w - 2, 1.1, 1, 'wood', 1)
    for (const x of [-1, 0, 1]) box(x * 0.55, 1.2, -d / 2 + 1.25, 0.18, 0.2, 0.18, 'light', 0, false)
  }
  return { building, kind, frontage: w, depth: d, parts }
}

// Convert both rendering and collision to exactly the same curved-world boxes.
export const interiorPartBuilding = (interior: BuildingInterior, part: InteriorPart, radius: number): CityBuilding => {
  const b = interior.building, front = b.front!
  const t = front.axis === 'tangent' ? front.side * part.z : -front.side * part.x
  const a = front.axis === 'tangent' ? front.side * part.x : front.side * part.z
  return {
    kind: 'block', tone: b.tone,
    azimuth: b.azimuth + t / radius, axial: b.axial + a,
    width: front.axis === 'tangent' ? part.depth : part.width,
    depth: front.axis === 'tangent' ? part.width : part.depth,
    height: part.height, baseHeight: part.y - part.height / 2,
    // The compact authored apartment uses measured openings, without car clearance padding.
    ...(interior.kind === 'apartment' ? { collisionMargin: 0 } : {})
  }
}

export const interiorCollisionBuildings = (interior: BuildingInterior, radius: number) =>
  interior.parts.filter(part => part.solid).map(part => interiorPartBuilding(interior, part, radius))

// Distance to the footprint, including altitude, not its centre. A large room
// stays loaded at its corners, and flying over its roof does not load furniture.
export const interiorDistance = (interior: BuildingInterior, radius: number, azimuth: number, axial: number, altitude: number) => {
  const b = interior.building
  const t = Math.abs(wrapBuildingAngleToPi(azimuth - b.azimuth) * radius)
  const a = Math.abs(axial - b.axial)
  return Math.hypot(Math.max(0, t - b.width / 2), Math.max(0, a - b.depth / 2), Math.max(0, altitude - INTERIOR_ROOM_HEIGHT, -altitude))
}

export type BuildingExperienceLod = 0 | 1 | 2 | 3 | 4
export const selectBuildingExperienceLod = (distance: number, previous: BuildingExperienceLod = 4): BuildingExperienceLod => {
  // Exit hysteresis prevents flicker at a doorway or street boundary.
  for (const [level, boundary] of [[0, 10], [1, 48], [2, 160], [3, 1400]] as const) {
    if (distance <= boundary * (previous <= level ? 1.2 : 1)) return level
  }
  return 4
}

