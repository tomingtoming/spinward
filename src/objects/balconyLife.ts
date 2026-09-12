import type {BlockSpec} from './authoredCityBlockPlan'
import type {ColonyBalconyPlan} from './colonyBalconies'
import {colonyBuildingSeed} from './colonyBuildingUse'

export const BALCONY_LIFE_BAY_LIMIT = 24
export const BALCONY_LIFE_PER_BUILDING = 12
export type BalconyProp = {
  kind: 'chair' | 'table' | 'plant'
  x: number; y: number; z: number
  width: number; height: number; depth: number
  tint: number
}
export type BalconyLifeBay = {key: string; section: number; column: number; props: BalconyProp[]}
const mix = (value: number) => {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}

/** Outdoor household use, independent of whether a room's light is on.
 * Furnish only existing balcony decks. Keep a 0.6m strip along the facade,
 * a clear central door approach, and space beside the dividing partitions.
 * These are exterior details, not new traversable rooms or certified exits. */
export function planBalconyLife(spec: BlockSpec, plan: ColonyBalconyPlan): BalconyLifeBay[] {
  const seed = colonyBuildingSeed(spec.building), candidates: Array<BalconyLifeBay & {rank: number}> = []
  for (const [section, s] of plan.sections.entries()) for (let column = s.first; column <= s.last; column++) {
    const volume = spec.volumes.indexOf(s.volume)
    const rank = mix(seed ^ Math.imul(volume + 1, 73856093) ^ Math.imul(s.row + 1, 19349663) ^ Math.imul(column + 1, 83492791))
    if (rank % 100 < 58 || s.pitch < 2.4) continue
    const center = s.volume.x + (column + .5) * s.pitch - s.volume.w / 2
    const edge = s.pitch / 2 - .08 - .28
    const tea = s.depth >= 1.12 && rank % 3 === 0
    const props: BalconyProp[] = []
    for (const side of [-1, 1]) {
      if (!tea && side === 1 && (rank >>> 4) % 2 === 0) continue
      const kind = tea ? (side === -1 ? 'chair' : 'table') : 'plant'
      const width = kind === 'chair' ? .46 : kind === 'table' ? .32 : .26
      const depth = kind === 'chair' ? .38 : kind === 'table' ? .3 : .24
      const height = kind === 'chair' ? .82 : kind === 'table' ? .6 : [.48, .65, .85][(rank >>> 8) % 3]
      // The existing module ends at 0.96 × depth, not at the nominal depth.
      const z = s.z + .96 * s.depth - .07 - depth / 2
      const x = center + side * (edge - width / 2)
      if (z - depth / 2 < s.z + .6 || Math.abs(x - center) - width / 2 < .55) continue
      props.push({kind, x, y: s.y, z, width, height, depth, tint: (rank >>> 12) % 3})
    }
    if (props.length) candidates.push({key: `${volume}:${s.row}:${column}`, section, column, props, rank})
  }
  return candidates.sort((a, b) => a.rank - b.rank).slice(0, BALCONY_LIFE_PER_BUILDING)
    .map(({rank: _, ...bay}) => bay)
}

export function balconyLifeLod(distance: number, previous: 0 | 1 | 2): 0 | 1 | 2 {
  if (distance > (previous < 2 ? 48 : 42)) return 2
  return distance < (previous === 0 ? 24 : 20) ? 0 : 1
}
