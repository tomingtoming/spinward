import * as THREE from 'three'
import type { RoadSurface } from './roadNetwork'

export const ROAD_SURFACE_LIFT_METERS = 0.2
export const ROAD_SURFACE_MAX_SAGITTA_METERS = 0.02

// Write one batch directly rather than creating and merging tens of thousands
// of tiny CylinderGeometry objects. All arms and junctions share one elevation.
export const buildRoadSurfaceGeometry = (surfaces: RoadSurface[], radius: number, texturePeriod: number) => {
  if (!surfaces.length) return null
  const maxArc = Math.sqrt(8 * ROAD_SURFACE_MAX_SAGITTA_METERS / radius)
  const counts = surfaces.map(s => Math.max(1, Math.min(720, Math.ceil(s.tangentWidth / radius / maxArc))))
  const vertexCount = counts.reduce((sum, n) => sum + 2 * (n + 1), 0)
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3)
  const uv = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(counts.reduce((sum, n) => sum + n * 6, 0))
  let cursor = 0, indexCursor = 0
  surfaces.forEach((s, i) => {
    const count = counts[i], base = cursor, source = s.sourceRoad
    for (let j = 0; j <= count; j++) {
      const angle = s.azimuth + (j / count - 0.5) * s.tangentWidth / radius
      const cos = Math.cos(angle), sin = Math.sin(angle)
      for (const side of [-1, 1]) {
        const y = s.axial + side * s.axialLength / 2
        positions.set([cos * (radius - ROAD_SURFACE_LIFT_METERS), y, sin * (radius - ROAD_SURFACE_LIFT_METERS)], cursor * 3)
        normals.set([cos, 0, sin], cursor * 3)
        const delta = Math.atan2(Math.sin(angle - source.azimuth), Math.cos(angle - source.azimuth)) * radius
        uv.set(s.axis === 'axial'
          ? [0.5 + delta / source.tangentWidth, y / texturePeriod]
          : [0.5 + (y - source.axial) / source.axialLength, angle * radius / texturePeriod], cursor * 2)
        cursor++
      }
      if (j < count) {
        const b = base + j * 2
        indices.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], indexCursor)
        indexCursor += 6
      }
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}
