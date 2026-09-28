import type { ColonyRailData, RailPoint, RailStation } from '../../worlds/colonyRailData'
import type { BandFrame } from './walker'

export type BandTerminal = { region: string; label: string; sample: BandFrame; point: number[]; ground: number }
export const TERMINAL_AXIAL = 19864
export function planBandRail(terminals: BandTerminal[], vehicle: Pick<ColonyRailData, 'vehicle' | 'vehicleLight' | 'configuration'>,
  groundHeight?: (tangent: number, axial: number) => number): ColonyRailData {
  if (terminals.length !== 3) throw Error('Three band terminals required')
  const anchors = terminals.map(t => [t.sample.band * Math.PI * 2 / 3 * 3200 + t.sample.anchor.local[0] + t.point[0],
    TERMINAL_AXIAL, t.ground] as RailPoint)
  const points: [number, number, number, number][] = []
  for (let leg = 0; leg < 2; leg++) {
    const a = anchors[leg], b = anchors[leg + 1], count = Math.ceil((b[0] - a[0]) / 16)
    for (let i = leg ? 1 : 0; i <= count; i++) {
      const u = i / count, x = a[0] + (b[0] - a[0]) * u
      // Keep each land strip's end track level. Only the window bay connects
      // the different station elevations; a straight interpolation cuts into
      // the higher strip well before its station.
      const edgeA = terminals[leg].sample.band * Math.PI * 2 / 3 * 3200 + Math.PI / 6 * 3200
      const edgeB = terminals[leg + 1].sample.band * Math.PI * 2 / 3 * 3200 - Math.PI / 6 * 3200
      const grade = Math.max(0, Math.min(1, (x - edgeA) / (edgeB - edgeA)))
      let height = a[2] + (b[2] - a[2]) * grade
      // The authoring terrain has small cross-band undulations. Sample both
      // tracks from the same triangle surface used by walking, then spread
      // any rise to keep the guideway grade at or below three percent.
      for (const lateral of [-3.15, 0, 3.15]) {
        const ground = groundHeight?.(x, TERMINAL_AXIAL + lateral)
        if (ground !== undefined && Number.isFinite(ground)) height = Math.max(height, ground + .035)
      }
      points.push([x - anchors[0][0], x, TERMINAL_AXIAL, height])
    }
  }
  for (let i = 1; i < points.length; i++) points[i][3] = Math.max(points[i][3], points[i-1][3] - .03 * (points[i][0] - points[i-1][0]))
  for (let i = points.length - 2; i >= 0; i--) points[i][3] = Math.max(points[i][3], points[i+1][3] - .03 * (points[i+1][0] - points[i][0]))
  for (const anchor of anchors) {
    const p = points.find(p => Math.abs(p[1] - anchor[0]) < .001)!
    if (Math.abs(p[3] - anchor[2]) > .015) throw Error('Rail terrain envelope conflicts with a station floor')
  }
  const stations: RailStation[] = terminals.map((t, i) => {
    const p = anchors[i], floor = p[2] + vehicle.configuration.carFloor
    return { id: t.region, band: i, number: i, name: t.label + ' 端部連絡駅', line: 'three-band-link', s: p[0] - anchors[0][0],
      position: p, platform: [p[0], TERMINAL_AXIAL, floor], entry: [p[0], TERMINAL_AXIAL + 6, p[2]],
      boarding: [[p[0], TERMINAL_AXIAL + 1.4, floor], [p[0], TERMINAL_AXIAL - 1.4, floor]],
      approach: [[p[0], TERMINAL_AXIAL + 6, p[2]], [p[0] - 10, TERMINAL_AXIAL + 6, p[2]],
        [p[0] - 10, TERMINAL_AXIAL, floor], [p[0], TERMINAL_AXIAL, floor]],
      platformHeight: .62, platformWidth: 3.4, platformLength: 22, roofLength: 14, yaw: Math.PI / 2 }
  })
  return { version: 1, configuration: { ...vehicle.configuration, dwellSeconds: 24, trainsPerLine: 3 }, stations,
    lines: [{ id: 'three-band-link', band: 0, name: '三帯連絡線', color: '#527e8d', length: points.at(-1)![0], points, stations: stations.map(s => s.id) }],
    vehicle: vehicle.vehicle, vehicleLight: vehicle.vehicleLight, lights: [], fixed: { vertices: [], meshes: {}, surfaces: [] } }
}
