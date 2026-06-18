import type { HabitatTopology } from '../sim/habitatConfig'
import { rpmToOmega } from '../units/units'

const MIN_CAMERA_FAR = 4000

type HabitatLike = {
  setDimensions: (dimensions: {
    radius: number
    length: number
    topology?: HabitatTopology
  }) => void
  setFocusAzimuth: (focusAzimuth: number) => void
}

type CityscapeLike = {
  setDimensions: (dimensions: {
    radius: number
    length: number
    topology?: HabitatTopology
  }) => void
}

type CloudsLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
}

type SpaceportLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
}

type StarfieldLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
  getSuggestedCameraFar: () => number
  setFrameAngle: (frameAngle: number) => void
}

type SunLike = {
  setDimensions: (dimensions: { radius: number; length: number }) => void
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
  clouds: CloudsLike
  spaceport: SpaceportLike
  starfield: StarfieldLike
  sun: SunLike
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
  units: TUnits
  topology: HabitatTopology
}

export const syncHabitatRuntime = <TPlayerRig, TPlayerTraversal, TUnits>(
  dependencies: SyncHabitatRuntimeDependencies<TPlayerRig, TPlayerTraversal, TUnits>,
  config: SyncHabitatRuntimeConfig<TUnits>
) => {
  dependencies.habitat.setDimensions({
    radius: config.radius,
    length: config.span,
    topology: config.topology
  })
  dependencies.habitat.setFocusAzimuth(config.focusAzimuth)
  dependencies.cityscape.setDimensions({
    radius: config.radius,
    length: config.span,
    topology: config.topology
  })
  dependencies.clouds.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.spaceport.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.starfield.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.sun.setDimensions({
    radius: config.radius,
    length: config.span
  })
  dependencies.camera.far = Math.max(MIN_CAMERA_FAR, dependencies.starfield.getSuggestedCameraFar())
  dependencies.camera.updateProjectionMatrix()
  dependencies.inertialObserverCamera.far = dependencies.camera.far
  dependencies.inertialObserverCamera.updateProjectionMatrix()
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
