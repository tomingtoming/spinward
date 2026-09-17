import type { ColonyRailData, RailLine, RailPoint, RailStation } from '../worlds/colonyRailData'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
function preceding(values: readonly number[], value: number) {
  let lo = 0, hi = values.length - 1
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (values[mid] <= value) lo = mid; else hi = mid - 1 }
  return Math.min(lo, values.length - 2)
}
export function railPoint(line: RailLine, s: number, lateral = 0): RailPoint {
  const points = line.points
  let lo = 0, hi = points.length - 1
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (points[mid][0] <= s) lo = mid; else hi = mid - 1 }
  const a = points[Math.min(lo, points.length - 2)], b = points[Math.min(lo + 1, points.length - 1)]
  const t = clamp((s - a[0]) / (b[0] - a[0]), 0, 1), dx = b[1] - a[1], dy = b[2] - a[2], length = Math.hypot(dx, dy)
  return [a[1] + dx * t + dy / length * lateral, a[2] + dy * t - dx / length * lateral, a[3] + (b[3] - a[3]) * t]
}
type Leg = { from: RailStation; to: RailStation; direction: 1 | -1; start: number; duration: number;
  distance: number[]; speed: number[]; time: number[] }
export type RailTrain = {
  id: string; line: RailLine; s: number; lane: number; speed: number; direction: 1 | -1
  position: RailPoint; tangent: RailPoint; station: RailStation | null; next: RailStation
  departureIn: number; arrivalIn: number; doorOpen: number
}
type Timetable = { line: RailLine; legs: Leg[]; cycle: number; offset: number }

/** Fixed service routes with acceleration/braking and curve speed limits.
 * Every train continues to exist when far away; visibility never owns time. */
export class RailService {
  readonly trains: RailTrain[] = []
  readonly tables: Timetable[] = []
  time = 0
  constructor(readonly data: ColonyRailData) {
    const config = data.configuration
    for (const line of data.lines) {
      const stops = line.stations.map(id => data.stations.find(s => s.id === id)!)
      const order = [...stops, ...stops.slice(1, -1).reverse(), stops[0]], legs: Leg[] = []
      let start = 0
      for (let k = 0; k < order.length - 1; k++) {
        const from = order[k], to = order[k + 1], direction = Math.sign(to.s - from.s) as 1 | -1
        const positions = [from.s, ...line.points.map(p => p[0]).filter(s => s > Math.min(from.s, to.s) && s < Math.max(from.s, to.s)).sort((a, b) => direction * (a - b)), to.s]
        const distance = positions.map(s => Math.abs(s - from.s)), speed = positions.map(s => {
          const a = railPoint(line, s - 8), b = railPoint(line, s), c = railPoint(line, s + 8)
          const first = Math.atan2(b[0] - a[0], b[1] - a[1]), last = Math.atan2(c[0] - b[0], c[1] - b[1])
          const curvature = Math.abs(Math.atan2(Math.sin(last - first), Math.cos(last - first))) / 8
          // 1 m/s² lateral target also slows the tight transfer alignments.
          let limit = Math.min(config.maxSpeed, Math.sqrt(1 / Math.max(curvature, 1e-8)))
          if ((from === stops[0] || from === stops[stops.length - 1]) && Math.abs(s - from.s) < 160) limit = Math.min(limit, 8)
          return limit
        })
        speed[0] = 0; speed[speed.length - 1] = 0
        for (let i = 1; i < speed.length; i++) speed[i] = Math.min(speed[i], Math.sqrt(speed[i - 1] ** 2 + 2 * config.acceleration * (distance[i] - distance[i - 1])))
        for (let i = speed.length - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * config.braking * (distance[i + 1] - distance[i])))
        const time = [0]
        for (let i = 1; i < positions.length; i++) time.push(time[i - 1] + 2 * (distance[i] - distance[i - 1]) / (speed[i] + speed[i - 1]))
        const duration = config.dwellSeconds + time[time.length - 1]
        legs.push({ from, to, direction, distance, speed, time, start, duration }); start += duration
      }
      const table = { line, legs, cycle: start, offset: legs[3].start }
      this.tables.push(table)
      for (let i = 0; i < config.trainsPerLine; i++) this.trains.push(this.sample(table, i, 0))
    }
  }
  private sample(table: Timetable, trainIndex: number, clock: number): RailTrain {
    const config = this.data.configuration
    const phase = ((clock + table.offset + trainIndex * table.cycle / config.trainsPerLine) % table.cycle + table.cycle) % table.cycle
    const leg = table.legs.find(l => phase < l.start + l.duration) ?? table.legs[table.legs.length - 1]
    const local = phase - leg.start, waiting = local < config.dwellSeconds
    let travelled = 0, speed = 0
    if (!waiting) {
      const time = local - config.dwellSeconds, i = preceding(leg.time, time), t = time - leg.time[i]
      const acceleration = (leg.speed[i + 1] ** 2 - leg.speed[i] ** 2) / (2 * (leg.distance[i + 1] - leg.distance[i]))
      travelled = leg.distance[i] + leg.speed[i] * t + .5 * acceleration * t * t
      speed = Math.max(0, leg.speed[i] + acceleration * t)
    }
    const s = leg.from.s + leg.direction * travelled
    const terminal = leg.from.id === table.line.stations[0] || leg.from.id === table.line.stations[table.line.stations.length - 1]
    const laneAt = (d: number) => {
      if (!terminal) return -leg.direction * config.trackCentres
      const t = clamp(d / 150, 0, 1)
      return leg.direction * config.trackCentres * (1 - 2 * t * t * (3 - 2 * t))
    }
    const lane = laneAt(travelled), position = railPoint(table.line, s, lane)
    const a = railPoint(table.line, s - 2, laneAt(travelled - leg.direction * 2)), b = railPoint(table.line, s + 2, laneAt(travelled + leg.direction * 2))
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    return { id: `${table.line.id}:${trainIndex}`, line: table.line, s, lane, speed, direction: leg.direction, position,
      tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length],
      station: waiting ? leg.from : null, next: leg.to, departureIn: Math.max(0, config.dwellSeconds - local), arrivalIn: leg.duration - local,
      doorOpen: waiting ? clamp(Math.min(local, config.dwellSeconds - local) / 1.2, 0, 1) : 0 }
  }
  step(dt: number) {
    this.time += Math.max(0, dt)
    let index = 0
    for (const table of this.tables) for (let i = 0; i < this.data.configuration.trainsPerLine; i++) Object.assign(this.trains[index++], this.sample(table, i, this.time))
  }
  nearestBoarding(azimuth: number, axial: number, height: number, radius: number): RailTrain | null {
    if (radius !== 3200) return null
    let best: RailTrain | null = null, nearest = 1.8
    for (const train of this.trains) {
      const station = train.station
      if (!station || train.doorOpen < .95 || train.departureIn < 2 || Math.abs(height - station.platform[2]) > .2) continue
      const target = station.boarding[train.lane < 0 ? 0 : 1]
      const distance = Math.hypot(Math.atan2(Math.sin(azimuth - target[0] / radius), Math.cos(azimuth - target[0] / radius)) * radius, axial - target[1])
      if (distance < nearest) { nearest = distance; best = train }
    }
    return best
  }
}
