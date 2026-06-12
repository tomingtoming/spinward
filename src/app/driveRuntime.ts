import * as THREE from 'three'
import type { RigidBody, World } from '@dimforge/rapier3d-compat'

import type { RapierModule } from '../physics/rapierContext'
import {
  createRigidBodyAtRealPose,
  readRigidBodyPoseAsReal,
  scaleLengthForRapier,
  setRigidBodyLinvelFromReal,
  setRigidBodyTranslationFromReal
} from '../physics/rapierBoundary'
import {
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from '../sim/frameTransforms'
import {
  stepVehicleDynamics,
  type VehicleInput
} from '../gameplay/vehicle'
import {
  resolveCitySurfaceCollision,
  type CityBuilding
} from '../objects/cityLayout'
import type { UnitsContext } from '../units/units'

// The car body's collider: a low box riding on the rotating wall panels.
const CAR_HALF_EXTENTS = new THREE.Vector3(0.95, 0.55, 2.1)
const CAR_BODY_CENTER_HEIGHT = 0.91
// Contact is "grounded" while the body center sits near its resting radius.
const GROUND_TOLERANCE = 0.6
const ENTER_DISTANCE = 6

export type DrivePhysicsContext = {
  rapier: RapierModule
  world: World
  units: UnitsContext
}

export type DriveFrame = {
  azimuth: number
  axialPosition: number
  heading: number
  grounded: boolean
  speed: number
}

const rotatingPosition = new THREE.Vector3()
const rotatingVelocity = new THREE.Vector3()
const inertialPosition = new THREE.Vector3()
const inertialVelocity = new THREE.Vector3()
const surfaceAxial = new THREE.Vector3(0, 1, 0)
const surfaceTangent = new THREE.Vector3()
const surfaceOutward = new THREE.Vector3()
const wrapDelta = (angle: number) => {
  const wrapped = THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
  return wrapped
}

export class DriveRuntime {
  driving = false
  readonly surface = { azimuth: 0, axialPosition: 0 }
  heading = 0

  private body: RigidBody | null = null
  private world: World | null = null

  // (Re)creates the physics body — call on boot and whenever the habitat
  // (and therefore the sim scale) is rebuilt.
  rebuild(physics: DrivePhysicsContext) {
    if (this.body !== null && this.world !== null && this.body.isValid()) {
      this.world.removeRigidBody(this.body)
    }

    this.world = physics.world
    this.driving = false
    this.body = createRigidBodyAtRealPose(
      physics.world,
      physics.rapier.RigidBodyDesc.dynamic()
        .setGravityScale(0)
        .setLinearDamping(0)
        .lockRotations()
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setEnabled(false),
      {
        position: new THREE.Vector3(),
        linearVelocity: new THREE.Vector3()
      },
      physics.units
    )
    physics.world.createCollider(
      physics.rapier.ColliderDesc.cuboid(
        scaleLengthForRapier(CAR_HALF_EXTENTS.x, physics.units),
        scaleLengthForRapier(CAR_HALF_EXTENTS.y, physics.units),
        scaleLengthForRapier(CAR_HALF_EXTENTS.z, physics.units)
      )
        .setTranslation(0, 0, 0)
        .setFriction(1.1)
        .setDensity(0.6)
        .setRestitution(0.05),
      this.body
    )
  }

  parkAt(azimuth: number, axialPosition: number, heading: number) {
    this.driving = false
    this.surface.azimuth = azimuth
    this.surface.axialPosition = axialPosition
    this.heading = heading
    this.body?.setEnabled(false)
  }

  isPlayerNear(playerAzimuth: number, playerAxial: number, radius: number) {
    const tangentDistance = Math.abs(wrapDelta(playerAzimuth - this.surface.azimuth)) * radius
    const axialDistance = Math.abs(playerAxial - this.surface.axialPosition)
    return Math.hypot(tangentDistance, axialDistance) <= ENTER_DISTANCE
  }

  enter(frameAngle: number, omega: number, radius: number, physics: DrivePhysicsContext) {
    if (this.body === null) {
      return
    }

    this.driving = true
    const cos = Math.cos(this.surface.azimuth)
    const sin = Math.sin(this.surface.azimuth)
    rotatingPosition
      .set(cos, 0, sin)
      .multiplyScalar(radius - CAR_BODY_CENTER_HEIGHT)
      .setY(this.surface.axialPosition)
    rotatingPositionToInertial(rotatingPosition, frameAngle, inertialPosition)
    rotatingVelocity.set(0, 0, 0)
    rotatingVelocityToInertial(
      rotatingPosition,
      rotatingVelocity,
      omega,
      frameAngle,
      inertialVelocity
    )
    setRigidBodyTranslationFromReal(this.body, inertialPosition, physics.units, true)
    setRigidBodyLinvelFromReal(this.body, inertialVelocity, physics.units, true)
    this.body.setEnabled(true)
  }

  exit() {
    this.driving = false
    this.body?.setEnabled(false)
  }

  // Before the physics step: apply tire forces in the rotating frame.
  preStep(
    input: VehicleInput,
    config: {
      deltaSeconds: number
      frameAngle: number
      omega: number
      radius: number
      surfaceGravity: number
      buildings: readonly CityBuilding[]
      units: UnitsContext
    }
  ): DriveFrame | null {
    if (!this.driving || this.body === null) {
      return null
    }

    readRigidBodyPoseAsReal(this.body, config.units, {
      position: inertialPosition,
      linearVelocity: inertialVelocity
    })
    inertialPositionToRotating(inertialPosition, config.frameAngle, rotatingPosition)
    inertialVelocityToRotating(
      inertialPosition,
      inertialVelocity,
      config.omega,
      config.frameAngle,
      rotatingVelocity
    )

    const azimuth = Math.atan2(rotatingPosition.z, rotatingPosition.x)
    const radialDistance = Math.hypot(rotatingPosition.x, rotatingPosition.z)
    const restingRadial = config.radius - CAR_BODY_CENTER_HEIGHT
    const grounded = Math.abs(radialDistance - restingRadial) <= GROUND_TOLERANCE

    surfaceOutward.set(Math.cos(azimuth), 0, Math.sin(azimuth))
    surfaceTangent.set(-Math.sin(azimuth), 0, Math.cos(azimuth))

    stepVehicleDynamics(
      this,
      rotatingVelocity,
      { axial: surfaceAxial, tangent: surfaceTangent, outward: surfaceOutward },
      input,
      {
        deltaSeconds: config.deltaSeconds,
        surfaceGravity: config.surfaceGravity,
        grounded
      }
    )

    // Crude building crash: push the footprint out and bleed speed.
    this.surface.azimuth = azimuth
    this.surface.axialPosition = rotatingPosition.y

    if (
      resolveCitySurfaceCollision(this.surface, config.buildings, config.radius, 1.3)
    ) {
      const cos = Math.cos(this.surface.azimuth)
      const sin = Math.sin(this.surface.azimuth)
      rotatingPosition.set(
        cos * radialDistance,
        this.surface.axialPosition,
        sin * radialDistance
      )
      rotatingVelocity.multiplyScalar(0.4)
      rotatingPositionToInertial(rotatingPosition, config.frameAngle, inertialPosition)
      setRigidBodyTranslationFromReal(this.body, inertialPosition, config.units, true)
    }

    rotatingVelocityToInertial(
      rotatingPosition,
      rotatingVelocity,
      config.omega,
      config.frameAngle,
      inertialVelocity
    )
    setRigidBodyLinvelFromReal(this.body, inertialVelocity, config.units, true)

    return {
      azimuth: this.surface.azimuth,
      axialPosition: this.surface.axialPosition,
      heading: this.heading,
      grounded,
      speed: rotatingVelocity.length()
    }
  }

  // After the physics step: read the settled pose for rendering.
  postStep(config: { frameAngle: number; units: UnitsContext }): DriveFrame | null {
    if (!this.driving || this.body === null) {
      return null
    }

    readRigidBodyPoseAsReal(this.body, config.units, {
      position: inertialPosition,
      linearVelocity: inertialVelocity
    })
    inertialPositionToRotating(inertialPosition, config.frameAngle, rotatingPosition)
    this.surface.azimuth = Math.atan2(rotatingPosition.z, rotatingPosition.x)
    this.surface.axialPosition = rotatingPosition.y

    return {
      azimuth: this.surface.azimuth,
      axialPosition: this.surface.axialPosition,
      heading: this.heading,
      grounded: true,
      speed: 0
    }
  }

  // Rig orientation for the driver camera: forward along the heading, up
  // toward the axis.
  getRigQuaternion(target: THREE.Quaternion) {
    const cos = Math.cos(this.surface.azimuth)
    const sin = Math.sin(this.surface.azimuth)
    surfaceOutward.set(cos, 0, sin)
    surfaceTangent.set(-sin, 0, cos)

    const forward = new THREE.Vector3()
      .copy(surfaceAxial)
      .multiplyScalar(Math.cos(this.heading))
      .addScaledVector(surfaceTangent, Math.sin(this.heading))
    const up = surfaceOutward.clone().multiplyScalar(-1)
    const backward = forward.clone().multiplyScalar(-1)
    const right = new THREE.Vector3().crossVectors(up, backward)
    const basis = new THREE.Matrix4().makeBasis(right, up, backward)
    return target.setFromRotationMatrix(basis)
  }

  dispose() {
    if (this.body !== null && this.world !== null && this.body.isValid()) {
      this.world.removeRigidBody(this.body)
    }

    this.body = null
  }
}
