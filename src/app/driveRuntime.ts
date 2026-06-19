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
import type { UnitsContext } from '../units/units'

// The car's physics body is a sphere: the body's rotation is locked while
// "up" is radial and changes with azimuth, so an oriented box would lie
// sideways at most azimuths (and plough metres into the wall). The sphere
// rests on the wall panels via real Rapier contact at every azimuth, its
// center one collider radius inside the inner face (P3 removed the analytic
// suspension, so this radius is also where it settles and is seated on entry).
const CAR_COLLIDER_RADIUS = 0.5
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
  lastCrashed = false
  lastGrounded = false
  lastSpeed = 0
  lastRadialGap = 0
  lastContacts = 0
  // The car's velocity in the rotating (colony) frame after the last step — a
  // dismounting walker carries it so stepping out of a moving car keeps momentum.
  readonly lastRotatingVelocity = new THREE.Vector3()
  // The body's measured inertial pose after the last settled step — the felt-G
  // accelerometer in the app loop differences the velocity and projects the
  // proper acceleration onto the radial "down" given by the position.
  readonly lastInertialVelocity = new THREE.Vector3()
  readonly lastInertialPosition = new THREE.Vector3()

  private body: RigidBody | null = null
  private world: World | null = null
  // Previous frame's planar speed, to spot a crash as a hard one-frame drop.
  private prevPlanarSpeed = 0

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
    this.prevPlanarSpeed = 0
    const cos = Math.cos(this.surface.azimuth)
    const sin = Math.sin(this.surface.azimuth)
    rotatingPosition
      .set(cos, 0, sin)
      .multiplyScalar(radius - CAR_COLLIDER_RADIUS)
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
    const restingRadial = config.radius - CAR_COLLIDER_RADIUS
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

    // No suspension: the radial axis belongs to Rapier's contact with the
    // spinning wall (P0/seam tests show the panel ring holds the car at ~1g
    // and never launches it across seams up to 150 m/s relative). The tire
    // model already leaves the radial component untouched, so grounding and
    // the felt-G now emerge from the real normal force — drive against the
    // spin and the wheels genuinely unload toward a float. Past the cylinder
    // end there is no panel, so the car simply falls off instead of riding an
    // infinite wall. Buildings are still analytic boxes (P1), handled below.
    // (The near-float felt-G jitter from the soft contact is smoothed in the
    // readout, not in the physics — see the driving accelerometer time constant.)

    // Building crash: push the footprint out, kill the velocity component
    // driving into the wall, and keep the slide along it (with a scrape).
    this.surface.azimuth = azimuth
    this.surface.axialPosition = rotatingPosition.y
    this.lastGrounded = grounded
    // Report the in-plane driving speed only: the radial axis is real contact
    // now, so its small settling wobble must not flicker the speedometer.
    const radialSpeed = rotatingVelocity.dot(surfaceOutward)
    this.lastSpeed = Math.sqrt(
      Math.max(0, rotatingVelocity.lengthSq() - radialSpeed * radialSpeed)
    )
    // Crash haptic from a hard one-frame deceleration — a real building hit
    // resolved by Rapier contact last step. Braking is far gentler (well under
    // 1 m/s per frame), so it never trips this.
    this.lastCrashed = this.prevPlanarSpeed - this.lastSpeed > 5
    this.prevPlanarSpeed = this.lastSpeed
    this.lastRadialGap = config.radius - radialDistance
    this.lastContacts = 0
    {
      const body = this.body as unknown as {
        numColliders(): number
        collider(index: number): unknown
      }
      const world = this.world as unknown as {
        contactPairsWith(collider: unknown, callback: () => void): void
      } | null

      if (world !== null) {
        for (let index = 0; index < body.numColliders(); index += 1) {
          world.contactPairsWith(body.collider(index), () => {
            this.lastContacts += 1
          })
        }
      }
    }

    // Buildings are real co-rotating Rapier colliders now (P1, streamed near
    // the car): the world step stops the car against them, so the old analytic
    // footprint pushout is gone. Only the tangential tire velocity is written
    // back below; the building normal force lives in the solver.

    this.lastRotatingVelocity.copy(rotatingVelocity)
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
    this.lastInertialVelocity.copy(inertialVelocity)
    this.lastInertialPosition.copy(inertialPosition)
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
