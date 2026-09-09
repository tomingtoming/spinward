import type { CityBuilding } from './cityLayout'

// Visual uses for opaque exterior shells; enterable buildings have their own
// authored entrances and never pass through this layer.
export const FRONTAGES = {
  shop: { height: 3.8, bayWidth: 6, glow: 1.5 },
  lobby: { height: 4.6, bayWidth: 12, glow: 0.8 },
  residential: { height: 3.2, bayWidth: 8, glow: 0.45 },
  workshop: { height: 4, bayWidth: 10, glow: 0.3 }
} as const
export const FRONTAGE_TEXTURE_BAYS = 4
export type FrontageKind = keyof typeof FRONTAGES
export const FRONTAGE_KINDS = Object.keys(FRONTAGES) as FrontageKind[]

export function frontageKind(building: CityBuilding): FrontageKind {
  if (building.industrial) return 'workshop'
  // Stable per lot: changing LOD or iteration order must not change its use.
  const hash = Math.imul(Math.round(building.azimuth * 100000), 73856093)
    ^ Math.imul(Math.round(building.axial * 10), 19349663)
  const choice = (hash >>> 0) % 100
  if ((building.oldTown ?? 0) > 0.5) return choice < 70 ? 'shop' : 'residential'
  if (building.kind === 'tower' || building.kind === 'setback') return choice < 75 ? 'lobby' : 'shop'
  if ((building.urban ?? 0) > 0.75) return choice < 40 ? 'lobby' : choice < 75 ? 'shop' : 'residential'
  return choice < 60 ? 'residential' : choice < 92 ? 'shop' : 'workshop'
}

export function frontageLayout(building: CityBuilding, kind = frontageKind(building)) {
  const spec = FRONTAGES[kind]
  return {
    height: Math.min(spec.height, building.height),
    // Independently fit whole bays to the two wall lengths. An elongated lot
    // must not squash eight doors into its narrow end or stretch them across
    // its long side. Keep the vertical repeat at exactly one floor.
    widthBays: Math.max(1, Math.round((building.width + 0.3) / spec.bayWidth)),
    depthBays: Math.max(1, Math.round((building.depth + 0.3) / spec.bayWidth))
  }
}

// One complete architectural bay. Large openings, opaque wall and joinery
// carry the identity at walking distance; no text or high-frequency noise.
export function paintFrontage(albedo: CanvasRenderingContext2D, emissive: CanvasRenderingContext2D, kind: FrontageKind, variant = 0) {
  const size = 256
  const rect = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color
    ctx.fillRect(x * size, y * size, w * size, h * size)
  }
  const wall = kind === 'shop' ? '#a69580' : kind === 'lobby' ? '#949c9c' : kind === 'residential' ? '#b3a592' : '#8d9290'
  rect(albedo, wall, 0, 0, 1, 1)
  rect(emissive, '#000000', 0, 0, 1, 1)
  rect(albedo, '#686a65', 0, 0.91, 1, 0.09)
  rect(albedo, '#c2beb0', 0, 0, 1, 0.035)
  const pane = (x: number, y: number, w: number, h: number, warm = false) => {
    rect(albedo, '#303d42', x - 0.013, y - 0.018, w + 0.026, h + 0.036)
    const gradient = albedo.createLinearGradient(0, y * size, 0, (y + h) * size)
    gradient.addColorStop(0, warm ? '#70756d' : '#607d87')
    gradient.addColorStop(0.6, warm ? '#444b46' : '#3a505d')
    gradient.addColorStop(1, '#283537')
    albedo.fillStyle = gradient
    albedo.fillRect(x * size, y * size, w * size, h * size)
    rect(emissive, warm ? '#977653' : '#4a646d', x, y, w, h)
    // Interior silhouettes mask the emissive map as well as the daylight map.
    rect(albedo, '#293537', x, y + h * 0.72, w, 0.025)
    rect(emissive, '#101617', x, y + h * 0.72, w, 0.025)
  }
  if (kind === 'shop') {
    pane(0.08, 0.34, 0.52, 0.49, true)
    pane(0.68, 0.32, 0.23, 0.59, true)
    if (variant % 2 === 1) {
      rect(albedo, '#918573', 0.33, 0.34, 0.025, 0.49)
      rect(emissive, '#171e19', 0.33, 0.34, 0.025, 0.49)
    }
    rect(albedo, ['#52654f', '#765247', '#526570', '#8b7755'][variant], 0.035, 0.19, 0.93, 0.13)
    rect(albedo, '#303a36', 0.035, 0.3, 0.93, 0.04)
    rect(albedo, '#ddd0ad', 0.24, 0.085, 0.38, 0.075)
    rect(emissive, '#887151', 0.24, 0.085, 0.38, 0.075)
    rect(albedo, '#b0a990', 0.68, 0.65, 0.02, 0.12)
    // Display shelf, smaller products and a timber kick panel.
    rect(albedo, '#967c59', 0.08, 0.79, 0.52, 0.09)
    for (let i = 0; i < 4; i++) {
      rect(albedo, i % 2 ? '#b6a789' : '#728877', 0.12 + i * 0.11, 0.67, 0.065, 0.105)
      rect(emissive, '#201d17', 0.12 + i * 0.11, 0.67, 0.065, 0.105)
    }
  } else if (kind === 'lobby') {
    // Broad glazing, stone piers and a narrow pair of doors, with no awning
    // or shop sign. The transom gives the lobby its taller proportion.
    pane(0.12, 0.17, 0.76, 0.69)
    for (const x of [0.34, 0.5, 0.66]) {
      rect(albedo, '#a3aba7', x, 0.17, 0.013, 0.69)
      rect(emissive, '#151b1c', x, 0.17, 0.013, 0.69)
    }
    rect(albedo, '#a3aba7', 0.12, 0.36, 0.76, 0.016)
    rect(emissive, '#151b1c', 0.12, 0.36, 0.76, 0.016)
    rect(albedo, '#c7c6b8', 0.472, 0.61, 0.006, 0.12)
    rect(albedo, '#c7c6b8', 0.533, 0.61, 0.006, 0.12)
    // A restrained glint keeps the actual door pair readable after dusk.
    rect(emissive, '#b0a386', 0.472, 0.61, 0.006, 0.12)
    rect(emissive, '#b0a386', 0.533, 0.61, 0.006, 0.12)
    if (variant % 2 === 1) {
      for (const x of [0.12, 0.675]) {
        rect(albedo, '#8d9c9c', x, 0.6, 0.205, 0.15)
        rect(emissive, '#314043', x, 0.6, 0.205, 0.15)
      }
    }
    for (const x of [0.055, 0.925]) rect(albedo, '#666f70', x, 0.07, 0.018, 0.84)
  } else if (kind === 'residential') {
    // Solid masonry around one timber door and high, private windows.
    rect(albedo, '#695546', 0.42, 0.29, 0.18, 0.62)
    rect(albedo, '#3a3b36', 0.438, 0.34, 0.145, 0.16)
    rect(emissive, '#62503b', 0.438, 0.34, 0.145, 0.16)
    pane(0.075, 0.28, 0.24, 0.32, true)
    pane(0.71, 0.28, 0.21, 0.32, true)
    for (const x of [0.075, 0.71]) rect(albedo, '#d1c5ae', x - 0.02, 0.61, 0.27, 0.035)
    rect(albedo, '#706455', 0.38, 0.235, 0.26, 0.04)
    rect(albedo, '#b8ab84', 0.56, 0.66, 0.014, 0.055)
    rect(albedo, '#52605b', 0.645, 0.61, 0.035, 0.12)
    // Courses are subtle and broad enough to survive mipmaps.
    for (const y of [0.14, 0.72, 0.88]) rect(albedo, '#a19481', 0.02, y, 0.31, 0.008)
  } else {
    // A closed roller door and separate pedestrian entrance. These are
    // opaque working buildings, so most of the ground floor stays dark.
    rect(albedo, '#657576', 0.08, 0.29, 0.58, 0.62)
    for (let i = 0; i < 11; i++) rect(albedo, '#4e5d60', 0.08, 0.31 + i * 0.053, 0.58, 0.009)
    pane(0.08, 0.13, 0.58, 0.095)
    rect(albedo, '#485854', 0.75, 0.34, 0.16, 0.57)
    pane(0.775, 0.4, 0.11, 0.14)
    rect(albedo, '#b4a886', 0.85, 0.67, 0.012, 0.07)
    rect(albedo, '#b3aa8d', 0.055, 0.245, 0.64, 0.03)
  }
}
