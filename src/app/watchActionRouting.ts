import type { WatchActionId } from '../ui/watch/watchLayout'

export type RuntimeWatchAction =
  | {
      kind: 'preset'
      presetId: 'playground' | 'izma' | 'cooper' | 'elysium'
    }
  | {
      kind: 'respawn'
      mode: 'inner-wall' | 'overlook' | 'axis-end' | 'exterior'
    }
  | { kind: 'rain-toggle' }
  | null

export const resolveRuntimeWatchAction = (
  action: WatchActionId
): RuntimeWatchAction => {
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
    case 'respawn-overlook':
      return { kind: 'respawn', mode: 'overlook' }
    case 'respawn-axis-end':
      return { kind: 'respawn', mode: 'axis-end' }
    case 'respawn-exterior':
      return { kind: 'respawn', mode: 'exterior' }
    case 'weather-rain-toggle':
      return { kind: 'rain-toggle' }
    default:
      return null
  }
}
