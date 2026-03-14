import { expect, test } from 'bun:test'

import { createFarFieldTexturePlan } from './farFieldTexture'

test('far-field texture plan emits almost no lights at density 0', () => {
  const plan = createFarFieldTexturePlan({
    textureSize: 512,
    density: 0,
    seed: 1
  })

  expect(plan.lights.length).toBe(0)
})

test('far-field texture plan emits more lights as density increases', () => {
  const sparsePlan = createFarFieldTexturePlan({
    textureSize: 512,
    density: 0.2,
    seed: 7
  })
  const densePlan = createFarFieldTexturePlan({
    textureSize: 512,
    density: 1,
    seed: 7
  })

  expect(densePlan.lights.length).toBeGreaterThan(sparsePlan.lights.length)
})
