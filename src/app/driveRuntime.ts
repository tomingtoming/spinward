import * as THREE from 'three'
import type { RigidBody, World } from '@dimforge/rapier3d-compat'

import type { RapierModule } from '../physics/rapierContext'
import {
  CAR_COLLISION_GROUPS,
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
  type CityBuildingSource
} from '../objects/cityLayout'
import type { UnitsContext } from '../units/units'

// The car's physics body is a sphere: the body's rotation is locked while
// "up" is radial and changes with azimuth, so an oriented box would lie
// sideways at most azimuths (and plough metres into the wall). The sphere
// hovers above the panels; radial ground-follow plays suspension.
const CAR_COLLIDER_RADIUS = 0.5
const CAR_BODY_CENTER_HEIGHT = 0.91
// Contact is "grounded" while the body center sits near its resting radius.
const GROUND_TOLERANCE = 0.6
const GROUND_FOLLOW_TIME = 0.15
const GROUND_FOLLOW_MAX_SPEED = 3
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
  lastCrashed = false
  lastGrounded = false
  lastSpeed = 0

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
        // No CCD against the rotating wall: sweeps misread the kinematic
        // panels' surface motion and clamp/bleed the car's velocity.
        .setCcdEnabled(false)
        .setEnabled(false),
      {
        position: new THREE.Vector3(),
        linearVelocity: new THREE.Vector3()
      },
      physics.units
    )
    physics.world.createCollider(
      physics.rapier.ColliderDesc.ball(
        scaleLengthForRapier(CAR_COLLIDER_RADIUS, physics.units)
      )
        // Tire grip lives in the vehicle model; keep engine friction below
        // the engine's drive accel even with two contacts at a panel seam.
        .setFriction(0.3)
        .setFrictionCombineRule(physics.rapier.CoefficientCombineRule.Min)
        .setCollisionGroups(CAR_COLLISION_GROUPS)
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
      buildings: CityBuildingSource
      units: UnitsContext
    }
  ): DriveFrame | null {
    if (!this.driving || this.body === null) {
      return null
    }

    // Pre-step pose corresponds to the frame angle BEFORE this frame's
    // advance; converting with the end angle skews the azimuth by omega*dt.
    const frameAngleStart = config.frameAngle - config.omega * config.deltaSeconds

    readRigidBodyPoseAsReal(this.body, config.units, {
      position: inertialPosition,
      linearVelocity: inertialVelocity
    })
    inertialPositionToRotating(inertialPosition, frameAngleStart, rotatingPosition)
    inertialVelocityToRotating(
      inertialPosition,
      inertialVelocity,
      config.omega,
      frameAngleStart,
      rotatingVelocity
    )

    const azimuth = Math.atan2(rotatingPosition.z, rotatingPosition.x)
    const radialDistance = Math.hypot(rotatingPosition.x, rotatingPosition.z)
    const restingRadial = config.radius - CAR_BODY_CENTER_HEIGHT
    const grounded = Math.abs(radialDistance - restingRadial) <= GROUND_TOLERANCE

    surfaceOutward.set(Math.cos(azimuth), 0, Math.sin(azimuth))
    surfaceTangent.set(-Math.sin(azimuth), 0, Math.cos(azimuth))

    // The wheels are pressed down by the CAR's own centripetal acceleration,
    // not the habitat's nominal one: drive against the spin and the grip
    // melts away with your inertial speed (transport is along -tangent, so
    // the inertial tangential speed is T - omega*r).
    const inertialTangentSpeed =
      rotatingVelocity.dot(surfaceTangent) - config.omega * radialDistance
    const effectiveGravity =
      (inertialTangentSpeed * inertialTangentSpeed) / Math.max(radialDistance, 1e-6)

    stepVehicleDynamics(
      this,
      rotatingVelocity,
      { axial: surfaceAxial, tangent: surfaceTangent, outward: surfaceOutward },
      input,
      {
        deltaSeconds: config.deltaSeconds,
        surfaceGravity: effectiveGravity,
        grounded
      }
    )

    // Suspension: hold the body on the analytic surface so panel seams and
    // soft-contact bias never lift or shake the car. Pushing up is the
    // springs' job and stays unrestricted; settling down is gravity's and
    // is capped by the effective g.
    if (grounded) {
      const radialVelocity = rotatingVelocity.dot(surfaceOutward)
      const maxSettleSpeed = Math.min(
        GROUND_FOLLOW_MAX_SPEED,
        effectiveGravity * GROUND_FOLLOW_TIME * 3
      )
      const followVelocity = THREE.MathUtils.clamp(
        (restingRadial - radialDistance) / GROUND_FOLLOW_TIME,
        -GROUND_FOLLOW_MAX_SPEED,
        maxSettleSpeed
      )
      rotatingVelocity.addScaledVector(surfaceOutward, followVelocity - radialVelocity)
    }

    // Building crash: push the footprint out, kill the velocity component
    // driving into the wall, and keep the slide along it (with a scrape).
    this.surface.azimuth = azimuth
    this.surface.axialPosition = rotatingPosition.y
    this.lastCrashed = false
    this.lastGrounded = grounded
    this.lastSpeed = rotatingVelocity.length()

    if (
      resolveCitySurfaceCollision(this.surface, config.buildings, config.radius, 1.3)
    ) {
      this.lastCrashed = true
      const pushTangent = wrapDelta(this.surface.azimuth - azimuth) * config.radius
      const pushAxial = this.surface.axialPosition - rotatingPosition.y
      const pushLength = Math.hypot(pushTangent, pushAxial)

      if (pushLength > 1e-9) {
        const normalTangent = pushTangent / pushLength
        const normalAxial = pushAxial / pushLength
        const intoWall =
          rotatingVelocity.dot(surfaceTangent) * normalTangent +
          rotatingVelocity.y * normalAxial

        if (intoWall < 0) {
          rotatingVelocity.addScaledVector(surfaceTangent, -intoWall * normalTangent)
          rotatingVelocity.y += -intoWall * normalAxial
        }

        rotatingVelocity.multiplyScalar(0.9)
      }

      const cos = Math.cos(this.surface.azimuth)
      const sin = Math.sin(this.surface.azimuth)
      rotatingPosition.set(
        cos * radialDistance,
        this.surface.axialPosition,
        sin * radialDistance
      )
      rotatingPositionToInertial(rotatingPosition, frameAngleStart, inertialPosition)
      setRigidBodyTranslationFromReal(this.body, inertialPosition, config.units, true)
    }

    rotatingVelocityToInertial(
      rotatingPosition,
      rotatingVelocity,
      config.omega,
      frameAngleStart,
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
