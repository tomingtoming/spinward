import GUI from 'lil-gui'

import {
  MAX_VISIBILITY_METERS,
  MIN_VISIBILITY_METERS
} from '../app/airVisibility'
import type { ObserverMode, TrailMode } from '../app/observerMode'
import { getHabitatSpan, type HabitatConfig } from '../sim/habitatConfig'
import type { ReattachTuning } from '../app/playerTraversal'
import { rpmToOmega, surfaceG } from '../units/units'

export type DebugVisualState = {
  showForceVectors: boolean
  forceVectorScale: number
  showHud: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
}

type DebugGuiOptions = {
  config: HabitatConfig
  reattachTuning: ReattachTuning
  debugVisuals: DebugVisualState
  // Live air-haze tuning (docs/far-field-lod.md slice ①). The game loop reads
  // this every frame, so the slider needs no change callback.
  airFog: { visibilityMeters: number; scaleHeightMeters: number }
  onHabitatChange: () => void
  onSettingsChange: () => void
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
  airFog,
  onHabitatChange,
  onSettingsChange,
  onVisualChange
}: DebugGuiOptions): DebugGuiHandle => {
  const gui = new GUI({ title: 'Debug' })
  // Developer tool: collapsed by default so the demo UI stays clean.
  gui.close()
  const derivedState = {
    gTarget: surfaceG(rpmToOmega(config.rpm), config.radius),
    spanMeters: getHabitatSpan(config),
    simScale: config.simScale,
    presetId: config.currentPresetId
  }

  const syncDerivedState = () => {
    derivedState.gTarget = surfaceG(rpmToOmega(config.rpm), config.radius)
    derivedState.spanMeters = getHabitatSpan(config)
    derivedState.simScale = config.simScale
    derivedState.presetId = config.currentPresetId
  }

  gui.domElement.style.zIndex = '20'

  gui
    .add(config, 'radius', 10, 100000, 1)
    .name('radius (m)')
    .listen()
    .onChange(() => {
      config.currentPresetId = 'custom'
      syncDerivedState()
      onHabitatChange()
      onSettingsChange()
    })

  gui
    .add(config, 'rpm', 0, 12, 0.1)
    .name('rpm')
    .listen()
    .onChange(() => {
      config.currentPresetId = 'custom'
      syncDerivedState()
      onHabitatChange()
      onSettingsChange()
    })

  gui
    .add(config, 'ballSpeedScale', 0.25, 3, 0.05)
    .name('throw scale')
    .onChange(() => {
      syncDerivedState()
      onSettingsChange()
    })

  gui
    .add(config, 'jetpackAcceleration', 1, 40, 0.1)
    .name('jetpack accel')
    .listen()
    .onChange(() => {
      syncDerivedState()
      onSettingsChange()
    })

  gui.add(derivedState, 'gTarget').name('surface g').listen()
  gui.add(derivedState, 'spanMeters').name('span (m)').listen()
  gui.add(derivedState, 'simScale').name('sim scale').listen()
  gui.add(derivedState, 'presetId').name('preset').listen()

  const reattachFolder = gui.addFolder('Reattach')
  reattachFolder
    .add(reattachTuning, 'radialTolerance', 0.05, 1.2, 0.01)
    .name('radial tol (m)')
    .onChange(onSettingsChange)
  reattachFolder
    .add(reattachTuning, 'maxNormalSpeed', 0.1, 4, 0.05)
    .name('normal speed')
    .onChange(onSettingsChange)
  reattachFolder
    .add(reattachTuning, 'maxSurfaceSpeed', 0.1, 6, 0.05)
    .name('surface speed')
    .onChange(onSettingsChange)
  reattachFolder.open()

  const atmosphereFolder = gui.addFolder('Atmosphere')
  atmosphereFolder
    .add(
      airFog,
      'visibilityMeters',
      MIN_VISIBILITY_METERS,
      MAX_VISIBILITY_METERS,
      500
    )
    .name('visibility (m)')
  // Boundary-layer scale height; 0 falls back to uniform fog (A/B on device).
  atmosphereFolder
    .add(airFog, 'scaleHeightMeters', 0, 3000, 50)
    .name('boundary layer (m)')
  atmosphereFolder.open()

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
  debugFolder.open()

  return {
    destroy: () => gui.destroy(),
    update: syncDerivedState
  }
}
