import type { HabitatTopology, HabitatType } from '../sim/habitatConfig'

export type AuthoredWorldId = 'izma' | 'cooper' | 'elysium'
export type WorldRegion = {
  name: string
  // Unrolled metres, relative to the centre of the first inhabited strip.
  centre: [number, number]
  extent: [number, number]
  use: 'urban' | 'residential' | 'garden' | 'industry' | 'water'
}

/** Design intentions, not claims about canonical film dimensions or maps.
 * These master plans stay independent of the renderer and its quality tier. */
export const WORLD_DEFINITIONS = {
  izma: {
    name: 'Izma Colony', radius: 3200, span: 40000, type: 'cylinder', strips: 3,
    district: 'River terraces',
    regions: [
      { name: 'Port and industry', centre: [0, -15500], extent: [2800, 7000], use: 'industry' },
      { name: 'Old river town', centre: [-300, -8200], extent: [1900, 5800], use: 'urban' },
      { name: 'River terraces', centre: [0, 0], extent: [2400, 9000], use: 'residential' },
      { name: 'Civic centre', centre: [420, 8000], extent: [1600, 4600], use: 'urban' },
      { name: 'Upper water gardens', centre: [-420, 14700], extent: [1800, 4500], use: 'garden' }
    ]
  },
  cooper: {
    name: 'Cooper Station', radius: 3200, span: 32000, type: 'cylinder', strips: 1,
    district: 'Ballpark neighbourhood',
    regions: [
      { name: 'Arrival campus', centre: [0, -12600], extent: [6000, 4200], use: 'urban' },
      { name: 'Town and commons', centre: [0, 0], extent: [7400, 14000], use: 'residential' },
      { name: 'Green belt', centre: [6400, 0], extent: [4600, 21000], use: 'garden' },
      { name: 'Hillside neighbourhoods', centre: [-6200, 2800], extent: [5300, 15000], use: 'residential' }
    ]
  },
  elysium: {
    name: 'Elysium', radius: 30000, span: 2000, type: 'ring', strips: 1,
    district: 'Hillside gardens',
    regions: [
      { name: 'Garden estates', centre: [0, 0], extent: [38000, 1600], use: 'garden' },
      { name: 'Arrival gardens', centre: [40000, -150], extent: [15000, 1200], use: 'urban' },
      { name: 'Water gardens', centre: [67000, 0], extent: [27000, 1700], use: 'water' },
      { name: 'Outer estates', centre: [-61000, 0], extent: [48000, 1600], use: 'residential' }
    ]
  }
} as const

/** RPM may change freely. A dimension/topology edit leaves the fixed map
 * instead of stretching authored roads, doors or terrain to a new scale. */
export function resolveAuthoredWorld(config: {
  worldId?: string; radius: number; length: number; type?: HabitatType; topology?: HabitatTopology
}): AuthoredWorldId | null {
  if (!config.worldId || !Object.hasOwn(WORLD_DEFINITIONS, config.worldId)) return null
  const id = config.worldId as AuthoredWorldId, world = WORLD_DEFINITIONS[id]
  if (Math.abs(config.radius - world.radius) > .001 || Math.abs(config.length - world.span) > .001 || config.type !== world.type) return null
  const arcs = config.topology?.landArcs
  if (!arcs || arcs.length !== world.strips) return null
  if (id === 'izma') {
    if (arcs.some((a, i) => Math.abs(a.centerAzimuth - i * Math.PI * 2 / 3) > 1e-6 || Math.abs(a.arcRadians - Math.PI / 3) > 1e-6)) return null
  } else if (Math.abs(arcs[0].arcRadians - Math.PI * 2) > 1e-6 || Math.abs(arcs[0].centerAzimuth) > 1e-6) return null
  return id
}
