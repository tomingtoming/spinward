import * as THREE from 'three'

// Arcade-but-honest tire model for a rotating habitat: the wheels only grip
// because spin gravity presses the car into the road, so every capability —
// acceleration, braking, cornering — scales with the local surface gravity.
// Drop the rpm and the car turns into a soap bar.
export const VEHICLE_TUNING = {
  // Top speed reaches the Izma wall's circumferential speed (omega*R ~= 177
  // m/s), so flooring it against the spin cancels the rotation and you float.
  // Rolling drag scales with grip (below), so it caps cruise near
  // maxAcceleration/rollingDragRate = 36/0.18 ~= 200 m/s, clearing the 178 cap
  // in every grip regime — without it the car would stall short of the wall.
  maxSpeed: 178,
  maxAcceleration: 36,
  brakeAcceleration: 20,
  steerRate: 1.7,
  lateralGripRate: 7,
  rollingDragRate: 0.18
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
  // Friction circle: following the new heading costs centripetal force
  // |along| * yawRate, and the tires cannot pull more than grip * 1g
  // sideways. At full speed the turning radius opens up; at low gravity
  // the car ploughs straight no matter how hard you steer.
  const requestedYawRate =
    VEHICLE_TUNING.steerRate * steerScale * grip
  const lateralBudget = grip * EARTH_GRAVITY
  const maxYawRate =
    Math.abs(along) > 1e-6 ? lateralBudget / Math.abs(along) : requestedYawRate
  state.heading +=
    input.steer * Math.min(requestedYawRate, maxYawRate) * direction * dt

  // Engine and brakes push through the tire contact patch.
  along += input.throttle * VEHICLE_TUNING.maxAcceleration * grip * dt

  if (input.brake > 0) {
    const brakeDelta = input.brake * VEHICLE_TUNING.brakeAcceleration * grip * dt
    along = Math.sign(along) * Math.max(0, Math.abs(along) - brakeDelta)
  }

  // Rolling resistance is proportional to the normal load (grip), like the
  // lateral slip below: as spin-gravity fades toward the wall speed the tyres
  // unload, drag melts with it, and momentum can carry the car to a true float.
  along *= Math.exp(-VEHICLE_TUNING.rollingDragRate * grip * dt)
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
