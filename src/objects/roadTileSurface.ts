import * as THREE from 'three'
import type { RoadTilePlacement } from './roadTiles'
import { STREET_PROFILES, streetLaneDividers } from './streetProfile'

// Code-native replacement for tiles with baked-in lane counts. Unit X/Z
// footprint and legacy Y levels let the existing curved-world placement and
// junction planner keep their transforms. All paint dimensions start in metres.
export const buildRoadTileSurface = (p: RoadTilePlacement) => {
  const positions: number[] = [], colors: number[] = []
  const rect = (x0: number, x1: number, z0: number, z1: number, y: number, color: number) => {
    if (x1 <= x0 || z1 <= z0) return
    const c = new THREE.Color(color)
    const points = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(points[i][0] / p.alongMeters, y, points[i][1] / p.crossMeters)
      colors.push(c.r, c.g, c.b)
    }
  }
  const x = p.alongMeters / 2, z = p.crossMeters / 2
  const profile = STREET_PROFILES[p.roadKind ?? 'arterial']
  const halfRoad = (p.crossCarriagewayMeters ?? profile.carriageway) / 2
  const straight = p.kind === 'straight' || p.kind === 'crossing'
  // Partition one junction footprint into disjoint cells. Asphalt and
  // sidewalks meet at shared edges; crossing arms never stack two sheets.
  const halfOther = Math.min(x, (p.alongCarriagewayMeters ?? profile.carriageway) / 2)
  const xs = straight ? [-x, x] : [-x, -halfOther, halfOther, x]
  const zs = [-z, -halfRoad, halfRoad, z]
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2
    const xArm = Math.abs(cz) < halfRoad && (p.kind !== 'bend' || cx < halfOther)
    const zArm = !straight && Math.abs(cx) < halfOther && (p.kind === 'crossroad' || cz > -halfRoad)
    rect(xs[i], xs[i + 1], zs[j], zs[j + 1], 0.021, xArm || zArm ? 0x3d4046 : 0xa4a39a)
  }
  if (!straight) {
    // Crosswalks occupy the continuation of the sidewalk on each OPEN arm.
    // Closed sides of T/bend junctions stay continuous sidewalk, not zebra.
    const paint = 0.026, white = 0xc3c6c9, inset = 0.12
    for (const side of [-1, 1]) {
      if ((p.kind !== 'bend' || side === -1) && x - halfOther > 0.5) {
        const from = side === -1 ? -x + inset : halfOther + inset
        const to = side === -1 ? -halfOther - inset : x - inset
        for (let zz = -halfRoad; zz < halfRoad; zz += 0.9)
          rect(from, to, zz, Math.min(zz + 0.45, halfRoad), paint, white)
      }
      if ((p.kind === 'crossroad' || side === 1) && z - halfRoad > 0.5) {
        const from = side === -1 ? -z + inset : halfRoad + inset
        const to = side === -1 ? -halfRoad - inset : z - inset
        for (let xx = -halfOther; xx < halfOther; xx += 0.9)
          rect(xx, Math.min(xx + 0.45, halfOther), from, to, paint, white)
      }
    }
  }
  if (straight && profile.lanesPerDirection > 0) {
    const line = 0.12, paint = 0.023
    for (const side of [-1, 1]) {
      const edge = side * (halfRoad - 0.16)
      rect(-x, x, edge - line / 2, edge + line / 2, paint, 0xa0a8c9)
    }
    if (profile.lanesPerDirection > 1) {
      rect(-x, x, -line / 2, line / 2, paint, 0xff7e44)
    }
    for (let start = -x; start < x; start += 8) {
      if (profile.lanesPerDirection === 1) rect(start, Math.min(x, start + 3), -line / 2, line / 2, paint, 0xa0a8c9)
      for (const divider of streetLaneDividers(p.roadKind ?? 'arterial')) for (const side of [-1, 1]) {
        const centre = side * divider
        rect(start, Math.min(x, start + 3), centre - line / 2, centre + line / 2, paint, 0xa0a8c9)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}
