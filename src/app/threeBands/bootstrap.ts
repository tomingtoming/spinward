import shell from './shell.html?raw'
import { configureSharedAssets } from '../sharedAssetURL'
import { ColonyDataError } from '../../worlds/colonyManifestDocument'

export async function bootstrapThreeBands() {
  configureSharedAssets()
  const root = document.createElement('main')
  root.id = 'three-bands-app'
  root.innerHTML = shell
  document.body.append(root)
  document.title = 'Spinward — 三帯を巡る'
  const { worldReady } = await import('./runtime.js')
  await worldReady.catch(error => { throw new ColonyDataError('Three-band world data could not be loaded', { cause: error }) })
}
