import * as THREE from 'three'

import type { CityIntersection, CityRoad } from './cityLayout'
import { getArcSegments, getThetaStart } from './cityscape'
import { mergeBufferGeometries } from './cylinder'

// Sidewalks with a kerb (2026-09-03, 緻密さ②). Until now the 5 m band between
// a road and its frontage was bare ground: the block grid reserves it
// (buildings start at road edge + sidewalk) but nothing was drawn there. This
// lays a paved band on both sides of every grid road (arterial/local; alleys
// are service lanes), cut at every crossing so it never paves the cross
// street, and lifted 12 cm above the road deck so the edge reads as a kerb.
//
// Radii (larger = lower): ground R, fields R−0.1, alleys R−0.15, roads R−0.2
// (avenues a junction gap lower). Sidewalks sit at R−0.32; street-side bands
// go 1 cm higher so the corner squares, which both roads' bands cover, do
// not z-fight.

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

// Split [start, end] by the exclusion intervals (sorted by centre) into the
// runs that remain, dropping runs shorter than `minLength`.
const runsBetween = (
  start: number,
  end: number,
  exclusions: Array<{ at: number; halfWidth: number }>,
  minLength: number
) => {
  const sorted = [...exclusions].sort((a, b) => a.at - b.at)
  const runs: Array<[number, number]> = []
  let cursor = start
  for (const x of sorted) {
    const lo = x.at - x.halfWidth
    const hi = x.at + x.halfWidth
    if (hi < start || lo > end) continue
    if (lo - cursor >= minLength) runs.push([cursor, lo])
    cursor = Math.max(cursor, hi)
  }
  if (end - cursor >= minLength) runs.push([cursor, end])
  return runs
}

// Pure: the paved bands for a plan. `isOpenSquare` marks ground kept clear
// (plaza, arrival square) where no band is laid.
export const planSidewalkSegments = (
  roads: CityRoad[],
  intersections: CityIntersection[],
  radius: number,
  sidewalk: number,
  isOpenSquare: (azimuth: number, axial: number) => boolean
): SidewalkSegment[] => {
  const out: SidewalkSegment[] = []
  if (radius <= 0 || sidewalk <= 0) return out
  const minLength = sidewalk * 0.6
  for (const road of roads) {
    if (road.kind === 'alley') continue
    const isAvenue = road.axialLength > road.tangentWidth
    if (isAvenue) {
      const crossings = intersections
        .filter((x) => Math.abs(wrapToPi(x.azimuth - road.azimuth)) * radius < 0.5)
        .map((x) => ({ at: x.axial, halfWidth: x.streetWidth * 0.5 }))
      const runs = runsBetween(
        road.axial - road.axialLength * 0.5,
        road.axial + road.axialLength * 0.5,
        crossings,
        minLength
      )
      for (const [a0, a1] of runs) {
        for (const side of [-1, 1] as const) {
          const azimuth = road.azimuth + (side * (road.tangentWidth * 0.5 + sidewalk * 0.5)) / radius
          const axial = (a0 + a1) * 0.5
          if (isOpenSquare(azimuth, axial)) continue
          out.push({ azimuth, axial, tangentExtent: sidewalk, axialExtent: a1 - a0, isAvenue: true, roadSide: (-side) as 1 | -1 })
        }
      }
    } else {
      const crossings = intersections
        .filter((x) => Math.abs(x.axial - road.axial) < 0.5)
        .map((x) => ({ at: wrapToPi(x.azimuth - road.azimuth) * radius, halfWidth: x.avenueWidth * 0.5 }))
      const runs = runsBetween(-road.tangentWidth * 0.5, road.tangentWidth * 0.5, crossings, minLength)
      for (const [t0, t1] of runs) {
        for (const side of [-1, 1] as const) {
          const azimuth = road.azimuth + ((t0 + t1) * 0.5) / radius
          const axial = road.axial + side * (road.axialLength * 0.5 + sidewalk * 0.5)
          if (isOpenSquare(azimuth, axial)) continue
          out.push({ azimuth, axial, tangentExtent: t1 - t0, axialExtent: sidewalk, isAvenue: false, roadSide: (-side) as 1 | -1 })
        }
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
    this.mesh = new THREE.Mesh(merged, this.material)
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
