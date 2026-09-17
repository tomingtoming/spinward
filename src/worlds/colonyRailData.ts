import type { ColonyPackedMesh } from './authoredColony'
import type { LandscapeLight } from './landscapeData'

export type RailPoint = [number, number, number]
export type RailStation = {
  id: string; band: number; number: number; name: string; line: string; s: number
  position: RailPoint; platform: RailPoint; entry: RailPoint; boarding: RailPoint[]
  approach: RailPoint[]; platformHeight: number; platformWidth: number; platformLength: number
  roofLength: number; yaw: number
}
export type RailLine = { id: string; band: number; name: string; color: string; length: number;
  points: [number, number, number, number][]; stations: string[] }
export type ColonyRailData = {
  version: 1; configuration: { trackCentres: number; gauge: number; carLength: number; carWidth: number;
    carHeight: number; carFloor: number; dwellSeconds: number; maxSpeed: number; acceleration: number;
    braking: number; trainsPerLine: number }
  lines: RailLine[]; stations: RailStation[]; fixed: ColonyPackedMesh
  lights: LandscapeLight[]; vehicleLight: LandscapeLight; vehicle: Record<string, ColonyPackedMesh>
}
