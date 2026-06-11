const WATCH_ACTION_MODES = ['fine', 'coarse'] as const
const WATCH_ACTION_DIRECTIONS = ['decrement', 'increment'] as const

export type WatchActionMode = (typeof WATCH_ACTION_MODES)[number]
export type WatchActionDirection = (typeof WATCH_ACTION_DIRECTIONS)[number]

export type WatchParameterValueSource = {
  rpm: number
  radius: number
  length: number
  throwScale: number
  jetpackAcceleration: number
  reattachThreshold: number
  dayCycleSeconds: number
}

export const WATCH_PARAMETER_SPECS = [
  {
    key: 'rpm',
    label: 'RPM',
    actionPrefix: 'rpm',
    format: (source: WatchParameterValueSource) => source.rpm.toFixed(2)
  },
  {
    key: 'radius',
    label: 'Radius',
    actionPrefix: 'radius',
    format: (source: WatchParameterValueSource) => `${source.radius.toFixed(0)} m`
  },
  {
    key: 'length',
    label: 'Length',
    actionPrefix: 'length',
    format: (source: WatchParameterValueSource) => `${source.length.toFixed(0)} m`
  },
  {
    key: 'throwScale',
    label: 'Throw',
    actionPrefix: 'throw-scale',
    format: (source: WatchParameterValueSource) => source.throwScale.toFixed(2)
  },
  {
    key: 'jetpackAcceleration',
    label: 'Jetpack',
    actionPrefix: 'jetpack-acceleration',
    format: (source: WatchParameterValueSource) => `${source.jetpackAcceleration.toFixed(1)} m/s\u00B2`
  },
  {
    key: 'reattachThreshold',
    label: 'Reattach',
    actionPrefix: 'reattach-threshold',
    format: (source: WatchParameterValueSource) => source.reattachThreshold.toFixed(2)
  },
  {
    key: 'dayCycleSeconds',
    label: 'Day Cycle',
    actionPrefix: 'day-cycle',
    format: (source: WatchParameterValueSource) =>
      source.dayCycleSeconds <= 0 ? 'Paused' : `${source.dayCycleSeconds.toFixed(0)} s`
  }
] as const

export type WatchParameterSpec = (typeof WATCH_PARAMETER_SPECS)[number]
export type WatchParameterRowKey = WatchParameterSpec['key']
export type WatchParameterActionPrefix = WatchParameterSpec['actionPrefix']
export type WatchParameterActionId =
  `${WatchParameterActionPrefix}-${WatchActionMode}-${WatchActionDirection}`

const watchParameterSpecByKey = new Map(
  WATCH_PARAMETER_SPECS.map((spec) => [spec.key, spec])
)
const watchParameterSpecByActionPrefix = new Map(
  WATCH_PARAMETER_SPECS.map((spec) => [spec.actionPrefix, spec])
)

export const WATCH_PRIMARY_PARAMETER_SPECS = WATCH_PARAMETER_SPECS

export const formatWatchParameterValue = (
  key: WatchParameterRowKey,
  source: WatchParameterValueSource
) => {
  const spec = watchParameterSpecByKey.get(key)

  if (spec === undefined) {
    throw new Error(`Unknown watch parameter key: ${key}`)
  }

  return spec.format(source)
}

export const parseWatchParameterAction = (
  action: string
): {
  prefix: WatchParameterActionPrefix
  mode: WatchActionMode
  ticks: -1 | 1
} | null => {
  const match = /^(.*)-(fine|coarse)-(decrement|increment)$/.exec(action)

  if (match === null) {
    return null
  }

  const prefix = match[1] as WatchParameterActionPrefix

  if (!watchParameterSpecByActionPrefix.has(prefix)) {
    return null
  }

  return {
    prefix,
    mode: match[2] as WatchActionMode,
    ticks: match[3] === 'increment' ? 1 : -1
  }
}
