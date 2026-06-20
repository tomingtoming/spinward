import * as THREE from 'three'

type CylinderSurfaceRepeat = {
  circumferential: number
  axial: number
}

export const getCylinderSurfaceRepeat = (
  radius: number,
  length: number,
  circumferentialTileMeters = 12,
  axialTileMeters = 12
): CylinderSurfaceRepeat => ({
  circumferential: Math.max(
    1,
    (Math.PI * 2 * Math.max(radius, 1)) / circumferentialTileMeters
  ),
  axial: Math.max(1, Math.max(length, 1) / axialTileMeters)
})

export const createCylinderSurfaceTexture = (size = 512) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for cylinder surface texture')
  }

  // Earthy base: muted grass/soil so the colony floor reads as land, not a tech
  // deck. Roads, buildings, farms and parks are drawn on top of this.
  context.fillStyle = '#5c6a40'
  context.fillRect(0, 0, size, size)

  // Seeded organic mottling — patches of grass, soil, dry field and shrub.
  // Fine-grained so the 12 m tile does not obviously repeat across the bore.
  let seed = 0x6e7a1c3d >>> 0
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }

  const patchColors = ['#4f5d38', '#67724a', '#7a7444', '#52492f', '#6f8050', '#454f30']

  for (let patch = 0; patch < 1100; patch += 1) {
    const x = random() * size
    const y = random() * size
    const r = 3 + random() * 20
    context.globalAlpha = 0.1 + random() * 0.22
    context.fillStyle = patchColors[Math.floor(random() * patchColors.length)]
    context.beginPath()
    context.ellipse(x, y, r, r * (0.55 + random() * 0.9), random() * Math.PI, 0, Math.PI * 2)
    context.fill()
  }

  context.globalAlpha = 1

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // The floor/wall grid is viewed at a grazing angle far away (right under the
  // roads), so it shimmers at low anisotropy. Request the hardware max.
  texture.anisotropy = 16
  return texture
}

// Hexagonal honeycomb glazing for the colony end caps: a structural panel grid
// of pointy-top hex cells in a dark mullion frame, with faintly varied glass
// tints. Used as both the colour map and the emissive map so the end reads as a
// lit structural-glass bulkhead (the iconic O'Neill end mirror), not a flat disc.
export const createHoneycombTexture = (size = 256) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the honeycomb texture')
  }

  // Dark mullion frame behind the cells.
  context.fillStyle = '#1c2530'
  context.fillRect(0, 0, size, size)

  let seed = 0x9b4d2f7a >>> 0
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }

  const hexRadius = size / 9
  const hexHeight = Math.sqrt(3) * hexRadius
  const columnStep = hexRadius * 1.5

  const drawHex = (cx: number, cy: number) => {
    context.beginPath()
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const angle = (Math.PI / 180) * (60 * vertex)
      const px = cx + hexRadius * 0.92 * Math.cos(angle)
      const py = cy + hexRadius * 0.92 * Math.sin(angle)
      if (vertex === 0) {
        context.moveTo(px, py)
      } else {
        context.lineTo(px, py)
      }
    }
    context.closePath()
  }

  context.lineWidth = Math.max(1.5, hexRadius * 0.12)
  context.strokeStyle = 'rgba(12, 18, 26, 0.95)'

  for (let column = -1; column * columnStep < size + hexRadius * 2; column += 1) {
    const cx = column * columnStep
    const offsetY = (((column % 2) + 2) % 2) * hexHeight * 0.5

    for (let row = -1; row * hexHeight + offsetY < size + hexHeight; row += 1) {
      const cy = row * hexHeight + offsetY
      // Warm-to-cool glass variation so it shimmers like real panelled glass.
      const warm = random()
      const r = Math.round(150 + warm * 70)
      const g = Math.round(140 + random() * 50)
      const b = Math.round(150 + (1 - warm) * 80)
      drawHex(cx, cy)
      context.fillStyle = `rgb(${r}, ${g}, ${b})`
      context.fill()
      context.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 16
  return texture
}
