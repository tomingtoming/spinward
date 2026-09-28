/** Triangle soup in unrolled metres: tangent offset, axial offset, absolute
 * height above the hull. Shared by rendering, grounding and streamed Rapier. */
export type CitySurfaceMesh = readonly number[] | Float64Array

/** Conservative local rectangles for the actual triangles, including vertical
 * walls. Grouping by triangle centre bounds metadata size; the rectangle still
 * encloses all three vertices even when a triangle crosses several cells. */
export function citySurfaceRegions(vertices: ArrayLike<number>, indices?: readonly number[], x = 0, y = 0) {
  const groups = new Map<string, number[]>()
  const count = indices?.length ?? vertices.length / 3
  for (let i = 0; i < count; i += 3) {
    const a = (indices?.[i] ?? i) * 3, b = (indices?.[i + 1] ?? i + 1) * 3, c = (indices?.[i + 2] ?? i + 2) * 3
    const x0 = Math.min(vertices[a], vertices[b], vertices[c]) - x
    const y0 = Math.min(vertices[a + 1], vertices[b + 1], vertices[c + 1]) - y
    const x1 = Math.max(vertices[a], vertices[b], vertices[c]) - x
    const y1 = Math.max(vertices[a + 1], vertices[b + 1], vertices[c + 1]) - y
    const key = `${Math.floor(((vertices[a] + vertices[b] + vertices[c]) / 3 - x) / 4)}:${Math.floor(((vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3 - y) / 4)}`
    const bounds = groups.get(key)
    if (bounds) {
      bounds[0] = Math.min(bounds[0], x0); bounds[1] = Math.min(bounds[1], y0)
      bounds[2] = Math.max(bounds[2], x1); bounds[3] = Math.max(bounds[3], y1)
    } else groups.set(key, [x0, y0, x1, y1])
  }
  return Float64Array.from([...groups.values()].flat())
}

type ProjectedTriangle = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number;
  area: number; toleranceU: number; toleranceV: number; toleranceW: number }
const projectedCache = new WeakMap<CitySurfaceMesh, { radius: number; triangles: ProjectedTriangle[] }>()

/** A radial ray against the same curved vertices used by drawing and Rapier.
 * Large authored terrain faces have measurable chord height; interpolating
 * their unrolled heights would put the walking surface below the visible one.
 * The mesh is immutable after export; a new mesh/radius gets a new cache. */
export function sampleProjectedCitySurface(mesh: CitySurfaceMesh, radius: number, x: number, y: number, ceiling = Infinity, minimumHeight = 0) {
  let cached = projectedCache.get(mesh)
  if (!cached || cached.radius !== radius) {
    const positions = citySurfaceVertices(mesh, radius)
    const triangles: ProjectedTriangle[] = []
    for (let i = 0; i < positions.length; i += 9) {
      const bx = positions[i + 3] - positions[i], by = positions[i + 4] - positions[i + 1], bz = positions[i + 5] - positions[i + 2]
      const cx = positions[i + 6] - positions[i], cy = positions[i + 7] - positions[i + 1], cz = positions[i + 8] - positions[i + 2]
      const area = Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx)
      // Separate body origins round the same shared edge slightly differently.
      // Bound the tolerance in metres, not a fixed barycentric fraction that
      // would grow into centimetres on a large terrain face.
      const tolerance = (length: number) => Math.max(1e-7, Math.min(.02, .002 * length / Math.max(area, 1e-12)))
      triangles.push({ ax: positions[i] + radius, ay: positions[i + 1], az: positions[i + 2], bx, by, bz, cx, cy, cz,
        area,
        toleranceU: tolerance(Math.hypot(cx, cy, cz)), toleranceV: tolerance(Math.hypot(bx, by, bz)),
        toleranceW: tolerance(Math.hypot(bx - cx, by - cy, bz - cz)) })
    }
    cached = { radius, triangles }; projectedCache.set(mesh, cached)
  }
  const dx = Math.cos(x / radius), dz = Math.sin(x / radius)
  let height = minimumHeight
  for (const t of cached.triangles) {
    // Moller-Trumbore from (0, y, 0), towards the hull. No dependence on a
    // renderer, scene matrix, reference-frame angle or source triangle normal.
    const px = -dz * t.cy, py = dz * t.cx - dx * t.cz, pz = dx * t.cy
    const det = t.bx * px + t.by * py + t.bz * pz
    // Curving a vertical wall gives it a tiny radial component. Reject those
    // near-parallel hits; this geometry query still includes steep terrain.
    // Physical standing contact applies its own, stricter normal threshold.
    if (Math.abs(det) < Math.max(1e-10, t.area * .01)) continue
    const tx = -t.ax, ty = y - t.ay, tz = -t.az
    const u = (tx * px + ty * py + tz * pz) / det
    if (u < -t.toleranceU) continue
    const qx = ty * t.bz - tz * t.by, qy = tz * t.bx - tx * t.bz, qz = tx * t.by - ty * t.bx
    const v = (dx * qx + dz * qz) / det
    if (v < -t.toleranceV || u + v > 1 + t.toleranceW) continue
    const radial = (t.cx * qx + t.cy * qy + t.cz * qz) / det
    const h = radius - radial
    if (radial > 0 && h > height && h <= ceiling) height = h
  }
  return height
}

export function sampleCitySurface(mesh: CitySurfaceMesh, x: number, y: number, ceiling = Infinity): number {
  let height = 0
  for (let i = 0; i < mesh.length; i += 9) {
    const ax = mesh[i], ay = mesh[i + 1], bx = mesh[i + 3], by = mesh[i + 4], cx = mesh[i + 6], cy = mesh[i + 7]
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(d) < 1e-10) continue // Vertical retaining faces are walls.
    const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d
    const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d
    if (a < -1e-7 || b < -1e-7 || a + b > 1 + 1e-7) continue
    const h = a * mesh[i + 2] + b * mesh[i + 5] + (1 - a - b) * mesh[i + 8]
    if (h <= ceiling && h > height) height = h
  }
  return height
}

/** Curved, body-local XYZ. Local X is outward, Y axial, Z tangent. */
export function citySurfaceVertices(mesh: CitySurfaceMesh, radius: number) {
  const out = new Float32Array(mesh.length)
  for (let i = 0; i < mesh.length; i += 3) {
    const a = mesh[i] / radius, r = radius - mesh[i + 2]
    out[i] = Math.cos(a) * r - radius
    out[i + 1] = mesh[i + 1]
    out[i + 2] = Math.sin(a) * r
  }
  return out
}
