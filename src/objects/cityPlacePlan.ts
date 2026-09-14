import type {CityPlan} from './cityLayout'
import type {PublicPark} from './publicPark'
import type {PublicUnderpass} from './publicUnderpass'
import type {CurvedNeighborhood} from './curvedNeighborhood'
import type {RiverDistrict} from './riverDistrictPlan'

export type CityPlaces={
  radius:number
  park:PublicPark|null
  covered:PublicUnderpass|null
  garden:CurvedNeighborhood|null
  river:RiverDistrict|null
}

/** Undefined means unresolved; null is a resolved absence, not permission to
 * silently choose a replacement place after the underlying roads change. */
export function retainedCityPlace<K extends keyof Omit<CityPlaces,'radius'>>(city:CityPlan,radius:number,key:K):CityPlaces[K]|undefined {
  if(!city.places)return undefined
  if(city.places.radius!==radius)throw Error('City places belong to a different habitat radius')
  return city.places[key]
}
