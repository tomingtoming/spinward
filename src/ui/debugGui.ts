import GUI from 'lil-gui'

import type { ObserverMode, TrailMode } from '../app/observerMode'
import { surfaceGravityFromConfig, type HabitatConfig } from '../sim/habitatConfig'
import type { ReattachTuning } from '../app/playerTraversal'

export type DebugVisualState = {
  showForceVectors: boolean
  forceVectorScale: number
  showHud: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
  verificationErrorThreshold: number
}

type DebugGuiOptions = {
  config: HabitatConfig
  reattachTuning: ReattachTuning
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
  reattachTuning,
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

  const reattachFolder = gui.addFolder('Reattach')
  reattachFolder
    .add(reattachTuning, 'radialTolerance', 0.05, 1.2, 0.01)
    .name('radial tol (m)')
  reattachFolder
    .add(reattachTuning, 'maxNormalSpeed', 0.1, 4, 0.05)
    .name('normal speed')
  reattachFolder
    .add(reattachTuning, 'maxSurfaceSpeed', 0.1, 6, 0.05)
    .name('surface speed')
  reattachFolder
    .add(reattachTuning, 'assistDistance', 0.1, 3, 0.05)
    .name('assist dist')
  reattachFolder
    .add(reattachTuning, 'assistNormalDamping', 0, 12, 0.1)
    .name('assist normal')
  reattachFolder
    .add(reattachTuning, 'assistSurfaceDamping', 0, 8, 0.1)
    .name('assist surface')
  reattachFolder
    .add(reattachTuning, 'assistRadialPull', 0, 6, 0.1)
    .name('assist pull')
  reattachFolder.open()

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
  debugFolder
    .add(debugVisuals, 'trailMode', {
      Rotating: 'rotating',
      Inertial: 'inertial',
      Both: 'both'
    })
    .name('trail mode')
    .onChange(onVisualChange)
  debugFolder
    .add(debugVisuals, 'observerMode', {
      ColonyFixed: 'colony-fixed',
      InertialFixed: 'inertial-fixed'
    })
    .name('observer')
    .onChange(onVisualChange)
  debugFolder
    .add(debugVisuals, 'verificationErrorThreshold', 0.1, 25, 0.1)
    .name('frame err')
    .onChange(onVisualChange)
  debugFolder.open()

  return {
    destroy: () => gui.destroy(),
    update: syncDerivedState
  }
}
