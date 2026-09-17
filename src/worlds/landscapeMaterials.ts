import * as THREE from 'three'
import type { LandscapeMaterial } from './landscapeData'

/** Small repeating material samples, generated once per district. No images
 * from the references are shipped. UVs describe metres in the authored mesh. */
export function landscapeTexture(surface: NonNullable<LandscapeMaterial['surface']>) {
  const size = 128, pixels = new Uint8Array(size * size * 4)
  let seed = 419
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = random() - .5
    const stain = Math.sin(x * Math.PI / 32) * Math.cos(y * Math.PI / 64)
    let value = .94 + grain * .045 + stain * .015
    if (surface === 'asphalt') value = .89 + grain * .11
    if (surface === 'grass') value = .88 + grain * .11 + stain * .035
    if (surface === 'wood') value = .87 + Math.sin(x * .65 + Math.sin(y * .05)) * .035 + grain * .04
    if (surface === 'curtain') value = .78 + Math.sin(x * Math.PI / 8) * .11 + grain * .018
    if (surface === 'blinds') value = y % 12 < 2 ? .66 : .88
    if (surface === 'water') value = .87 + Math.sin(y * .3 + Math.sin(x * .098)) * .035 + grain * .018
    if (['stone', 'brick', 'paving', 'roof'].includes(surface)) {
      const row = surface === 'brick' ? 16 : surface === 'roof' ? 16 : 32
      const col = surface === 'brick' ? 32 : surface === 'roof' ? 8 : 64
      const offset = Math.floor(y / row) % 2 * col / 2
      const seam = y % row < 1 || (x + offset) % col < 1
      value = seam ? .68 : .9 + grain * .05 + Math.sin(Math.floor((x + offset) / col) * 31 + Math.floor(y / row) * 17) * .035
    }
    const i = (y * size + x) * 4, c = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255)
    pixels[i] = pixels[i + 1] = pixels[i + 2] = c; pixels[i + 3] = 255
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true; texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4; texture.needsUpdate = true
  return texture
}

/** Project each triangle onto its dominant plane before wrapping the colony.
 * This preserves material scale on façades, bridge faces and hillside paving. */
export function landscapeUVs(positions: number[], surface: NonNullable<LandscapeMaterial['surface']>) {
  const uv = new Float32Array(positions.length / 3 * 2)
  const scale = surface === 'asphalt' ? 1.2 : surface === 'plaster' ? 1.5 : surface === 'curtain' || surface === 'blinds' ? 1.2
    : surface === 'brick' || surface === 'roof' || surface === 'wood' ? 2 : surface === 'stone' ? 4 : surface === 'paving' ? 2.4 : 6
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2]
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2]
    const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx)
    for (let j = 0; j < 3; j++) {
      const p = i + j * 3, t = p / 3 * 2
      uv[t] = positions[p + (nz >= nx && nz >= ny ? 0 : nx >= ny ? 1 : 0)] / scale
      uv[t + 1] = positions[p + (nz >= nx && nz >= ny ? 1 : 2)] / scale
    }
  }
  return uv
}
