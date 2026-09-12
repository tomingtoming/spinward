import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { HABITAT_PRESETS } from '../presets/presets'
import { planCity, resolveCitySurfaceCollision, getArterialRoadWidth } from './cityLayout'
import { centralPlazaArrival } from './civicArrival'
import { planCarShareBay } from './carShare'
import { CivicDetails } from './civicDetails'
import { Car } from './car'

test('city arrivals and car-share approaches are clear, with bays outside intersections at each city budget', () => {
  for (const preset of HABITAT_PRESETS) for (const maxBuildings of [64000, 18000, 16000]) {
    const radius = preset.real.radius_m
    const plan = planCity({ radius, length: preset.real.length_m ?? preset.real.thickness_m!, maxBuildings, topology: preset.topology })
    const arrival = centralPlazaArrival(radius), bay = planCarShareBay(plan, radius)
    if (radius < 800) { expect(bay).toBeNull(); continue }
    const details = new CivicDetails(new THREE.Group())
    try {
      details.rebuild({ ...plan, buildings: [] }, radius)
      expect(arrival.azimuth * radius).toBeGreaterThan(getArterialRoadWidth(radius) / 2 + 1)
      expect(arrival.axialPosition).toBeGreaterThan(getArterialRoadWidth(radius) / 2 + 1)
      expect(resolveCitySurfaceCollision({ ...arrival }, [...plan.buildings, ...details.colliders], radius, .4)).toBe(false)
      expect(bay).not.toBeNull()
      if (!bay) continue
      const approach = { azimuth: bay.azimuth - Math.cos(bay.heading) * bay.signSide * 2.5 / radius,
        axialPosition: bay.axial + Math.sin(bay.heading) * bay.signSide * 2.5 }
      expect(resolveCitySurfaceCollision(approach, plan.buildings, radius, .4)).toBe(false)
      // Check all four envelope corners, not just the old spherical centre.
      for (const x of [-.9, .9]) for (const z of [-2.2, 2.2]) {
        const point = { azimuth: bay.azimuth + (-Math.cos(bay.heading) * x + Math.sin(bay.heading) * z) / radius,
          axialPosition: bay.axial + Math.sin(bay.heading) * x + Math.cos(bay.heading) * z }
        expect(resolveCitySurfaceCollision(point, plan.buildings, radius, .1)).toBe(false)
      }
    } finally { details.dispose() }
  }
})

test('player sedan borrows the city palette without disposing or highlighting the fleet', () => {
  const geometry = new THREE.BoxGeometry(1.7, 1.45, 4.1), material = new THREE.MeshStandardMaterial()
  const pack = { cars: [geometry], material }
  let sharedDisposals = 0
  geometry.addEventListener('dispose', () => sharedDisposals++)
  material.addEventListener('dispose', () => sharedDisposals++)
  const car = new Car()
  car.setPack(pack); car.setHighlighted(true)
  expect(material.emissive.getHex()).toBe(0)
  car.setPose(.8, 120, 1.2, 3200)
  expect(car.group.position.length()).toBeCloseTo(Math.hypot(3200, 120))
  expect(Car.DRIVER_EYE.y).toBeLessThan(1.45)
  expect(Car.DRIVER_EYE.y).toBeGreaterThan(1.05)
  car.dispose()
  expect(sharedDisposals).toBe(0)
  geometry.dispose(); material.dispose()
})
