import * as THREE from 'three'

type CylinderSurfaceRepeat = {
  circumferential: number
  axial: number
}

const minorGridDivisions = 8
const majorGridStep = 4

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

  context.fillStyle = '#2f343a'
  context.fillRect(0, 0, size, size)

  const tileSize = size / minorGridDivisions

  for (let column = 0; column <= minorGridDivisions; column += 1) {
    const x = Math.round(column * tileSize) + 0.5
    const major = column % majorGridStep === 0
    context.strokeStyle = major ? 'rgba(205, 212, 220, 0.22)' : 'rgba(185, 195, 205, 0.10)'
    context.lineWidth = major ? 2 : 1
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, size)
    context.stroke()
  }

  for (let row = 0; row <= minorGridDivisions; row += 1) {
    const y = Math.round(row * tileSize) + 0.5
    const major = row % majorGridStep === 0
    context.strokeStyle = major ? 'rgba(205, 212, 220, 0.22)' : 'rgba(185, 195, 205, 0.10)'
    context.lineWidth = major ? 2 : 1
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(size, y)
    context.stroke()
  }

  for (let row = 0; row < minorGridDivisions; row += 1) {
    for (let column = 0; column < minorGridDivisions; column += 1) {
      const x = column * tileSize
      const y = row * tileSize
      const inset = tileSize * 0.16
      const tint = (row + column) % 2 === 0 ? 0.05 : 0.1
      context.fillStyle = `rgba(228, 232, 236, ${tint})`
      context.fillRect(
        x + inset,
        y + inset,
        tileSize - inset * 2,
        tileSize - inset * 2
      )

      if ((row + column) % majorGridStep === 0) {
        context.strokeStyle = 'rgba(214, 182, 89, 0.28)'
        context.lineWidth = 1.5
        context.strokeRect(
          x + tileSize * 0.28,
          y + tileSize * 0.28,
          tileSize * 0.44,
          tileSize * 0.44
        )
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // The floor/wall grid is viewed at a grazing angle far away (right under the
  // roads), so it shimmers at low anisotropy. Request the hardware max.
  texture.anisotropy = 16
  return texture
}
