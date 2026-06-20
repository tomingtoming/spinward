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

// Hexagonal structural glazing for the colony's longitudinal WINDOW strips (the
// real O'Neill windows you look through to the mirrors/space — not the end caps).
// The hex CELLS are near-transparent so the mirror sky shows through; only the
// MULLIONS are a semi-opaque metallic frame. Used as the map on the window glass.
export const createWindowGlassTexture = (size = 256) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the window glass texture')
  }

  // Transparent base: the sky/mirror behind the glass shows through the cells.
  context.clearRect(0, 0, size, size)

  const hexRadius = size / 4.2 // a few big structural panels per tile
  const hexHeight = Math.sqrt(3) * hexRadius
  const columnStep = hexRadius * 1.5

  const tracePointyHex = (cx: number, cy: number) => {
    context.beginPath()
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const angle = (Math.PI / 180) * (60 * vertex)
      const px = cx + hexRadius * 0.94 * Math.cos(angle)
      const py = cy + hexRadius * 0.94 * Math.sin(angle)
      if (vertex === 0) {
        context.moveTo(px, py)
      } else {
        context.lineTo(px, py)
      }
    }
    context.closePath()
  }

  const forEachHex = (visit: (cx: number, cy: number) => void) => {
    for (let column = -1; column * columnStep < size + hexRadius * 2; column += 1) {
      const cx = column * columnStep
      const offsetY = (((column % 2) + 2) % 2) * hexHeight * 0.5
      for (let row = -1; row * hexHeight + offsetY < size + hexHeight; row += 1) {
        visit(cx, row * hexHeight + offsetY)
      }
    }
  }

  // Pass 1: a faint cool glass sheen in each cell (mostly transparent).
  context.fillStyle = 'rgba(190, 216, 242, 0.1)'
  forEachHex((cx, cy) => {
    tracePointyHex(cx, cy)
    context.fill()
  })

  // Pass 2: the mullion frame — a semi-opaque metallic edge over every cell.
  context.lineWidth = Math.max(2, hexRadius * 0.09)
  context.strokeStyle = 'rgba(96, 116, 146, 0.85)'
  forEachHex((cx, cy) => {
    tracePointyHex(cx, cy)
    context.stroke()
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 16
  return texture
}
