import type { HabitatType } from '../sim/habitatConfig'

type ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal> = (
  playerRig: TPlayerRig,
  playerTraversal: TPlayerTraversal,
  radius: number,
  frameAngle: number
) => void

type RespawnPlayerRuntimeConfig<TPlayerRig, TPlayerTraversal> = {
  playerTraversal: TPlayerTraversal
  playerRig: TPlayerRig
  radius: number
  frameAngle: number
  omega: number
}

type RespawnPlayerAxisEndRuntimeConfig<TPlayerRig, TPlayerTraversal> =
  RespawnPlayerRuntimeConfig<TPlayerRig, TPlayerTraversal> & {
    type: HabitatType
    length: number
  }

export const respawnPlayerInnerWallRuntime = <TPlayerRig, TPlayerTraversal>(
  dependencies: {
    respawnInnerWall: (
      playerTraversal: TPlayerTraversal,
      config: { radius: number; frameAngle: number; omega: number }
    ) => void
    applyPlayerTraversalState: ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal>
  },
  config: RespawnPlayerRuntimeConfig<TPlayerRig, TPlayerTraversal>
) => {
  dependencies.respawnInnerWall(config.playerTraversal, {
    radius: config.radius,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  dependencies.applyPlayerTraversalState(
    config.playerRig,
    config.playerTraversal,
    config.radius,
    config.frameAngle
  )
  return true
}

export const respawnPlayerOverlookRuntime = <TPlayerRig, TPlayerTraversal>(
  dependencies: {
    respawnOverlook: (
      playerTraversal: TPlayerTraversal,
      config: { radius: number; frameAngle: number; omega: number }
    ) => void
    applyPlayerTraversalState: ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal>
  },
  config: RespawnPlayerRuntimeConfig<TPlayerRig, TPlayerTraversal>
) => {
  dependencies.respawnOverlook(config.playerTraversal, {
    radius: config.radius,
    frameAngle: config.frameAngle,
    omega: config.omega
  })
  dependencies.applyPlayerTraversalState(
    config.playerRig,
    config.playerTraversal,
    config.radius,
    config.frameAngle
  )
  return true
}

export const respawnPlayerAxisEndRuntime = <TPlayerRig, TPlayerTraversal>(
  dependencies: {
    respawnAxisEnd: (
      playerTraversal: TPlayerTraversal,
      config: {
        type: HabitatType
        length: number
        frameAngle: number
        omega: number
      }
    ) => boolean
    applyPlayerTraversalState: ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal>
  },
  config: RespawnPlayerAxisEndRuntimeConfig<TPlayerRig, TPlayerTraversal>
) => {
  const didRespawn = dependencies.respawnAxisEnd(config.playerTraversal, {
    type: config.type,
    length: config.length,
    frameAngle: config.frameAngle,
    omega: config.omega
  })

  if (didRespawn) {
    dependencies.applyPlayerTraversalState(
      config.playerRig,
      config.playerTraversal,
      config.radius,
      config.frameAngle
    )
  }

  return didRespawn
}

export const respawnPlayerExteriorRuntime = <TPlayerRig, TPlayerTraversal>(
  dependencies: {
    respawnExterior: (
      playerTraversal: TPlayerTraversal,
      config: {
        type: HabitatType
        radius: number
        length: number
        frameAngle: number
        omega: number
      }
    ) => boolean
    applyPlayerTraversalState: ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal>
  },
  config: RespawnPlayerAxisEndRuntimeConfig<TPlayerRig, TPlayerTraversal>
) => {
  const didRespawn = dependencies.respawnExterior(config.playerTraversal, {
    type: config.type,
    radius: config.radius,
    length: config.length,
    frameAngle: config.frameAngle,
    omega: config.omega
  })

  if (didRespawn) {
    dependencies.applyPlayerTraversalState(
      config.playerRig,
      config.playerTraversal,
      config.radius,
      config.frameAngle
    )
  }

  return didRespawn
}

export const rebuildPlayerTraversalRuntime = <TPlayerRig, TPlayerTraversal>(
  dependencies: {
    playerTraversal: TPlayerTraversal
    buildPlayerTraversal: () => TPlayerTraversal
    disposePlayerTraversalState: (playerTraversal: TPlayerTraversal) => void
    respawnInnerWall: (
      playerTraversal: TPlayerTraversal,
      config: { radius: number; frameAngle: number; omega: number }
    ) => void
    respawnAxisEnd: (
      playerTraversal: TPlayerTraversal,
      config: {
        type: HabitatType
        length: number
        frameAngle: number
        omega: number
      }
    ) => boolean
    applyPlayerTraversalState: ApplyPlayerTraversalState<TPlayerRig, TPlayerTraversal>
    playerRig: TPlayerRig
  },
  config: {
    respawnMode: 'inner-wall' | 'axis-end'
    type: HabitatType
    radius: number
    length: number
    frameAngle: number
    omega: number
  }
) => {
  dependencies.disposePlayerTraversalState(dependencies.playerTraversal)
  const nextPlayerTraversal = dependencies.buildPlayerTraversal()

  if (config.respawnMode === 'axis-end') {
    const didRespawn = respawnPlayerAxisEndRuntime(
      {
        respawnAxisEnd: dependencies.respawnAxisEnd,
        applyPlayerTraversalState: dependencies.applyPlayerTraversalState
      },
      {
        playerTraversal: nextPlayerTraversal,
        playerRig: dependencies.playerRig,
        type: config.type,
        length: config.length,
        radius: config.radius,
        frameAngle: config.frameAngle,
        omega: config.omega
      }
    )
    if (!didRespawn) {
      respawnPlayerInnerWallRuntime(
        {
          respawnInnerWall: dependencies.respawnInnerWall,
          applyPlayerTraversalState: dependencies.applyPlayerTraversalState
        },
        {
          playerTraversal: nextPlayerTraversal,
          playerRig: dependencies.playerRig,
          radius: config.radius,
          frameAngle: config.frameAngle,
          omega: config.omega
        }
      )
    }
    return nextPlayerTraversal
  }

  respawnPlayerInnerWallRuntime(
    {
      respawnInnerWall: dependencies.respawnInnerWall,
      applyPlayerTraversalState: dependencies.applyPlayerTraversalState
    },
    {
      playerTraversal: nextPlayerTraversal,
      playerRig: dependencies.playerRig,
      radius: config.radius,
      frameAngle: config.frameAngle,
      omega: config.omega
    }
  )
  return nextPlayerTraversal
}
