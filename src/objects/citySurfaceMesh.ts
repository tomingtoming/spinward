/** Triangle soup in unrolled metres: tangent offset, axial offset, absolute
 * height above the hull. Shared by rendering, grounding and streamed Rapier. */
export type CitySurfaceMesh = readonly number[]

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
