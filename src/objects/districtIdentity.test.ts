import { expect, test } from 'bun:test'
import { districtNightGain, isDistrictPark } from './districtIdentity'

test('large parks stay away from the arrival axis and small habitats', () => {
  expect(isDistrictPark(3200, 40000, 0.46, 0.12)).toBe(true)
  expect(isDistrictPark(3200, 40000, -0.42, -0.24)).toBe(true)
  for (let axial = -1; axial <= 1; axial += 0.01) {
    expect(isDistrictPark(3200, 40000, 0, axial)).toBe(false)
  }
  expect(isDistrictPark(18, 120, 0.46, 0.12)).toBe(false)
})

test('night districts separate commercial, residential and industrial areas', () => {
  expect(districtNightGain(1)).toBeGreaterThan(districtNightGain(0.2))
  expect(districtNightGain(0.2)).toBeGreaterThan(districtNightGain(1, true))
})
