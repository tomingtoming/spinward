export type HabitatType = 'cylinder' | 'ring'

export type HabitatConfig = {
  type: HabitatType
  radius: number
  length: number
  thickness: number
  rpm: number
  simScale: number
  currentPresetId: string
  ballSpeedScale: number
  ballLifetimeSeconds: number
  maxTrailPoints: number
}

export const DEFAULT_HABITAT_CONFIG: HabitatConfig = {
  type: 'cylinder',
  radius: 18,
  length: 120,
  thickness: 0,
  rpm: 5,
  simScale: 1,
  currentPresetId: 'custom',
  ballSpeedScale: 1,
  ballLifetimeSeconds: 30,
  maxTrailPoints: 200
}

export const rpmToOmega = (rpm: number) => (rpm * Math.PI) / 30

export const getHabitatSpan = (
  config: Pick<HabitatConfig, 'type' | 'length' | 'thickness'>
) => (config.type === 'ring' ? Math.max(config.thickness, config.length) : config.length)

export const surfaceGravityFromConfig = (config: Pick<HabitatConfig, 'radius' | 'rpm'>) => {
  const omega = rpmToOmega(config.rpm)
  return omega * omega * config.radius
}
