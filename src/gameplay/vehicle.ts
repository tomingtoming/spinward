import * as THREE from 'three'

// Arcade-but-honest tire model for a rotating habitat: the wheels only grip
// because spin gravity presses the car into the road, so every capability —
// acceleration, braking, cornering — scales with the local surface gravity.
// Drop the rpm and the car turns into a soap bar.
export const VEHICLE_TUNING = {
  maxSpeed: 26,
  maxAcceleration: 8,
  brakeAcceleration: 16,
  steerRate: 1.7,
  lateralGripRate: 7,
  rollingDragRate: 0.25
} as const

export const EARTH_GRAVITY = 9.80665

export type VehicleInput = {
  throttle: number
  steer: number
  brake: number
}

export type VehicleSurfaceBasis = {
  axial: THREE.Vector3
  tangent: THREE.Vector3
  outward: THREE.Vector3
}

export type VehicleStepConfig = {
  deltaSeconds: number
  surfaceGravity: number
  grounded: boolean
}

const headingDir = new THREE.Vector3()
const lateralDir = new THREE.Vector3()

export const getVehicleGrip = (surfaceGravity: number) =>
  THREE.MathUtils.clamp(surfaceGravity / EARTH_GRAVITY, 0, 1.4)

// Advances the car's heading and rewrites `rotatingVelocity` (rotating-frame)
// in place. The radial component is left untouched — bumps and lift-off stay
// in the physics engine's hands. Returns the grip factor that was applied.
export const stepVehicleDynamics = (
  state: { heading: number },
  rotatingVelocity: THREE.Vector3,
  basis: VehicleSurfaceBasis,
  input: VehicleInput,
  config: VehicleStepConfig
): number => {
  const grip = getVehicleGrip(config.surfaceGravity)
  const dt = Math.max(0, config.deltaSeconds)

  if (!config.grounded || dt === 0) {
    // Airborne: wheels spin uselessly; no thrust, no steering authority.
    return 0
  }

  headingDir
    .copy(basis.axial)
    .multiplyScalar(Math.cos(state.heading))
    .addScaledVector(basis.tangent, Math.sin(state.heading))
  lateralDir
    .copy(basis.axial)
    .multiplyScalar(-Math.sin(state.heading))
    .addScaledVector(basis.tangent, Math.cos(state.heading))

  let along = rotatingVelocity.dot(headingDir)
  let lateral = rotatingVelocity.dot(lateralDir)
  const radial = rotatingVelocity.dot(basis.outward)

  // Steering authority builds with speed and fades with lost grip.
  const steerScale = THREE.MathUtils.clamp(Math.abs(along) / 6, 0, 1)
  const direction = along >= 0 ? 1 : -1
  state.heading +=
    input.steer * VEHICLE_TUNING.steerRate * steerScale * direction * grip * dt

  // Engine and brakes push through the tire contact patch.
  along += input.throttle * VEHICLE_TUNING.maxAcceleration * grip * dt

  if (input.brake > 0) {
    const brakeDelta = input.brake * VEHICLE_TUNING.brakeAcceleration * grip * dt
    along = Math.sign(along) * Math.max(0, Math.abs(along) - brakeDelta)
  }

  along *= Math.exp(-VEHICLE_TUNING.rollingDragRate * dt)
  along = THREE.MathUtils.clamp(along, -VEHICLE_TUNING.maxSpeed, VEHICLE_TUNING.maxSpeed)

  // Lateral slip dies at a rate proportional to grip: at 1g the car corners
  // on rails, near 0g it drifts like it is on ice.
  lateral *= Math.exp(-VEHICLE_TUNING.lateralGripRate * grip * dt)

  rotatingVelocity
    .copy(headingDir)
    .multiplyScalar(along)
    .addScaledVector(lateralDir, lateral)
    .addScaledVector(basis.outward, radial)

  return grip
}
