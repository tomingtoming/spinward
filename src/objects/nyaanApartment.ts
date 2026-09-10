import contract from '../../assets/blender/nyaan-apartment.json'
import type { CityBuilding } from './cityLayout'
import type { BuildingInterior, InteriorPart } from './buildingInteriors'
import type { AuthoredPilotSpec } from './cafePilot'

export const NYAAN_APARTMENT = contract
export const NYAAN_PILOT: AuthoredPilotSpec = {
  id: 'nyaan', radius: contract.habitat.radius, kind: 'apartment', building: contract.interior.building,
  asset: '/assets/buildings/nyaan-apartment.glb', nodePrefix: 'nyaan_runtime_lod'
}

export function planNyaanApartment(buildings: readonly CityBuilding[], radius: number): BuildingInterior | null {
  if (radius !== contract.habitat.radius) return null
  const target = contract.interior.building
  const building = buildings.find(b => b.kind === target.kind && b.front?.axis === target.front.axis && b.front.side === target.front.side &&
    (['azimuth', 'axial', 'width', 'depth', 'height'] as const).every(k => Math.abs(b[k] - target[k]) < 1e-6))
  if (!building) return null
  return { building, kind: 'apartment', frontage: contract.interior.frontage, depth: contract.interior.depth, parts: contract.interior.parts as InteriorPart[] }
}

export function apartmentShelter(interior: BuildingInterior, radius: number, azimuth: number, axial: number, altitude: number) {
  const b = interior.building, f = b.front!
  const t = Math.atan2(Math.sin(azimuth - b.azimuth), Math.cos(azimuth - b.azimuth)) * radius, a = axial - b.axial
  const x = f.axis === 'tangent' ? f.side * a : -f.side * t, z = f.axis === 'tangent' ? f.side * t : f.side * a
  if (altitude < 0 || altitude > 3.1 || Math.abs(x) > interior.frontage / 2 - .12 || z < -interior.depth / 2 + .12) return 0
  if (z <= interior.depth / 2 - .2) return 1
  if (Math.abs(x) > .76) return 0
  return Math.max(0, Math.min(1, (interior.depth / 2 + .6 - z) / .8))
}
