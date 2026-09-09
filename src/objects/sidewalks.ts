import * as THREE from 'three'

import type { CityIntersection, CityRoad } from './cityLayout'
import { getArcSegments, getThetaStart } from './cityscape'
import { mergeBufferGeometries } from './cylinder'
import { SurfaceIndex } from './streetAccess'
import { getStreetProfile } from './streetProfile'
import { coalesceRoads } from './roadNetwork'
import { subtractWalkwayRect } from './streetWalkways'

// Raised concrete bands along the shared street profiles, clipped against
// every actual carriageway (including block streets and shared alleys).
// Radii: ground R, fields R−0.1, roads R−0.2, kerbs R−0.32. Tangential
// bands are 1 cm higher to resolve their shared corner with axial bands.

export const SIDEWALK_LIFT = 0.32
export const SIDEWALK_TEXTURE_METERS = 5

export type SidewalkSegment = {
  azimuth: number // band centre
  axial: number // band centre
  tangentExtent: number
  axialExtent: number
  isAvenue: boolean
  // Which way the road lies from the band (the kerb edge): −1/+1 along the
  // band's across axis (tangent for avenue bands, axial for street bands).
  roadSide: 1 | -1
}

const TWO_PI = Math.PI * 2
const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

// Use carriageways, not the signal/intersection catalogue: block-generated
// streets, offset T entries and shared alleys all interrupt the kerb even if
// there is no traffic-light node at their centre. Keep the old arguments for
// callers supplying plaza exclusions and the no-sidewalk switch.
export const planSidewalkSegments = (
  roads: CityRoad[],
  _intersections: CityIntersection[],
  radius: number,
  sidewalk: number,
  isOpenSquare: (azimuth: number, axial: number) => boolean
): SidewalkSegment[] => {
  const out: SidewalkSegment[] = []
  if (radius <= 0 || sidewalk <= 0) return out
  const index = new SurfaceIndex(radius)
  roads.forEach((road, i) => index.insert(road, i))
  for (const road of coalesceRoads(roads, radius)) {
    const width = getStreetProfile(road.kind, radius).sidewalk
    if (!width) continue
    const isAvenue = road.axialLength > road.tangentWidth
    for (const side of [-1, 1] as const) {
      const t = isAvenue ? side * (road.tangentWidth + width) / 2 : 0
      const a = isAvenue ? 0 : side * (road.axialLength + width) / 2
      const w = isAvenue ? width : road.tangentWidth
      const h = isAvenue ? road.axialLength : width
      let pieces = [{ t0: t - w / 2, t1: t + w / 2, a0: a - h / 2, a1: a + h / 2 }]
      const candidates = index.query({ azimuth: road.azimuth + t / radius,
        axial: road.axial + a, tangentWidth: w, axialLength: h })
      for (const id of candidates) {
        const other = roads[id]
        const rt = wrapToPi(other.azimuth - road.azimuth) * radius
        const ra = other.axial - road.axial
        pieces = pieces.flatMap(p => subtractWalkwayRect(p, {
          t0: rt - other.tangentWidth / 2, t1: rt + other.tangentWidth / 2,
          a0: ra - other.axialLength / 2, a1: ra + other.axialLength / 2
        }))
        if (!pieces.length) break
      }
      for (const p of pieces) {
        const azimuth = road.azimuth + (p.t0 + p.t1) / (2 * radius)
        const axial = road.axial + (p.a0 + p.a1) / 2
        if (isOpenSquare(azimuth, axial)) continue
        out.push({ azimuth, axial, tangentExtent: p.t1 - p.t0,
          axialExtent: p.a1 - p.a0, isAvenue, roadSide: -side as 1 | -1 })
      }
    }
  }
  return out
}

// Pavement: warm-grey concrete slabs with joints, a dark kerb stripe along
// the road edge (U = 0) and a faint lighter lip beside it.
export const createSidewalkTexture = (size = 256) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas context is required for the sidewalk texture')
  context.fillStyle = '#b4b7ba'
  context.fillRect(0, 0, size, size)
  // speckle
  let seed = 0x5eed
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < 900; i++) {
    const v = 150 + Math.floor(rand() * 40)
    context.fillStyle = `rgb(${v},${v + 2},${v + 5})`
    context.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 2, 2)
  }
  // joints: one across the band, four along a 5 m cycle
  context.fillStyle = '#8f9397'
  context.fillRect(Math.floor(size * 0.55), 0, 2, size)
  for (let i = 0; i < 4; i++) {
    context.fillRect(0, Math.floor((i * size) / 4), size, 2)
  }
  // kerb: dark stone at the road edge, lighter lip beside it
  context.fillStyle = '#6f7479'
  context.fillRect(0, 0, Math.floor(size * 0.07), size)
  context.fillStyle = '#c9ccd0'
  context.fillRect(Math.floor(size * 0.07), 0, 3, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

export class Sidewalks {
  readonly group = new THREE.Group()
  private mesh: THREE.Mesh | null = null
  private readonly texture = createSidewalkTexture()
  private readonly material = new THREE.MeshStandardMaterial({
    map: this.texture,
    roughness: 0.92,
    metalness: 0,
    side: THREE.BackSide
  })

  setPlan(segments: SidewalkSegment[], radius: number) {
    this.clear()
    if (segments.length === 0 || radius <= 0) return
    const geometries: THREE.BufferGeometry[] = []
    for (const s of segments) {
      const bandRadius = radius - SIDEWALK_LIFT - (s.isAvenue ? 0 : 0.01)
      const arcRadians = s.tangentExtent / radius
      const geometry = new THREE.CylinderGeometry(
        bandRadius,
        bandRadius,
        s.axialExtent,
        getArcSegments(arcRadians, radius),
        1,
        true,
        getThetaStart(s.azimuth, arcRadians),
        arcRadians
      )
      geometry.translate(0, s.axial, 0)
      // UVs: U across the band with the kerb (U=0) on the road side, V along
      // the band in 5 m cycles. CylinderGeometry gives u around the arc and v
      // along the axis; street bands run along the arc, so swap.
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
      const along = s.isAvenue ? s.axialExtent : s.tangentExtent
      const repeat = along / SIDEWALK_TEXTURE_METERS
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i)
        const v = uv.getY(i)
        // across coordinate 0..1 from the −side edge; kerb must sit at the road side
        let across = s.isAvenue ? u : v
        if (s.roadSide === 1) across = 1 - across
        const alongT = s.isAvenue ? v : u
        uv.setXY(i, across, alongT * repeat)
      }
      geometries.push(geometry)
    }
    const merged = mergeBufferGeometries(geometries)
    for (const g of geometries) g.dispose()
    if (merged === null) return
    // The merged band ring wraps the whole habitat and the camera stands
    // inside it, so frustum culling can only ever hide it wrongly — and did:
    // a stale per-band bounding sphere made the pavement vanish at some yaws
    // and viewport aspects (2026-09-03, found by measuring the same crop at
    // two window sizes). Fresh bounds AND no culling.
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    this.mesh = new THREE.Mesh(merged, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    this.group.add(this.mesh)
  }

  private clear() {
    if (this.mesh !== null) {
      this.group.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh = null
    }
  }

  dispose() {
    this.clear()
    this.material.dispose()
    this.texture.dispose()
  }
}
