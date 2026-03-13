import GUI from 'lil-gui'

import { surfaceGravityFromConfig, type HabitatConfig } from '../sim/habitatConfig'

export type DebugVisualState = {
  showForceVectors: boolean
  forceVectorScale: number
  showHud: boolean
}

type DebugGuiOptions = {
  config: HabitatConfig
  debugVisuals: DebugVisualState
  onHabitatChange: () => void
  onVisualChange: () => void
}

export type DebugGuiHandle = {
  destroy: () => void
  update: () => void
}

export const createDebugGui = ({
  config,
  debugVisuals,
  onHabitatChange,
  onVisualChange
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
    .add(config, 'radius', 10, 2000, 1)
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

  const debugFolder = gui.addFolder('Debug View')
  debugFolder
    .add(debugVisuals, 'showForceVectors')
    .name('force vectors')
    .onChange(onVisualChange)
  debugFolder
    .add(debugVisuals, 'forceVectorScale', 0.02, 0.5, 0.01)
    .name('force scale')
    .onChange(onVisualChange)
  debugFolder
    .add(debugVisuals, 'showHud')
    .name('show HUD')
    .onChange(onVisualChange)
  debugFolder.open()

  return {
    destroy: () => gui.destroy(),
    update: syncDerivedState
  }
}
