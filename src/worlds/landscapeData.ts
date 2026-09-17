import type { AuthoredWorldId } from './worldDefinitions'

export type LandscapeSurface = { vertices: number[]; bounds: [number, number, number, number] }
export type LandscapeSolid = { x: number; y: number; z: number; width: number; depth: number; height: number; yaw: number }
export type LandscapeMaterial = {
  surface?: 'plaster' | 'stone' | 'brick' | 'paving' | 'asphalt' | 'wood' | 'roof' | 'grass' | 'water' | 'curtain' | 'blinds'
  opacity?: number
  emission?: { color: string; intensity: number }
}
export type LandscapeLight = { position: [number, number, number]; color: string; intensity: number; distance: number }
export type LandscapeData = {
  name: string
  extent: [number, number]
  spawn: [number, number, number]
  lookAt: [number, number, number]
  palette: Record<string, string>
  materialDetails?: Record<string, LandscapeMaterial>
  lights?: LandscapeLight[]
  // Triangle positions in Blender's X=tangent, Y=axial, Z=height metres.
  lods: Record<string, number[]>[]
  surfaces: LandscapeSurface[]
  solids: LandscapeSolid[]
  routes: { name: string; points: number[][]; width: number }[]
  visits?: Record<string, { position: [number, number, number]; lookAt: [number, number, number] }>
  walks?: Record<string, [number, number, number][]>
}
export type LandscapeLibrary = Record<AuthoredWorldId, LandscapeData>

type PackedLandscape = Omit<LandscapeData, 'lods' | 'surfaces'> & {
  encoding: 'indexed-v1'; vertices: number[]
  lods: Record<string, number[]>[]
  surfaces: { indices: number[]; bounds: LandscapeSurface['bounds'] }[]
}

/** Share vertices across material batches, LODs and collision in the download.
 * Expand only the opt-in study, once, before any scene or physics is built. */
export function unpackLandscapeLibrary(source: unknown): LandscapeLibrary {
  const packed = source as Record<AuthoredWorldId, PackedLandscape>
  const decode = (id: AuthoredWorldId): LandscapeData => {
    const data = packed?.[id]
    if (data?.encoding !== 'indexed-v1' || !Array.isArray(data.vertices) || data.vertices.length % 3 ||
      !data.vertices.every(Number.isFinite) || data.lods?.length !== 3) throw Error('Invalid landscape export: ' + id)
    const expand = (indices: number[]) => {
      if (indices.length % 3) throw Error('Incomplete landscape triangle: ' + id)
      const vertices: number[] = []
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= data.vertices.length) throw Error('Landscape index out of bounds: ' + id)
        vertices.push(data.vertices[index * 3], data.vertices[index * 3 + 1], data.vertices[index * 3 + 2])
      }
      return vertices
    }
    return { ...data,
      lods: data.lods.map(l => Object.fromEntries(Object.entries(l).map(([name, indices]) => [name, expand(indices)]))),
      surfaces: data.surfaces.map(s => ({ bounds: s.bounds, vertices: expand(s.indices) }))
    }
  }
  return { izma: decode('izma'), cooper: decode('cooper'), elysium: decode('elysium') }
}
