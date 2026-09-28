import { expect, test } from 'bun:test'
import { sharedAssetURL } from './sharedAssetURL'

test('shared model releases include external textures without rewriting blobs or urban objects', () => {
  expect(sharedAssetURL('/assets/people/resident.glb', '/shared/abc/')).toBe('/shared/abc/assets/people/resident.glb')
  expect(sharedAssetURL('/assets/vehicles/kenney/Textures/colormap.png', '/shared/abc')).toBe('/shared/abc/assets/vehicles/kenney/Textures/colormap.png')
  for (const url of ['/objects/abc.bin.gz', '/shared/abc/assets/people/resident.glb', 'blob:https://example.test/id', 'data:image/png;base64,x']) expect(sharedAssetURL(url, '/shared/abc')).toBe(url)
  expect(sharedAssetURL('/assets/people/resident.glb', '')).toBe('/assets/people/resident.glb')
})
