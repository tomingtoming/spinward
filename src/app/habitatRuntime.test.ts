import { expect, mock, test } from 'bun:test'

import { createUnitsContext } from '../units/units'
import { syncHabitatRuntime } from './habitatRuntime'

test('syncHabitatRuntime keeps habitat visuals, cameras, and wall colliders in sync', () => {
  const habitat = {
    setDimensions: mock(() => {}),
    setFocusAzimuth: mock(() => {}),
    setNightLighting: mock(() => {})
  }
  const cityscape = {
    setDimensions: mock(() => {})
  }
  const starfield = {
    setDimensions: mock(() => {}),
    getSuggestedCameraFar: mock(() => 2800),
    setFrameAngle: mock(() => {})
  }
  const camera = {
    far: 0,
    updateProjectionMatrix: mock(() => {})
  }
  const inertialObserverCamera = {
    far: 0,
    updateProjectionMatrix: mock(() => {})
  }
  const cylinderWall = {
    rebuild: mock(() => {}),
    setAngularVelocity: mock(() => {})
  }
  const applyPlayerTraversalState = mock(() => {})
  const playerRig = { id: 'rig' }
  const playerTraversal = { id: 'player' }
  const units = createUnitsContext(0.02)

  syncHabitatRuntime(
    {
      habitat,
      cityscape,
      starfield,
      camera,
      inertialObserverCamera,
      cylinderWall,
      applyPlayerTraversalState,
      playerRig,
      playerTraversal
    },
    {
      radius: 18,
      span: 120,
      rpm: 5,
      frameAngle: 1.25,
      focusAzimuth: 0.5,
      currentPresetId: 'playground',
      farField: {
        enabled: true,
        mode: 'night',
        intensity: 1.2,
        density: 0.7,
        updateInterval_s: 0
      },
      units
    }
  )

  expect(habitat.setDimensions).toHaveBeenCalledWith({ radius: 18, length: 120 })
  expect(habitat.setFocusAzimuth).toHaveBeenCalledWith(0.5)
  expect(cityscape.setDimensions).toHaveBeenCalledWith({ radius: 18, length: 120 })
  expect(starfield.setDimensions).toHaveBeenCalledWith({ radius: 18, length: 120 })
  expect(starfield.setFrameAngle).toHaveBeenCalledWith(1.25)
  expect(camera.far).toBe(4000)
  expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(1)
  expect(inertialObserverCamera.far).toBe(4000)
  expect(inertialObserverCamera.updateProjectionMatrix).toHaveBeenCalledTimes(1)
  expect(habitat.setNightLighting).toHaveBeenCalledWith({
    enabled: true,
    mode: 'night',
    intensity: 1.2,
    density: 0.7,
    presetId: 'playground',
    updateInterval_s: 0
  })
  expect(cylinderWall.rebuild).toHaveBeenCalledWith({
    radius: 18,
    length: 120,
    units
  })
  expect(cylinderWall.setAngularVelocity).toHaveBeenCalledWith(0.5235987755982988)
  expect(applyPlayerTraversalState).toHaveBeenCalledWith(playerRig, playerTraversal, 18, 1.25)
})

