import metroPlaces from '../worlds/generated/metroPlaces.json'

/** Everyday destinations resolve against the current generated city. A small
 * habitat or a different quality tier must not inherit an absent landmark. */
export const PLACE_DESTINATIONS = [
  { id: 'visit-landscape', label: 'Landscape', kind: 'landscape' },
  { id: 'visit-cafe', label: 'Café', kind: 'cafe' },
  { id: 'visit-courtyard', label: 'Courtyard', kind: 'court' },
  { id: 'visit-apartment', label: 'Apartment', kind: 'nyaan' },
  { id: 'visit-shops', label: 'Market street', kind: 'shops' },
  { id: 'visit-river', label: 'Riverside', kind: 'river' },
  { id: 'visit-park', label: 'Park', kind: 'park' },
  { id: 'visit-ball-practice', label: 'Ball practice', kind: 'ball-practice' },
  { id: 'visit-car-share', label: 'Car share', kind: 'car-share' },
  { id: 'visit-deck', label: 'Observation deck', kind: 'deck' },
  { id: 'visit-garden', label: 'Garden street', kind: 'garden' },
  { id: 'visit-public', label: 'Nearby square', kind: 'public' },
  { id: 'visit-station', label: 'Nearby station', kind: 'station' }
] as const

export const METRO_PLACE_DESTINATIONS = metroPlaces.places.map(place => ({
  id: `visit-metro-${place.id}` as const, label: place.label, kind: `metro-${place.id}`
}))
export const ALL_PLACE_DESTINATIONS = [...PLACE_DESTINATIONS, ...METRO_PLACE_DESTINATIONS]
export type PlaceVisitAction = (typeof ALL_PLACE_DESTINATIONS)[number]['id']
export type PlaceDestination = { id: PlaceVisitAction; label: string; kind: string }

/** Tokyo offers named locations; other habitats retain their everyday places. */
export function placesForHabitat(available: ReadonlySet<PlaceVisitAction>): readonly PlaceDestination[] {
  const metro = METRO_PLACE_DESTINATIONS.filter(place => available.has(place.id))
  return metro.length ? metro : PLACE_DESTINATIONS
}

export function resolvePlaceVisit<T>(action: PlaceVisitAction, resolve: (kind: string) => T | null): T | null {
  const destination = ALL_PLACE_DESTINATIONS.find(place => place.id === action)
  if (!destination) return null
  // Arrive at an entrance with room to look around. Counter-level deep links
  // remain available separately for authoring and interaction diagnostics.
  return resolve(destination.kind)
}
