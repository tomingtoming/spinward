import type { WatchActionId } from '../ui/watch/watchLayout'
import { PLACE_DESTINATIONS, type PlaceVisitAction } from './placeVisits'

export type RuntimeWatchAction =
  | {
      kind: 'preset'
      presetId: 'playground' | 'izma' | 'cooper' | 'elysium'
    }
  | {
      kind: 'respawn'
      mode: 'inner-wall' | 'old-town' | 'overlook' | 'axis-end' | 'exterior'
    }
  | { kind: 'rain-toggle' }
  | { kind: 'depth-toggle' }
  | { kind: 'visit'; action: PlaceVisitAction }
  | null

export const resolveRuntimeWatchAction = (
  action: WatchActionId
): RuntimeWatchAction => {
  if (PLACE_DESTINATIONS.some(place => place.id === action)) return { kind: 'visit', action: action as PlaceVisitAction }
  switch (action) {
    case 'preset-apply-playground':
      return { kind: 'preset', presetId: 'playground' }
    case 'preset-apply-izma':
      return { kind: 'preset', presetId: 'izma' }
    case 'preset-apply-cooper':
      return { kind: 'preset', presetId: 'cooper' }
    case 'preset-apply-elysium':
      return { kind: 'preset', presetId: 'elysium' }
    case 'respawn-inner-wall':
      return { kind: 'respawn', mode: 'inner-wall' }
    case 'respawn-old-town':
      return { kind: 'respawn', mode: 'old-town' }
    case 'respawn-overlook':
      return { kind: 'respawn', mode: 'overlook' }
    case 'respawn-axis-end':
      return { kind: 'respawn', mode: 'axis-end' }
    case 'respawn-exterior':
      return { kind: 'respawn', mode: 'exterior' }
    case 'weather-rain-toggle':
      return { kind: 'rain-toggle' }
    case 'depth-mode-toggle':
      return { kind: 'depth-toggle' }
    default:
      return null
  }
}
