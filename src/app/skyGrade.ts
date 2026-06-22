import * as THREE from 'three'

import { INITIAL_DAY_NIGHT_PHASE } from './dayNight'
import type { SkyLookId } from '../sim/habitatConfig'

// The colour grade of the colony "sky" over a day. The grade is a keyframed
// gradient over the raw phase (0..1) so a look could place different colours at
// dawn vs dusk if it wanted. Izma keeps it physically honest: a cylinder colony
// has no planetary limb, so there is no Earth-style warm sunset (the air reddens
// ~50× less than a real sunset — imperceptible). Its keys are neutral and
// symmetric (see IZMA_SKY_LOOK); the legacy cool look stays for other presets.
//
// Keys carry the far-side haze (fog) colour, the space-through-the-windows
// background, the visible sun's core/halo colour, how much the halo swells at
// low sun, and the tone-map exposure. Intensity of the actual lights stays on
// the getDaylight curve in main.ts; this module governs colour/mood only.
export type SkyKey = {
  at: number
  fog: number
  background: number
  sunCore: number
  sunGlow: number
  sunGlowScale: number
  exposure: number
}

export type SkyLookProfile = {
  id: SkyLookId
  // Where the cycle boots for this look (0 = midnight, 0.5 = noon).
  initialPhase: number
  // Sorted ascending by `at`, spanning [0,1); sampling wraps 1 -> 0.
  keys: SkyKey[]
}

export type SkyGrade = {
  fog: THREE.Color
  background: THREE.Color
  sunCore: THREE.Color
  sunGlow: THREE.Color
  sunGlowScale: number
  exposure: number
}

export const createSkyGrade = (): SkyGrade => ({
  fog: new THREE.Color(),
  background: new THREE.Color(),
  sunCore: new THREE.Color(),
  sunGlow: new THREE.Color(),
  sunGlowScale: 1,
  exposure: 1.25
})

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const scratchA = new THREE.Color()
const scratchB = new THREE.Color()

// Sample the grade at a phase, wrapping across the midnight seam. Writes into
// `target` (reused per frame) and returns it.
export const sampleSkyGrade = (
  phase: number,
  profile: SkyLookProfile,
  target = createSkyGrade()
): SkyGrade => {
  const keys = profile.keys
  const count = keys.length
  const p = THREE.MathUtils.euclideanModulo(phase, 1)

  let k0 = keys[count - 1]
  let k1 = keys[0]
  let t = 0

  for (let index = 0; index < count; index += 1) {
    const a = keys[index]
    const b = keys[(index + 1) % count]
    const aAt = a.at
    // Unwrap the upper bound so the final pair spans last.at -> first.at + 1.
    const bAt = b.at > a.at ? b.at : b.at + 1
    const pp = p >= aAt ? p : p + 1
    if (pp >= aAt && pp < bAt) {
      k0 = a
      k1 = b
      t = bAt > aAt ? (pp - aAt) / (bAt - aAt) : 0
      break
    }
  }

  target.fog.lerpColors(scratchA.set(k0.fog), scratchB.set(k1.fog), t)
  target.background.lerpColors(scratchA.set(k0.background), scratchB.set(k1.background), t)
  target.sunCore.lerpColors(scratchA.set(k0.sunCore), scratchB.set(k1.sunCore), t)
  target.sunGlow.lerpColors(scratchA.set(k0.sunGlow), scratchB.set(k1.sunGlow), t)
  target.sunGlowScale = lerp(k0.sunGlowScale, k1.sunGlowScale, t)
  target.exposure = lerp(k0.exposure, k1.exposure, t)
  return target
}

// The legacy cool grade: reproduces the prior blue-grey day/night look (same
// midnight/noon endpoints, symmetric dawn/dusk) so non-Izma presets are
// unchanged. Kept as a profile so every preset flows through one code path.
export const DEFAULT_SKY_LOOK: SkyLookProfile = {
  id: 'default',
  initialPhase: INITIAL_DAY_NIGHT_PHASE,
  keys: [
    { at: 0.0, fog: 0x1b2530, background: 0x040810, sunCore: 0xfff8f1, sunGlow: 0xffe9d6, sunGlowScale: 1, exposure: 1.25 },
    { at: 0.25, fog: 0x465868, background: 0x060d16, sunCore: 0xfff8f1, sunGlow: 0xffe9d6, sunGlowScale: 1, exposure: 1.25 },
    { at: 0.5, fog: 0x728ba0, background: 0x08131d, sunCore: 0xfff8f1, sunGlow: 0xffe9d6, sunGlowScale: 1, exposure: 1.25 },
    { at: 0.75, fog: 0x465868, background: 0x060d16, sunCore: 0xfff8f1, sunGlow: 0xffe9d6, sunGlowScale: 1, exposure: 1.25 }
  ]
}

// Izma: a physically honest interior grade. A cylinder colony has no planetary
// limb, so dusk is not an Earth sunset — the air reddens ~50× less than a real
// sunset (imperceptible). So the haze stays neutral (a faint cool cast from
// aerial perspective is all that is physical), the Sun keeps its true Sol-white
// disk with no dusk halo swell, and "dusk" is simply the bore dimming as the
// mirrors swing the beam off the floor. Symmetric: dawn and dusk read the same.
// Night keeps a deeper blue than the legacy look. Boots into the dusk sweep.
export const IZMA_SKY_LOOK: SkyLookProfile = {
  id: 'izma',
  initialPhase: 0.84,
  keys: [
    { at: 0.0, fog: 0x0c1622, background: 0x02060d, sunCore: 0xfff6ee, sunGlow: 0xffeede, sunGlowScale: 1.0, exposure: 1.2 },
    { at: 0.25, fog: 0x46586a, background: 0x070d16, sunCore: 0xfff6ee, sunGlow: 0xffeede, sunGlowScale: 1.0, exposure: 1.2 },
    { at: 0.5, fog: 0x8fa9bf, background: 0x0a1622, sunCore: 0xfff6ee, sunGlow: 0xffeede, sunGlowScale: 1.0, exposure: 1.2 },
    { at: 0.75, fog: 0x46586a, background: 0x070d16, sunCore: 0xfff6ee, sunGlow: 0xffeede, sunGlowScale: 1.0, exposure: 1.2 }
  ]
}

const SKY_LOOKS: Record<SkyLookId, SkyLookProfile> = {
  default: DEFAULT_SKY_LOOK,
  izma: IZMA_SKY_LOOK,
  // Elysium keeps the cool look until its own ring grade is authored.
  elysium: DEFAULT_SKY_LOOK
}

export const getSkyLook = (id: SkyLookId): SkyLookProfile =>
  SKY_LOOKS[id] ?? DEFAULT_SKY_LOOK

export const getInitialDayNightPhase = (id: SkyLookId): number =>
  getSkyLook(id).initialPhase
