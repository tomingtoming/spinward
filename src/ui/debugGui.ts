import GUI from 'lil-gui'

import { surfaceGravityFromConfig, type HabitatConfig } from '../sim/habitatConfig'

type DebugGuiOptions = {
  config: HabitatConfig
  onHabitatChange: () => void
}

export type DebugGuiHandle = {
  destroy: () => void
  update: () => void
}

export const createDebugGui = ({
  config,
  onHabitatChange
}: DebugGuiOptions): DebugGuiHandle => {
  const gui = new GUI({ title: 'O’Neill Cylinder' })
  const derivedState = {
    gTarget: surfaceGravityFromConfig(config)
  }

  const syncDerivedState = () => {
    derivedState.gTarget = surfaceGravityFromConfig(config)
  }

  gui.domElement.style.zIndex = '20'

  gui
    .add(config, 'radius', 10, 120, 1)
    .name('radius (m)')
    .onChange(() => {
      syncDerivedState()
      onHabitatChange()
    })

  gui
    .add(config, 'rpm', 0, 12, 0.1)
    .name('rpm')
    .onChange(() => {
      syncDerivedState()
      onHabitatChange()
    })

  gui
    .add(config, 'ballSpeedScale', 0.25, 3, 0.05)
    .name('throw scale')
    .onChange(syncDerivedState)

  gui.add(derivedState, 'gTarget').name('surface g').listen()

  return {
    destroy: () => gui.destroy(),
    update: syncDerivedState
  }
}
