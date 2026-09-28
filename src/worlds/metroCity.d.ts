import type { Group, Quaternion, Object3D } from 'three'
import type { StreetLampSource } from '../objects/streetLampLighting'
import type { CityCollisionIndex } from '../objects/cityLayout'
import type { HabitatTopology, HabitatType } from '../sim/habitatConfig'
import type { RegionalReadiness } from '../app/colonyMotionGate'
import type { MetroRoads } from './metroRoads'
import type { MetroStudyFrame } from './metroPlaces'
export interface MetroCity extends RegionalReadiness {
  group: Group
  active: boolean
  readonly operational: boolean
  readonly visualFocus: unknown
  setXRDetail(level: number): void
  readonly roads: MetroRoads | null
  readonly study: MetroStudyFrame
  prepareVisual: (object: Object3D) => Promise<void>
  readonly index: CityCollisionIndex
  readonly floorHeight: number
  configure(dimensions: { radius: number; length: number; worldId?: string; type?: HabitatType; topology?: HabitatTopology }): boolean
  update(azimuth: number, axial: number, altitude: number): void
  setDaylight(value: number): void
  nightLights(target: Group): StreetLampSource[]
  visit(kind: string): { azimuth: number; axial: number; groundHeight: number; orientation: Quaternion } | null
  diagnostics(): unknown
  dispose(): void
}
export function loadMetroCity(tier?: 'desktop' | 'phone' | 'quest'): Promise<MetroCity>
