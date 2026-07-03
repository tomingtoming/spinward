import type { HabitatTopology, HabitatType } from '../sim/habitatConfig'
import { rpmToOmega } from '../units/units'
import { getCityExpressway, type CityExpressway } from '../objects/cityLayout'

const MIN_CAMERA_FAR = 4000

type HabitatLike = {
  setDimensions: (dimensions: {
    radius: number
    length: number
    topology?: HabitatTopology
    type?: HabitatType
  }) => void
  setFocusAzimuth: (focusAzimuth: number) => void
}

type CityscapeLike = {
  setDimensions: (dimensions: {
    radius: number
    length: number
    topology?: HabitatTopology
    type?: HabitatType
  }) => void
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
  rebuild: (config: {
    radius: number
    length: number
    units: TUnits
    expressway?: CityExpressway | null
  }) => void
  setAngularVelocity: (omega: number) => void
}

type SyncHabitatRuntimeDependencies<TPlayerRig, TPlayerTraversal, TUnits> = {
  habitat: HabitatLike
  cityscape: CityscapeLike
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
  type: HabitatType
}

export const syncHabitatRuntime = <TPlayerRig, TPlayerTraversal, TUnits>(
  dependencies: SyncHabitatRuntimeDependencies<TPlayerRig, TPlayerTraversal, TUnits>,
  config: SyncHabitatRuntimeConfig<TUnits>
) => {
  dependencies.habitat.setDimensions({
    radius: config.radius,
    length: config.span,
    topology: config.topology,
    type: config.type
  })
  dependencies.habitat.setFocusAzimuth(config.focusAzimuth)
  dependencies.cityscape.setDimensions({
    radius: config.radius,
    length: config.span,
    topology: config.topology,
    type: config.type
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
    units: config.units,
    // The viaduct's deck ring + ramp treads co-rotate on the wall body, so
    // the car (and thrown balls) get real contact with them.
    expressway: getCityExpressway(config.radius, config.span)
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
