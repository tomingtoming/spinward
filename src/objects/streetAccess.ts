import type { CityBuilding } from './cityLayout'
import type { StreetPolygon } from './streetPolygon'

export type StreetAccess = {
  // Identity and index in the certified network. Legacy adapters preserve roads order.
  roadId: string
  roadIndex: number
  entrance: { azimuth: number; axial: number }
  roadEdge: { azimuth: number; axial: number }
  width: number
  length: number
  // Convex pieces in surface metres relative to entrance; no axis assumption.
  corridor?: StreetPolygon[]
}

export { SurfaceIndex } from './surfaceIndex'
export const roadId = (index: number) => `road-${index}`
export { certifyStreetAccess } from './streetFrontage'
export type StreetAccessRejection = { building: CityBuilding; reason: 'missing-front' | 'road-overlap' | 'no-connected-frontage' | 'blocked-path' }
