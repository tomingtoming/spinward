import { expect, test } from 'bun:test'

import { DEFAULT_FAR_FIELD_SETTINGS } from './farFieldSettings'
import { resolveFarFieldLodProfile } from './farFieldLod'

test('far-field lod keeps requested quality on desktop', () => {
  const profile = resolveFarFieldLodProfile(
    {
      ...DEFAULT_FAR_FIELD_SETTINGS,
      parallaxLayers: 3,
      textureSize: 1024,
      updateInterval_s: 1
    },
    {
      xrActive: false,
      devicePixelRatio: 2
    }
  )

  expect(profile.layerCount).toBe(3)
  expect(profile.textureSize).toBe(1024)
  expect(profile.radialSegments).toBe(64)
  expect(profile.heightSegments).toBe(8)
  expect(profile.refreshInterval_s).toBe(1)
})

test('far-field lod clamps layer count, texture size, and refresh cadence in XR', () => {
  const profile = resolveFarFieldLodProfile(
    {
      ...DEFAULT_FAR_FIELD_SETTINGS,
      parallaxLayers: 3,
      textureSize: 1024,
      updateInterval_s: 1
    },
    {
      xrActive: true,
      devicePixelRatio: 2
    }
  )

  expect(profile.layerCount).toBe(2)
  expect(profile.textureSize).toBe(256)
  expect(profile.radialSegments).toBe(40)
  expect(profile.heightSegments).toBe(4)
  expect(profile.refreshInterval_s).toBe(3)
})
