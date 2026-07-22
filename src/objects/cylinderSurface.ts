import * as THREE from 'three'

type CylinderSurfaceRepeat = {
  circumferential: number
  axial: number
}

export type SurfaceTextureSet = {
  albedo: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
}

// 1×1 stand-ins bound to the city-shell sampler uniforms until (unless) a real
// bake arrives: transparent albedo and black emissive are exact no-ops in the
// shell shader, so the layer needs no recompile when the city appears.
export const createCityShellPlaceholderTextureSet = (): SurfaceTextureSet => {
  const { canvas: albedoCanvas } = createTextureCanvas(1)
  const { canvas: emissiveCanvas, context: emissive } = createTextureCanvas(1)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, 1, 1)

  return {
    albedo: new THREE.CanvasTexture(albedoCanvas),
    emissive: new THREE.CanvasTexture(emissiveCanvas)
  }
}

const createSeededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0

  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0xffffffff
  }
}

const createTextureCanvas = (size: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for cylinder surface texture')
  }

  return { canvas, context }
}

const finishTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = 16
  return texture
}

const drawGlowRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  alpha: number
) => {
  context.globalAlpha = alpha * 0.18
  context.fillStyle = color
  context.fillRect(x - width * 1.6, y - height * 1.6, width * 4.2, height * 4.2)
  context.globalAlpha = alpha
  context.fillRect(x, y, width, height)
  context.globalAlpha = 1
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

export const getCylinderHullRepeat = (
  radius: number,
  length: number,
  circumferentialTileMeters = 260,
  axialTileMeters = 340
): CylinderSurfaceRepeat =>
  getCylinderSurfaceRepeat(radius, length, circumferentialTileMeters, axialTileMeters)

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

export const createEndCapBulkheadTextureSet = (size = 512): SurfaceTextureSet => {
  const { canvas: albedoCanvas, context: albedo } = createTextureCanvas(size)
  const { canvas: emissiveCanvas, context: emissive } = createTextureCanvas(size)
  const random = createSeededRandom(0x5f3759df)
  const center = size * 0.5

  albedo.fillStyle = '#475766'
  albedo.fillRect(0, 0, size, size)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)

  const baseGradient = albedo.createRadialGradient(center, center, size * 0.1, center, center, size * 0.72)
  baseGradient.addColorStop(0, '#586a78')
  baseGradient.addColorStop(0.46, '#3f4d5b')
  baseGradient.addColorStop(1, '#26313d')
  albedo.fillStyle = baseGradient
  albedo.fillRect(0, 0, size, size)

  const drawRadialBeam = (
    angle: number,
    innerRadius: number,
    outerRadius: number,
    width: number,
    color: string,
    alpha: number
  ) => {
    albedo.save()
    albedo.translate(center, center)
    albedo.rotate(angle)
    albedo.globalAlpha = alpha
    albedo.fillStyle = color
    albedo.fillRect(innerRadius, -width * 0.5, outerRadius - innerRadius, width)
    albedo.restore()
    albedo.globalAlpha = 1
  }

  for (let sector = 0; sector < 36; sector += 1) {
    const angle = (sector / 36) * Math.PI * 2
    const outerRadius = size * 0.53
    const innerRadius = sector % 3 === 0 ? size * 0.11 : size * 0.22

    drawRadialBeam(
      angle,
      innerRadius,
      outerRadius,
      sector % 6 === 0 ? size * 0.012 : size * 0.005,
      sector % 6 === 0 ? '#6f7e8b' : '#202a35',
      sector % 6 === 0 ? 0.36 : 0.32
    )
  }

  for (const radius of [0.16, 0.25, 0.36, 0.49]) {
    albedo.beginPath()
    albedo.arc(center, center, size * radius, 0, Math.PI * 2)
    albedo.lineWidth = radius === 0.25 ? 6 : 3
    albedo.strokeStyle = radius === 0.25 ? 'rgba(150, 168, 180, 0.38)' : 'rgba(16, 24, 32, 0.46)'
    albedo.stroke()
  }

  for (let hatch = 0; hatch < 96; hatch += 1) {
    const angle = random() * Math.PI * 2
    const radius = size * (0.18 + random() * 0.34)
    const x = center + Math.cos(angle) * radius
    const y = center + Math.sin(angle) * radius
    const width = size * (0.018 + random() * 0.034)
    const height = size * (0.01 + random() * 0.025)

    albedo.save()
    albedo.translate(x, y)
    albedo.rotate(angle + Math.PI * 0.5)
    albedo.globalAlpha = 0.52
    albedo.fillStyle = random() < 0.62 ? '#303d48' : '#65727d'
    albedo.fillRect(-width * 0.5, -height * 0.5, width, height)
    albedo.globalAlpha = 0.26
    albedo.strokeStyle = '#d4dee8'
    albedo.strokeRect(-width * 0.5, -height * 0.5, width, height)
    albedo.restore()
    albedo.globalAlpha = 1

    if (random() < 0.18) {
      drawGlowRect(
        emissive,
        x - width * 0.1,
        y - height * 0.1,
        Math.max(1.5, width * 0.18),
        Math.max(1.5, height * 0.28),
        random() < 0.7 ? '#ff372f' : '#ffe1a4',
        0.55
      )
    }
  }

  for (let speck = 0; speck < 1400; speck += 1) {
    const x = random() * size
    const y = random() * size
    const radius = Math.hypot(x - center, y - center) / size

    if (radius > 0.53) {
      continue
    }

    albedo.globalAlpha = 0.05 + random() * 0.16
    albedo.fillStyle = random() < 0.55 ? '#b8c1c9' : '#111820'
    albedo.fillRect(x, y, 1 + random() * 2.4, 1 + random() * 2.4)
  }

  albedo.globalAlpha = 1

  return {
    albedo: finishTexture(albedoCanvas),
    emissive: finishTexture(emissiveCanvas)
  }
}

export const createExteriorHullTextureSet = (size = 512): SurfaceTextureSet => {
  const { canvas: albedoCanvas, context: albedo } = createTextureCanvas(size)
  const { canvas: emissiveCanvas, context: emissive } = createTextureCanvas(size)
  const random = createSeededRandom(0xa17c03b5)
  const panelW = size / 8
  const panelH = size / 6

  albedo.fillStyle = '#28323d'
  albedo.fillRect(0, 0, size, size)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)

  const wash = albedo.createLinearGradient(0, 0, size, size)
  wash.addColorStop(0, 'rgba(170, 188, 200, 0.14)')
  wash.addColorStop(0.55, 'rgba(40, 50, 62, 0.02)')
  wash.addColorStop(1, 'rgba(0, 10, 24, 0.24)')
  albedo.fillStyle = wash
  albedo.fillRect(0, 0, size, size)

  for (let y = 0; y < size; y += panelH) {
    for (let x = 0; x < size; x += panelW) {
      const shade = random() < 0.5 ? '#2f3a45' : '#222b35'
      albedo.fillStyle = shade
      albedo.globalAlpha = 0.72
      albedo.fillRect(x + 1, y + 1, panelW - 2, panelH - 2)
      albedo.globalAlpha = 1
      albedo.strokeStyle = 'rgba(176, 196, 210, 0.14)'
      albedo.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1)

      if (random() < 0.42) {
        const radiatorX = x + panelW * (0.16 + random() * 0.5)
        const radiatorY = y + panelH * (0.2 + random() * 0.28)
        const radiatorW = panelW * (0.18 + random() * 0.24)
        const radiatorH = panelH * (0.28 + random() * 0.32)

        albedo.fillStyle = 'rgba(12, 17, 22, 0.5)'
        albedo.fillRect(radiatorX, radiatorY, radiatorW, radiatorH)
        albedo.strokeStyle = 'rgba(188, 208, 220, 0.13)'
        for (let rib = 0; rib < 5; rib += 1) {
          const ribY = radiatorY + ((rib + 1) * radiatorH) / 6
          albedo.beginPath()
          albedo.moveTo(radiatorX + radiatorW * 0.1, ribY)
          albedo.lineTo(radiatorX + radiatorW * 0.9, ribY)
          albedo.stroke()
        }
      }
    }
  }

  for (let x = 0; x <= size; x += panelW) {
    albedo.fillStyle = 'rgba(7, 11, 17, 0.42)'
    albedo.fillRect(x - 2, 0, 4, size)
    albedo.fillStyle = 'rgba(150, 176, 194, 0.16)'
    albedo.fillRect(x + 3, 0, 1, size)
  }

  for (let y = 0; y <= size; y += panelH) {
    albedo.fillStyle = 'rgba(8, 12, 18, 0.36)'
    albedo.fillRect(0, y - 1.5, size, 3)
  }

  for (let band = 0; band < 5; band += 1) {
    const y = band * (size / 5) + size * 0.035
    albedo.fillStyle = 'rgba(214, 170, 94, 0.12)'
    albedo.fillRect(0, y, size, 3)
    drawGlowRect(emissive, 0, y, size, 1.5, '#ffd28a', 0.11)
  }

  for (let light = 0; light < 120; light += 1) {
    const x = Math.floor(random() * 8) * panelW + panelW * (0.18 + random() * 0.64)
    const y = Math.floor(random() * 6) * panelH + panelH * (0.18 + random() * 0.64)
    const red = random() < 0.62

    drawGlowRect(
      emissive,
      x,
      y,
      red ? 2.2 : 3.5,
      red ? 2.2 : 1.8,
      red ? '#ff302b' : random() < 0.5 ? '#bff7ff' : '#ffd49a',
      red ? 0.72 : 0.42
    )
  }

  for (let streak = 0; streak < 360; streak += 1) {
    const x = random() * size
    const y = random() * size
    albedo.globalAlpha = 0.04 + random() * 0.12
    albedo.fillStyle = random() < 0.5 ? '#c8d2dc' : '#071018'
    albedo.fillRect(x, y, 8 + random() * 40, 1)
  }

  albedo.globalAlpha = 1

  return {
    albedo: finishTexture(albedoCanvas),
    emissive: finishTexture(emissiveCanvas)
  }
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

  // SEAMLESSLY TILEABLE flat-top hex lattice. An even column count makes the
  // horizontal offset pattern wrap at the side edges; rounding to an integer row
  // count makes it wrap top/bottom. The hex is stretched vertically by vScale (a
  // few %) to stay regular-looking against the rounded row height. Every hex is
  // also drawn shifted by ±size, so a cell crossing one edge reappears on the
  // opposite edge — the repeats join with no broken seam.
  const cols = 6
  const columnStep = size / cols
  const hexRadius = columnStep / 1.5
  const rows = Math.max(1, Math.round(size / (Math.sqrt(3) * hexRadius)))
  const hexHeight = size / rows
  const vScale = hexHeight / (Math.sqrt(3) * hexRadius)

  const traceHex = (cx: number, cy: number) => {
    context.beginPath()
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const angle = (Math.PI / 180) * (60 * vertex)
      const px = cx + hexRadius * 0.96 * Math.cos(angle)
      const py = cy + hexRadius * 0.96 * Math.sin(angle) * vScale
      if (vertex === 0) {
        context.moveTo(px, py)
      } else {
        context.lineTo(px, py)
      }
    }
    context.closePath()
  }

  const forEachHex = (visit: (cx: number, cy: number) => void) => {
    for (let column = 0; column < cols; column += 1) {
      const baseX = column * columnStep
      const offsetY = (column % 2) * hexHeight * 0.5
      for (let row = 0; row < rows; row += 1) {
        const baseY = row * hexHeight + offsetY
        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) {
            visit(baseX + dx, baseY + dy)
          }
        }
      }
    }
  }

  // Pass 1: a whisper of cool glass sheen in each cell (mostly transparent).
  context.fillStyle = 'rgba(190, 216, 242, 0.06)'
  forEachHex((cx, cy) => {
    traceHex(cx, cy)
    context.fill()
  })

  // Pass 2: the mullion frame — a thin, soft metallic edge over every cell.
  context.lineWidth = Math.max(1, hexRadius * 0.06)
  context.strokeStyle = 'rgba(122, 142, 172, 0.5)'
  forEachHex((cx, cy) => {
    traceHex(cx, cy)
    context.stroke()
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 16
  return texture
}
