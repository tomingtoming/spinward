import type { HabitatType } from '../sim/habitatConfig'
import { omegaToRpm, periodToOmega } from '../units/units'

export type Preset = {
  id: string
  name: string
  type: HabitatType
  real: {
    radius_m: number
    length_m?: number
    diameter_m?: number
    thickness_m?: number
    rpm?: number
    period_s?: number
    omega_rad_s?: number
  }
  sim: {
    scale: number
    notes?: string
  }
  flavor?: {
    skybox?: 'izma' | 'elysium' | 'default'
    runwayStyle?: 'izma' | 'default'
  }
  sourceQuality: 'verified' | 'official-uc-generic' | 'derived'
  notes: string[]
}

export const HABITAT_PRESETS: Preset[] = [
  {
    id: 'izma',
    name: 'Izma Colony',
    type: 'cylinder',
    real: {
      radius_m: 3200,
      diameter_m: 6400,
      length_m: 40000,
      period_s: 113.5,
      rpm: omegaToRpm(periodToOmega(113.5)),
      omega_rad_s: periodToOmega(113.5)
    },
    sim: {
      scale: 0.02,
      notes: 'Scaled down for Rapier while keeping the scene in real meters.'
    },
    flavor: {
      skybox: 'izma',
      runwayStyle: 'izma'
    },
    sourceQuality: 'official-uc-generic',
    notes: [
      'Diameter 6.4km and period 113.5s come from quoted Izma coverage.',
      'Length 40km is carried from UC-standard O’Neill class colonies until a stricter Izma source appears.'
    ]
  },
  {
    id: 'cooper',
    name: 'Cooper Station',
    type: 'cylinder',
    real: {
      radius_m: 3200,
      diameter_m: 6400,
      length_m: 32000,
      rpm: 0.5,
      period_s: 120,
      omega_rad_s: periodToOmega(120)
    },
    sim: {
      scale: 0.02,
      notes: 'Representative O’Neill cylinder sizing for a Cooper-like experience.'
    },
    sourceQuality: 'derived',
    notes: [
      'Representative O’Neill cylinder dimensions are used because the film does not publish a strict canonical size.',
      'Length uses the 20mi class cylinder reference.'
    ]
  },
  {
    id: 'elysium',
    name: 'Elysium',
    type: 'ring',
    real: {
      radius_m: 30000,
      diameter_m: 60000,
      thickness_m: 2000,
      period_s: 348,
      rpm: omegaToRpm(periodToOmega(348)),
      omega_rad_s: 0.01808
    },
    sim: {
      scale: 0.005,
      notes: 'Very small Rapier scale because the canonical ring is much larger.'
    },
    flavor: {
      skybox: 'elysium',
      runwayStyle: 'default'
    },
    sourceQuality: 'verified',
    notes: [
      'Production crew references cite a 60km diameter and 2km thickness.',
      'Current playground approximates the ring as a short axial band for the existing cylinder traversal model.'
    ]
  }
]
