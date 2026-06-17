import {
  FULL_360_TOPOLOGY,
  type HabitatTopology,
  type HabitatType
} from '../sim/habitatConfig'
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
  // Habitable-wall layout. Omitted = the default three-strip Island Three
  // topology. A full-circle arc makes the entire inner wall habitable with
  // no windows (Cooper Station).
  topology?: HabitatTopology
  sourceQuality: 'verified' | 'official-uc-generic' | 'derived'
  notes: string[]
}

export const HABITAT_PRESETS: Preset[] = [
  {
    id: 'playground',
    name: 'Playground Colony',
    type: 'cylinder',
    real: {
      radius_m: 18,
      diameter_m: 36,
      length_m: 120,
      rpm: 5,
      omega_rad_s: periodToOmega(12)
    },
    sim: {
      scale: 1,
      notes: 'Default close-range playground scale with 1:1 real-to-sim mapping.'
    },
    flavor: {
      skybox: 'default',
      runwayStyle: 'default'
    },
    sourceQuality: 'derived',
    notes: [
      'Matches the original playground defaults shipped with the prototype.',
      'Kept as a preset because the small-radius feel is useful for iteration and comparison.'
    ]
  },
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
    // The whole inner wall is habitable land — no longitudinal windows. Light
    // is meant to enter axially through the end caps (a follow-up); for now
    // this just yields the continuous full-circumference city and shell.
    topology: FULL_360_TOPOLOGY,
    sourceQuality: 'derived',
    notes: [
      'Representative O’Neill cylinder dimensions are used because the film does not publish a strict canonical size.',
      'Length uses the 20mi class cylinder reference.',
      'Full-360 habitable wall (no window strips); axial end-cap daylighting is a follow-up.'
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
