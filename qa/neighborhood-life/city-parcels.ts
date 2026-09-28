// Native authoring metadata for geometry checks, never a browser import.
import { readFileSync } from 'node:fs'
import type original from '../../assets/blender/izma-neighbourhood-parcels.json'

type LegacyParcel = typeof original.parcels[number]
type CityParcel = Pick<LegacyParcel, 'id' | 'band' | 'district' | 'family' | 'position' | 'floor' |
  'foundationBottom' | 'size' | 'yaw' | 'floors' | 'form' | 'volumes' | 'proxyParts' | 'access' | 'route'> & {
  outline: number[][]
  entrance: { start: number[]; end: number[]; width: number; ramp: boolean; steps: number; landingLength?: number }
  entryConnection?: number[][]
}
export type NeighbourhoodParcel = LegacyParcel | CityParcel
export const isLegacyParcel = (p: NeighbourhoodParcel): p is LegacyParcel => 'lot' in p

type CityContract = {
  dependencies: Record<string, string>
  parcels: NeighbourhoodParcel[]
  cityFabric: { planHash: string; retiredParcelIds: string[]; newParcelIds: string[]; blocks: number }
}
const city = JSON.parse(readFileSync(new URL('../../assets/blender/izma-city-neighbourhoods.json', import.meta.url), 'utf8')) as CityContract
export default city
