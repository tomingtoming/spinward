import type { FarFieldMode } from './farFieldSettings'

export type FarFieldBuilding = {
  x: number
  width: number
  height: number
}

export type FarFieldLight = {
  x: number
  y: number
  width: number
  height: number
  tone: number
}

export type FarFieldTexturePlan = {
  size: number
  buildings: FarFieldBuilding[]
  lights: FarFieldLight[]
}

type TexturePlanOptions = {
  textureSize: 256 | 512 | 1024
  density: number
  seed: number
}

const createRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const createFarFieldTexturePlan = ({
  textureSize,
  density,
  seed
}: TexturePlanOptions): FarFieldTexturePlan => {
  const size = textureSize
  const lights: FarFieldLight[] = []
  const buildings: FarFieldBuilding[] = []
  const random = createRandom(seed)
  const skylineBase = size * 0.86
  const buildingCount = Math.max(8, Math.round(12 + density * 18))
  let cursor = 0

  for (let index = 0; index < buildingCount && cursor < size; index += 1) {
    const remaining = size - cursor
    const width = Math.min(remaining, Math.max(18, Math.round(size * (0.035 + random() * 0.08))))
    const height = Math.round(size * (0.16 + random() * 0.38))
    const building = {
      x: cursor,
      width,
      height
    }
    buildings.push(building)

    const gridStepX = 6 + Math.floor(random() * 4)
    const gridStepY = 8 + Math.floor(random() * 5)
    const litChance = clamp(density * (0.55 + random() * 0.6), 0, 1)
    const topY = skylineBase - height

    for (let x = building.x + 4; x < building.x + width - 4; x += gridStepX) {
      for (let y = skylineBase - 6; y > topY + 6; y -= gridStepY) {
        if (random() > litChance) {
          continue
        }

        lights.push({
          x,
          y,
          width: 2 + Math.floor(random() * 3),
          height: 2 + Math.floor(random() * 3),
          tone: random()
        })
      }
    }

    cursor += width - 2 + Math.round(random() * 18)
  }

  return { size, buildings, lights }
}

const fillBackground = (
  ctx: CanvasRenderingContext2D,
  size: number,
  mode: Exclude<FarFieldMode, 'auto'>
) => {
  if (mode === 'day') {
    ctx.fillStyle = '#8aa0b0'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = 'rgba(220, 233, 242, 0.25)'
    ctx.fillRect(0, 0, size, size * 0.45)
    return
  }

  ctx.fillStyle = '#030712'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(14, 25, 42, 0.72)'
  ctx.fillRect(0, 0, size, size)
}

export const renderFarFieldTexturePlan = (
  ctx: CanvasRenderingContext2D,
  plan: FarFieldTexturePlan,
  mode: Exclude<FarFieldMode, 'auto'>
) => {
  fillBackground(ctx, plan.size, mode)
  const skylineBase = plan.size * 0.86

  for (const building of plan.buildings) {
    ctx.fillStyle = mode === 'day' ? '#556270' : '#081019'
    ctx.fillRect(building.x, skylineBase - building.height, building.width, building.height)
  }

  if (mode !== 'night') {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.18)'
    ctx.fillRect(0, skylineBase, plan.size, plan.size - skylineBase)
    return
  }

  for (const light of plan.lights) {
    ctx.fillStyle =
      light.tone < 0.33
        ? '#f8fafc'
        : light.tone < 0.66
          ? '#fcd34d'
          : '#bfdbfe'
    ctx.fillRect(light.x, light.y, light.width, light.height)
  }
}
