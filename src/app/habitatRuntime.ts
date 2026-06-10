import { rpmToOmega } from '../units/units'

const MIN_CAMERA_FAR = 4000

type HabitatLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
  setFocusAzimuth: (focusAzimuth: number) => void
  setNightLighting: (config: {
    enabled: boolean
    mode: 'night' | 'day' | 'auto'
    intensity: number
    density: number
    presetId: string
    updateInterval_s: number
  }) => void
}

type CityscapeLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
}

type StarfieldLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
  getSuggestedCameraFar: () => number
  setFrameAngle: (frameAngle: number) => void
}

type CameraLike = {
  far: number
  updateProjectionMatrix: () => void
}

type RotatingCylinderLike<TUnits> = {
  rebuild: (config: { radius: number; length: number; units: TUnits }) => void
  setAngularVelocity: (omega: number) => void
}

type SyncHabitatRuntimeDependencies<TPlayerRig, TPlayerTraversal, TUnits> = {
  habitat: HabitatLike
  cityscape: CityscapeLike
  starfield: StarfieldLike
  camera: CameraLike
  inertialObserverCamera: CameraLike
  cylinderWall: RotatingCylinderLike<TUnits>
  applyPlayerTraversalState: (
    playerRig: TPlayerRig,
    playerTraversal: TPlayerTraversal,
    radius: number,
    frameAngle: number
  ) => void
  playerRig: TPlayerRig
  playerTraversal: TPlayerTraversal
}

type SyncHabitatRuntimeConfig<TUnits> = {
  radius: number
  span: number
  rpm: number
  frameAngle: number
  focusAzimuth: number
  currentPresetId: string
  farField: {
    enabled: boolean
    mode: 'night' | 'day' | 'auto'
    intensity: number
    density: number
    updateInterval_s: number
  }
  units: TUnits
}

export const syncHabitatRuntime = <TPlayerRig, TPlayerTraversal, TUnits>(
  dependencies: SyncHabitatRuntimeDependencies<TPlayerRig, TPlayerTraversal, TUnits>,
  config: SyncHabitatRuntimeConfig<TUnits>
) => {
  dependencies.habitat.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.habitat.setFocusAzimuth(config.focusAzimuth)
  dependencies.cityscape.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.starfield.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.camera.far = Math.max(MIN_CAMERA_FAR, dependencies.starfield.getSuggestedCameraFar())
  dependencies.camera.updateProjectionMatrix()
  dependencies.inertialObserverCamera.far = dependencies.camera.far
  dependencies.inertialObserverCamera.updateProjectionMatrix()
  dependencies.habitat.setNightLighting({
    enabled: config.farField.enabled,
    mode: config.farField.mode,
    intensity: config.farField.intensity,
    density: config.farField.density,
    presetId: config.currentPresetId,
    updateInterval_s: config.farField.updateInterval_s
  })
  dependencies.cylinderWall.rebuild({
    radius: config.radius,
    length: config.span,
    units: config.units
  })
  dependencies.cylinderWall.setAngularVelocity(rpmToOmega(config.rpm))
  dependencies.starfield.setFrameAngle(config.frameAngle)
  dependencies.applyPlayerTraversalState(
    dependencies.playerRig,
    dependencies.playerTraversal,
    config.radius,
    config.frameAngle
  )
}
