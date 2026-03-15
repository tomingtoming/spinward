import * as THREE from 'three'

type CylinderSurfaceRepeat = {
  circumferential: number
  axial: number
}

const minorGridDivisions = 8
const majorGridStep = 4
const lightGridDivisions = 24

export type CylinderNightLight = {
  x: number
  y: number
  width: number
  height: number
  tone: number
}

export type CylinderNightLightPlan = {
  size: number
  lights: CylinderNightLight[]
}

const createRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0xffffffff
  }
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

  context.fillStyle = '#1a2634'
  context.fillRect(0, 0, size, size)

  const tileSize = size / minorGridDivisions

  for (let column = 0; column <= minorGridDivisions; column += 1) {
    const x = Math.round(column * tileSize) + 0.5
    const major = column % majorGridStep === 0
    context.strokeStyle = major ? 'rgba(180, 220, 255, 0.28)' : 'rgba(160, 200, 235, 0.12)'
    context.lineWidth = major ? 2 : 1
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, size)
    context.stroke()
  }

  for (let row = 0; row <= minorGridDivisions; row += 1) {
    const y = Math.round(row * tileSize) + 0.5
    const major = row % majorGridStep === 0
    context.strokeStyle = major ? 'rgba(180, 220, 255, 0.28)' : 'rgba(160, 200, 235, 0.12)'
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
      const tint = (row + column) % 2 === 0 ? 0.08 : 0.13
      context.fillStyle = `rgba(255, 255, 255, ${tint})`
      context.fillRect(
        x + inset,
        y + inset,
        tileSize - inset * 2,
        tileSize - inset * 2
      )

      if ((row + column) % majorGridStep === 0) {
        context.strokeStyle = 'rgba(250, 204, 21, 0.42)'
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
  texture.anisotropy = 4
  return texture
}

export const createCylinderNightLightPlan = (
  size: number,
  density: number,
  seed: number
): CylinderNightLightPlan => {
  const random = createRandom(seed)
  const lights: CylinderNightLight[] = []
  const clampedDensity = Math.min(1, Math.max(0, density))
  const cellSize = size / lightGridDivisions

  for (let row = 0; row < lightGridDivisions; row += 1) {
    for (let column = 0; column < lightGridDivisions; column += 1) {
      const edgeBias = row > lightGridDivisions * 0.7 ? 0.85 : 1
      const litChance = clampedDensity * 0.16 * edgeBias

      if (random() > litChance) {
        continue
      }

      const insetX = cellSize * (0.16 + random() * 0.18)
      const insetY = cellSize * (0.16 + random() * 0.18)
      lights.push({
        x: column * cellSize + insetX,
        y: row * cellSize + insetY,
        width: cellSize * (0.22 + random() * 0.18),
        height: cellSize * (0.14 + random() * 0.16),
        tone: random()
      })
    }
  }

  return {
    size,
    lights
  }
}

export const renderCylinderNightLightPlan = (
  context: CanvasRenderingContext2D,
  plan: CylinderNightLightPlan
) => {
  context.clearRect(0, 0, plan.size, plan.size)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, plan.size, plan.size)

  for (const light of plan.lights) {
    context.fillStyle =
      light.tone < 0.33
        ? '#f8fafc'
        : light.tone < 0.66
          ? '#fcd34d'
          : '#bfdbfe'
    context.fillRect(light.x, light.y, light.width, light.height)
  }
}
