export type HabitatConfig = {
  radius: number
  length: number
  rpm: number
  ballSpeedScale: number
  ballLifetimeSeconds: number
  maxTrailPoints: number
}

export const DEFAULT_HABITAT_CONFIG: HabitatConfig = {
  radius: 18,
  length: 120,
  rpm: 5,
  ballSpeedScale: 1,
  ballLifetimeSeconds: 30,
  maxTrailPoints: 200
}

export const rpmToOmega = (rpm: number) => (rpm * Math.PI) / 30

export const surfaceGravityFromConfig = (config: Pick<HabitatConfig, 'radius' | 'rpm'>) => {
  const omega = rpmToOmega(config.rpm)
  return omega * omega * config.radius
}
