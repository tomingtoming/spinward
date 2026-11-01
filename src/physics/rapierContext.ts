import RAPIER from '@dimforge/rapier3d-compat'

export type RapierModule = typeof RAPIER

let rapierInitPromise: Promise<RapierModule> | null = null

export const initRapier = async () => {
  if (rapierInitPromise === null) {
    // compat needs init() to decode its embedded wasm; the plain package the
    // production build aliases in has already instantiated on import.
    const init = (RAPIER as { init?: () => Promise<unknown> }).init
    rapierInitPromise = init ? init().then(() => RAPIER) : Promise.resolve(RAPIER)
  }

  return rapierInitPromise
}
