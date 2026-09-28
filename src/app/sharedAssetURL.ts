import { DefaultLoadingManager } from 'three'

export function sharedAssetURL(url: string, root = import.meta.env.VITE_SHARED_ASSET_ROOT ?? ''): string {
  return root && url.startsWith('/assets/') ? root.replace(/\/$/, '') + url : url
}

/** GLTF dependencies pass through the same manager, including external PNGs. */
export function configureSharedAssets(): void {
  if (import.meta.env.VITE_SHARED_ASSET_ROOT) DefaultLoadingManager.setURLModifier(url => sharedAssetURL(url))
}
