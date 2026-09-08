import { STREET_PROFILES } from './streetProfile'

export type BlockRect = { t0: number; t1: number; a0: number; a1: number }
export type StreetRow = {
  facing: 'avenue' | 'street'; edge: number; side: 1 | -1
  start: number; end: number; depth: number
}

// Subdivide the unbuilt block with through streets FIRST. Each resulting
// cell owns four frontage rows and an optional court. No nested lane loops,
// and no connector is cut through already allocated parcels.
export const planStreetBlock = (bounds: BlockRect, residential: boolean, cell: number,
  perimeter = { t0: 8.5, t1: 8.5, a0: 8.5, a1: 8.5 }) => {
  const kind = residential ? 'alley' as const : 'local' as const
  const profile = STREET_PROFILES[kind]
  const band = profile.carriageway + 2 * profile.sidewalk
  const target = residential ? 85 : 130
  const columns = Math.max(1, Math.ceil((bounds.t1 - bounds.t0) / target))
  const rows = Math.max(1, Math.ceil((bounds.a1 - bounds.a0) / target))
  const pitchT = (bounds.t1 - bounds.t0 + band) / columns
  const pitchA = (bounds.a1 - bounds.a0 + band) / rows
  const roads: Array<BlockRect & { kind: typeof kind }> = []
  const frontages: StreetRow[] = []
  const courts: BlockRect[] = []
  // Extend into perimeter streets beyond their reserved sidewalks. Actual
  // Reach the widest perimeter road's centre, but never extend across a
  // narrower road into the neighbouring parcel.
  for (let i = 1; i < columns; i++) {
    const centre = bounds.t0 + i * pitchT - band / 2
    roads.push({ t0: centre - profile.carriageway / 2, t1: centre + profile.carriageway / 2,
      a0: bounds.a0 - perimeter.a0, a1: bounds.a1 + perimeter.a1, kind })
  }
  for (let j = 1; j < rows; j++) {
    const centre = bounds.a0 + j * pitchA - band / 2
    roads.push({ a0: centre - profile.carriageway / 2, a1: centre + profile.carriageway / 2,
      t0: bounds.t0 - perimeter.t0, t1: bounds.t1 + perimeter.t1, kind })
  }
  for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
    const t0 = bounds.t0 + i * pitchT, t1 = t0 + pitchT - band
    const a0 = bounds.a0 + j * pitchA, a1 = a0 + pitchA - band
    const coverage = residential ? 0.3 : 0.4
    const depth = Math.min(residential ? 24 : 48, cell * 0.9, (t1 - t0) * coverage, (a1 - a0) * coverage)
    if (depth <= 0) continue
    frontages.push(
      { facing: 'avenue', edge: t0, side: 1, start: a0, end: a1, depth },
      { facing: 'avenue', edge: t1, side: -1, start: a0, end: a1, depth },
      { facing: 'street', edge: a0, side: 1, start: t0 + depth + 0.2, end: t1 - depth - 0.2, depth },
      { facing: 'street', edge: a1, side: -1, start: t0 + depth + 0.2, end: t1 - depth - 0.2, depth }
    )
    courts.push({ t0: t0 + depth + 0.2, t1: t1 - depth - 0.2,
      a0: a0 + depth + 0.2, a1: a1 - depth - 0.2 })
  }
  return { roads, frontages, courts }
}
