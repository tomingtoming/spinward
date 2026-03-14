import RAPIER from '@dimforge/rapier3d-compat'

export type RapierModule = typeof RAPIER

let rapierInitPromise: Promise<RapierModule> | null = null

export const initRapier = async () => {
  if (rapierInitPromise === null) {
    rapierInitPromise = RAPIER.init().then(() => RAPIER)
  }

  return rapierInitPromise
}
