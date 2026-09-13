type Rect = { azimuth: number; axial: number; tangentWidth: number; axialLength: number }
const TAU = Math.PI * 2

// A cylindrical spatial index: queries wrap at the seam, long arterials are
// indexed across every cell they cross, not just by their centres.
export class SurfaceIndex {
  private readonly cells = new Map<string, number[]>()
  private readonly columns: number
  private readonly pitch: number
  constructor(private readonly radius: number) {
    this.columns = Math.max(1, Math.ceil(TAU * radius / 128))
    this.pitch = TAU * radius / this.columns
  }
  private keys(rect: Rect) {
    const x = ((rect.azimuth % TAU) + TAU) % TAU * this.radius
    const keys = new Set<string>()
    const start = Math.floor((x - rect.tangentWidth / 2) / this.pitch)
    const end = Math.min(start + this.columns - 1, Math.floor((x + rect.tangentWidth / 2) / this.pitch))
    for (let i = start; i <= end; i++) {
      const col = ((i % this.columns) + this.columns) % this.columns
      for (let j = Math.floor((rect.axial - rect.axialLength / 2) / 128);
        j <= Math.floor((rect.axial + rect.axialLength / 2) / 128); j++) keys.add(`${col}:${j}`)
    }
    return keys
  }
  insert(rect: Rect, id: number) {
    for (const key of this.keys(rect)) {
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(id)
      else this.cells.set(key, [id])
    }
  }
  query(rect: Rect) {
    const ids = new Set<number>()
    for (const key of this.keys(rect)) for (const id of this.cells.get(key) ?? []) ids.add(id)
    return ids
  }
}

