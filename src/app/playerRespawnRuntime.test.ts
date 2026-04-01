import { expect, mock, test } from 'bun:test'

import {
  rebuildPlayerTraversalRuntime,
  respawnPlayerAxisEndRuntime,
  respawnPlayerInnerWallRuntime
} from './playerRespawnRuntime'

test('respawnPlayerInnerWallRuntime applies the updated attached pose immediately', () => {
  const respawnInnerWall = mock(() => {})
  const applyPlayerTraversalState = mock(() => {})
  const playerTraversal = { id: 'player' }
  const playerRig = { id: 'rig' }

  const result = respawnPlayerInnerWallRuntime(
    {
      respawnInnerWall,
      applyPlayerTraversalState
    },
    {
      playerTraversal,
      playerRig,
      radius: 18,
      frameAngle: 1.2,
      omega: 0.4
    }
  )

  expect(result).toBeTrue()
  expect(respawnInnerWall).toHaveBeenCalledWith(playerTraversal, {
    radius: 18,
    frameAngle: 1.2,
    omega: 0.4
  })
  expect(applyPlayerTraversalState).toHaveBeenCalledWith(playerRig, playerTraversal, 18, 1.2)
})

test('respawnPlayerAxisEndRuntime only reapplies the pose when the respawn succeeds', () => {
  const respawnAxisEnd = mock(() => false)
  const applyPlayerTraversalState = mock(() => {})
  const playerTraversal = { id: 'player' }
  const playerRig = { id: 'rig' }

  const failed = respawnPlayerAxisEndRuntime(
    {
      respawnAxisEnd,
      applyPlayerTraversalState
    },
    {
      playerTraversal,
      playerRig,
      type: 'ring',
      length: 30000,
      radius: 30000,
      frameAngle: 1.2,
      omega: 0.4
    }
  )

  expect(failed).toBeFalse()
  expect(applyPlayerTraversalState).not.toHaveBeenCalled()

  respawnAxisEnd.mockImplementationOnce(() => true)

  const succeeded = respawnPlayerAxisEndRuntime(
    {
      respawnAxisEnd,
      applyPlayerTraversalState
    },
    {
      playerTraversal,
      playerRig,
      type: 'cylinder',
      length: 120,
      radius: 18,
      frameAngle: 2.4,
      omega: 0.5
    }
  )

  expect(succeeded).toBeTrue()
  expect(respawnAxisEnd).toHaveBeenLastCalledWith(playerTraversal, {
    type: 'cylinder',
    length: 120,
    frameAngle: 2.4,
    omega: 0.5
  })
  expect(applyPlayerTraversalState).toHaveBeenCalledWith(playerRig, playerTraversal, 18, 2.4)
})

test('rebuildPlayerTraversalRuntime disposes the old state, rebuilds, and respawns with the requested mode', () => {
  const previousTraversal = { id: 'previous' }
  const rebuiltTraversal = { id: 'rebuilt' }
  const buildPlayerTraversal = mock(() => rebuiltTraversal)
  const disposePlayerTraversalState = mock(() => {})
  const respawnInnerWall = mock(() => {})
  const respawnAxisEnd = mock(() => true)
  const applyPlayerTraversalState = mock(() => {})
  const playerRig = { id: 'rig' }

  const nextInnerWallTraversal = rebuildPlayerTraversalRuntime(
    {
      playerTraversal: previousTraversal,
      buildPlayerTraversal,
      disposePlayerTraversalState,
      respawnInnerWall,
      respawnAxisEnd,
      applyPlayerTraversalState,
      playerRig
    },
    {
      respawnMode: 'inner-wall',
      type: 'cylinder',
      radius: 18,
      length: 120,
      frameAngle: 0.75,
      omega: 0.4
    }
  )

  expect(nextInnerWallTraversal).toBe(rebuiltTraversal)
  expect(disposePlayerTraversalState).toHaveBeenCalledWith(previousTraversal)
  expect(buildPlayerTraversal).toHaveBeenCalledTimes(1)
  expect(respawnInnerWall).toHaveBeenCalledWith(rebuiltTraversal, {
    radius: 18,
    frameAngle: 0.75,
    omega: 0.4
  })
  expect(applyPlayerTraversalState).toHaveBeenCalledWith(playerRig, rebuiltTraversal, 18, 0.75)

  const nextAxisEndTraversal = rebuildPlayerTraversalRuntime(
    {
      playerTraversal: rebuiltTraversal,
      buildPlayerTraversal,
      disposePlayerTraversalState,
      respawnInnerWall,
      respawnAxisEnd,
      applyPlayerTraversalState,
      playerRig
    },
    {
      respawnMode: 'axis-end',
      type: 'cylinder',
      radius: 18,
      length: 120,
      frameAngle: 1.5,
      omega: 0.7
    }
  )

  expect(nextAxisEndTraversal).toBe(rebuiltTraversal)
  expect(respawnAxisEnd).toHaveBeenLastCalledWith(rebuiltTraversal, {
    type: 'cylinder',
    length: 120,
    frameAngle: 1.5,
    omega: 0.7
  })
  expect(respawnInnerWall).toHaveBeenCalledTimes(1)
})
