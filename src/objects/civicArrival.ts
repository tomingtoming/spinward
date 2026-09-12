import { getArterialRoadWidth } from './cityLayout'

/** The pedestrian corner of the central square. Small physics habitats keep
 * their clear central floor; a city arrival belongs outside the carriageway. */
export function centralPlazaArrival(radius: number) {
  const edge = getArterialRoadWidth(radius) / 2
  return radius < 800 ? { azimuth: 0, axialPosition: 0 }
    : { azimuth: (edge + 3.5) / radius, axialPosition: edge + 2.5 }
}
