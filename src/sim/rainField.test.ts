import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  CLOUD_DECK_RADIUS_FRACTION,
  RAIN_TERMINAL_SPEED_1G,
  createRainSample,
  getRainDriftSpeed,
  getRainFallSpeed,
  sampleRainField
} from './rainField'

// Izma at 1 g: R = 3200 m → ω = √(9.81/3200).
const IZMA_RADIUS = 3200
const IZMA_OMEGA = Math.sqrt(9.81 / IZMA_RADIUS)

describe('rain fall speed', () => {
  test('reaches the 1g terminal speed at the floor of a 1g habitat', () => {
    expect(getRainFallSpeed(IZMA_OMEGA, IZMA_RADIUS)).toBeCloseTo(
      RAIN_TERMINAL_SPEED_1G,
      5
    )
  })

  test('slows with altitude as √g — half radius is √½ of the floor speed', () => {
    const floor = getRainFallSpeed(IZMA_OMEGA, IZMA_RADIUS)
    const half = getRainFallSpeed(IZMA_OMEGA, IZMA_RADIUS / 2)
    expect(half / floor).toBeCloseTo(Math.SQRT1_2, 5)
  })

  test('vanishes on the axis and at zero spin', () => {
    expect(getRainFallSpeed(IZMA_OMEGA, 0)).toBe(0)
    expect(getRainFallSpeed(0, IZMA_RADIUS)).toBe(0)
  })
})

describe('rain drift', () => {
  test('matches the Coriolis/drag balance 2·v_t²/(ω·r) on Izma', () => {
    const fall = getRainFallSpeed(IZMA_OMEGA, IZMA_RADIUS)
    const expected = (2 * fall * fall) / (IZMA_OMEGA * IZMA_RADIUS)
    expect(getRainDriftSpeed(IZMA_OMEGA, IZMA_RADIUS)).toBeCloseTo(expected, 5)
    // Sanity: on a km-scale habitat the slant is subtle (well under the fall).
    expect(expected).toBeLessThan(fall * 0.2)
  })

  test('is capped on a small fast habitat instead of flying sideways', () => {
    // Playground: R = 18 m at 5 rpm.
    const omega = (5 * Math.PI * 2) / 60
    const fall = getRainFallSpeed(omega, 18)
    const uncapped = (2 * fall * fall) / (omega * 18)
    expect(uncapped).toBeGreaterThan(fall * 0.6)
    expect(getRainDriftSpeed(omega, 18)).toBeCloseTo(fall * 0.6, 5)
  })
})

describe('sampleRainField', () => {
  test('points down (radially outward) with an antispinward lean', () => {
    const sample = createRainSample()
    // Stand at +X on the floor: down = +X, spinward = (z,0,-x)/r = -Z.
    sampleRainField(
      new THREE.Vector3(IZMA_RADIUS, 0, 0),
      IZMA_OMEGA,
      IZMA_RADIUS,
      sample
    )
    expect(sample.strength).toBe(1)
    expect(sample.velocity.x).toBeCloseTo(sample.fallSpeed, 5)
    // Antispinward at +X is +Z.
    expect(sample.velocity.z).toBeCloseTo(sample.driftSpeed, 5)
    expect(sample.velocity.z).toBeGreaterThan(0)
    expect(sample.velocity.y).toBe(0)
  })

  test('is dry above the cloud deck and full below the fade band', () => {
    const sample = createRainSample()
    const deck = IZMA_RADIUS * CLOUD_DECK_RADIUS_FRACTION

    sampleRainField(
      new THREE.Vector3(deck * 0.9, 0, 0),
      IZMA_OMEGA,
      IZMA_RADIUS,
      sample
    )
    expect(sample.strength).toBe(0)
    expect(sample.velocity.length()).toBe(0)

    sampleRainField(
      new THREE.Vector3(IZMA_RADIUS * 0.6, 0, 0),
      IZMA_OMEGA,
      IZMA_RADIUS,
      sample
    )
    expect(sample.strength).toBe(1)
  })

  test('fades smoothly across the band under the deck', () => {
    const sample = createRainSample()
    const deck = IZMA_RADIUS * CLOUD_DECK_RADIUS_FRACTION
    sampleRainField(
      new THREE.Vector3(deck + IZMA_RADIUS * 0.06, 0, 0),
      IZMA_OMEGA,
      IZMA_RADIUS,
      sample
    )
    expect(sample.strength).toBeGreaterThan(0)
    expect(sample.strength).toBeLessThan(1)
  })

  test('a stopped habitat has no rain', () => {
    const sample = createRainSample()
    sampleRainField(new THREE.Vector3(IZMA_RADIUS, 0, 0), 0, IZMA_RADIUS, sample)
    expect(sample.strength).toBe(0)
  })
})

describe('rain on an open ring (thin air shell, vacuum bore)', () => {
  // Elysium: R = 30 km, air only in the floor shell (depth = 2 km).
  const RING_RADIUS = 30000
  const RING_AIR_DEPTH = 2000
  const RING_OMEGA = (Math.PI * 2) / 348

  test('the vacuum bore is bone dry', () => {
    const sample = createRainSample()
    // Mid-bore: far inside the old 0.35 R cloud deck, but there is no air here.
    sampleRainField(
      new THREE.Vector3(RING_RADIUS * 0.5, 0, 0),
      RING_OMEGA,
      RING_RADIUS,
      sample,
      RING_AIR_DEPTH
    )
    expect(sample.strength).toBe(0)
    expect(sample.velocity.length()).toBe(0)
  })

  test('it still rains inside the shell, under a deck near the top of the air', () => {
    const sample = createRainSample()
    sampleRainField(
      new THREE.Vector3(RING_RADIUS - 200, 0, 0),
      RING_OMEGA,
      RING_RADIUS,
      sample,
      RING_AIR_DEPTH
    )
    expect(sample.strength).toBe(1)

    // Just above the shell's cloud deck (top of the air): dry again.
    sampleRainField(
      new THREE.Vector3(RING_RADIUS - RING_AIR_DEPTH * 0.95, 0, 0),
      RING_OMEGA,
      RING_RADIUS,
      sample,
      RING_AIR_DEPTH
    )
    expect(sample.strength).toBe(0)
  })

  test('a full-bore cylinder is unchanged by the default depth', () => {
    const explicit = createRainSample()
    const defaulted = createRainSample()
    const position = new THREE.Vector3(IZMA_RADIUS * 0.6, 0, 0)
    sampleRainField(position, IZMA_OMEGA, IZMA_RADIUS, explicit, IZMA_RADIUS)
    sampleRainField(position, IZMA_OMEGA, IZMA_RADIUS, defaulted)
    expect(explicit.strength).toBe(defaulted.strength)
    expect(explicit.velocity.toArray()).toEqual(defaulted.velocity.toArray())
  })
})
