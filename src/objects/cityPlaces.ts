import type {CityPlan} from './cityLayout'
import {planPublicPark} from './publicPark'
import {planPublicUnderpass} from './publicUnderpass'
import {planCurvedNeighborhood} from './curvedNeighborhood'
import {planRiverDistrict} from './riverDistrictPlan'
import type {CityPlaces} from './cityPlacePlan'

/** Resolve inhabited places before replacing the streets or retiring their
 * source patches. The resulting city owns these plans, including explicit
 * absence. Renderers, collisions and directions must not rediscover a different
 * destination from whatever legacy roads happen to remain after migration.
 * This preserves the places, not certification of their new external links. */
export function preserveCityPlaces(city:CityPlan,radius:number):CityPlaces {
  if(city.places){
    if(city.places.radius!==radius)throw Error('City places belong to a different habitat radius')
    return city.places
  }
  const places:CityPlaces={radius,park:planPublicPark(city,radius),covered:planPublicUnderpass(city,radius),
    garden:planCurvedNeighborhood(city,radius),river:planRiverDistrict(city,radius)}
  // Road descriptors are mutable planning inputs. A retained bridge must not
  // move just because the next road generator edits one of those descriptors.
  city.places=structuredClone(places)
  return city.places
}
