/** Everyday destinations resolve against the current generated city. A small
 * habitat or a different quality tier must not inherit an absent landmark. */
export const PLACE_DESTINATIONS = [
  { id: 'visit-cafe', label: 'Café', kind: 'cafe' },
  { id: 'visit-courtyard', label: 'Courtyard', kind: 'court' },
  { id: 'visit-apartment', label: 'Apartment', kind: 'nyaan' },
  { id: 'visit-shops', label: 'Market street', kind: 'shops' },
  { id: 'visit-river', label: 'Riverside', kind: 'river' },
  { id: 'visit-park', label: 'Park', kind: 'park' },
  { id: 'visit-ball-practice', label: 'Ball practice', kind: 'ball-practice' },
  { id: 'visit-car-share', label: 'Car share', kind: 'car-share' }
] as const

export type PlaceVisitAction = (typeof PLACE_DESTINATIONS)[number]['id']

export function resolvePlaceVisit<T>(action: PlaceVisitAction, resolve: (kind: string) => T | null): T | null {
  const destination = PLACE_DESTINATIONS.find(place => place.id === action)
  if (!destination) return null
  // Arrive at an entrance with room to look around. Counter-level deep links
  // remain available separately for authoring and interaction diagnostics.
  return resolve(destination.kind)
}
