import catalog from './generated/metroTransit.json'
import { matchesMetroFrames, type MetroStudyFrame } from './metroPlaces'
import { railPoint } from '../gameplay/railService'
import type { ColonyRailData, RailLine, RailPoint, RailStation } from './colonyRailData'
import type { ColonyPackedMesh } from './authoredColony'
import type { LandscapeLight } from './landscapeData'

export type TramAsset = { configuration: ColonyRailData['configuration']; vehicle: Record<string, ColonyPackedMesh>;
  vehicleLight: LandscapeLight; palette: Record<string, string>; materialDetails: Record<string, unknown> }
type SourceLine = (typeof catalog.lines)[number]

// A street tram, not the colony's automated line: 40 km/h and short dwells.
// Doors open toward the centreline, so stops are street-level islands between
// the two tracks; the boarding point is the island edge beside each door.
export const METRO_TRAM = { maxSpeed: 11.1, dwellSeconds: 20, trainsPerLine: 6, islandEdge: catalog.islandEdge }

/** Tokyo source metres to the colony rail frame used by RailService:
 * [arc along the hull, axial, height above the hull floor]. */
export function metroRailLine(line: SourceLine, band: number, radius: number): RailLine {
  const points = line.points.map(([s, x, y, h]) => [s, -(band * Math.PI * 2 / 3 * radius + x), -y, h] as [number, number, number, number])
  return { id: line.id, band, name: line.name, color: line.color, length: line.length, points,
    stations: line.stations.map(stop => stop.id) }
}

export function metroRailData(study: MetroStudyFrame, asset: TramAsset): ColonyRailData | null {
  if (!matchesMetroFrames(study, catalog)) return null
  const lines: RailLine[] = [], stations: RailStation[] = []
  for (const source of catalog.lines) {
    const sample = study.samples.find(s => s.id === source.band)
    if (!sample) return null
    const line = metroRailLine(source, sample.band, study.radius)
    source.stations.forEach((stop, number) => {
      // The island follows the street's crossfall average, not the smoothed track.
      const position = railPoint(line, stop.s), before = railPoint(line, stop.s - 2), after = railPoint(line, stop.s + 2)
      const platform: RailPoint = [position[0], position[1], stop.height]
      const boarding = [-METRO_TRAM.islandEdge, METRO_TRAM.islandEdge].map(lateral => {
        const [x, y] = railPoint(line, stop.s, lateral); return [x, y, stop.height] as RailPoint
      })
      stations.push({ id: stop.id, band: sample.band, number, name: stop.name, line: line.id, s: stop.s,
        position, platform, entry: platform, boarding, approach: boarding,
        platformHeight: 0, platformWidth: 2 * METRO_TRAM.islandEdge, platformLength: asset.configuration.carLength + 4,
        roofLength: 0, yaw: Math.atan2(after[0] - before[0], after[1] - before[1]) })
    })
    lines.push(line)
  }
  return { version: 1, configuration: { ...asset.configuration, maxSpeed: METRO_TRAM.maxSpeed,
    dwellSeconds: METRO_TRAM.dwellSeconds, trainsPerLine: METRO_TRAM.trainsPerLine },
  lines, stations, vehicle: asset.vehicle, vehicleLight: asset.vehicleLight, lights: [],
  fixed: { vertices: [], meshes: {}, surfaces: [] } }
}
