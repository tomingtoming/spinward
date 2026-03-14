// All real<->sim unit conversion lives here so scale changes stay mechanically searchable.
export type Real = number & { __brand: 'Real' }
export type Sim = number & { __brand: 'Sim' }

export type RealVec3 = { x: Real; y: Real; z: Real }
export type SimVec3 = { x: Sim; y: Sim; z: Sim }

export const asReal = (value: number) => value as Real

export const asSim = (value: number) => value as Sim

export const toSimLength = (real: Real, simScale: number) =>
  asSim(Number(real) * simScale)

export const toRealLength = (sim: Sim, simScale: number) =>
  asReal(Number(sim) / simScale)

export const toSimVec3 = (value: RealVec3, simScale: number): SimVec3 => ({
  x: toSimLength(value.x, simScale),
  y: toSimLength(value.y, simScale),
  z: toSimLength(value.z, simScale)
})

export const toRealVec3 = (value: SimVec3, simScale: number): RealVec3 => ({
  x: toRealLength(value.x, simScale),
  y: toRealLength(value.y, simScale),
  z: toRealLength(value.z, simScale)
})

export const toSimVel = (realMetersPerSecond: RealVec3, simScale: number) =>
  toSimVec3(realMetersPerSecond, simScale)

export const toRealVel = (simUnitsPerSecond: SimVec3, simScale: number) =>
  toRealVec3(simUnitsPerSecond, simScale)

export const rpmToOmega = (rpm: number) => (rpm * Math.PI) / 30

export const omegaToRpm = (omega: number) => (omega * 30) / Math.PI

export const omegaToPeriod = (omega: number) =>
  omega === 0 ? Number.POSITIVE_INFINITY : (Math.PI * 2) / omega

export const periodToOmega = (periodSeconds: number) =>
  periodSeconds <= 0 ? 0 : (Math.PI * 2) / periodSeconds

export const surfaceG = (omega: number, radiusMeters: number) =>
  omega * omega * radiusMeters

export const omegaForSurfaceG = (g: number, radiusMeters: number) =>
  radiusMeters <= 0 ? 0 : Math.sqrt(Math.max(g, 0) / radiusMeters)

export const approxEqual = (a: number, b: number, epsilon: number) =>
  Math.abs(a - b) <= epsilon
