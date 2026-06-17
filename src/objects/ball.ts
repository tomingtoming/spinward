import * as THREE from 'three'
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat'

import type { RapierModule } from '../physics/rapierContext'
import {
  BALL_COLLISION_GROUPS,
  createRigidBodyAtRealPose,
  readRigidBodyPoseAsReal,
  scaleLengthForRapier,
  setNextKinematicTranslationFromReal,
  setRigidBodyLinvelFromReal,
  setRigidBodyTranslationFromReal
} from '../physics/rapierBoundary'
import {
  rotatingPositionToInertial,
  rotatingVelocityToInertial,
  inertialPositionToRotating,
  inertialVelocityToRotating
} from '../sim/frameTransforms'
import { collideSphereWithBuildings } from '../sim/cityCollision'
import { confineSphereToRotatingCylinder } from '../sim/cylinderCollision'
import type { CityBuildingSource } from './cityLayout'
import { computeThrowChargeRatio } from '../xr/throwCharge'
import type { GrabTarget } from '../xr/grabSystem'
import type { TrailMode } from '../app/observerMode'
import { createUnitsContext, type UnitsContext } from '../units/units'

type BallOptions = {
  physics: BallPhysicsContext
  initialPosition: THREE.Vector3
  initialVelocity?: THREE.Vector3
  radius?: number
  color?: number
  maxTrailPoints: number
  lifetimeSeconds: number
  frameAngle: number
  omega: number
  nowSeconds?: () => number
  onReleased?: (controller: THREE.XRTargetRaySpace, ball: Ball, heldSeconds: number) => void
  onBounce?: (ball: Ball, impactSpeed: number) => void
}

type BallStepConfig = {
  deltaSeconds: number
  habitatRadius: number
  habitatLength: number
  omega: number
  frameAngleEnd: number
  trailMode: TrailMode
  buildings?: CityBuildingSource
}

type BallPhysicsContext = {
  rapier: RapierModule
  world: World
  restitution: number
  units?: UnitsContext
}

const DEFAULT_HOLD_OFFSET = new THREE.Vector3(0, -0.03, -0.35)
const IDLE_COLOR = new THREE.Color(0xf59e0b)
const CHARGED_COLOR = new THREE.Color(0x67e8f9)
const IDLE_EMISSIVE = new THREE.Color(0x000000)
const HOVER_EMISSIVE = new THREE.Color(0x3a2507)
const GRABBED_EMISSIVE = new THREE.Color(0x5b3410)
const CHARGED_EMISSIVE = new THREE.Color(0x164e63)
const displayColor = new THREE.Color()
const displayEmissive = new THREE.Color()
const trailDisplayPoint = new THREE.Vector3()
const preCollisionVelocity = new THREE.Vector3()

const createTrailGeometry = (positions: Float32Array) => {
  const geometry = new THREE.BufferGeometry()
  const attribute = new THREE.BufferAttribute(positions, 3)
  attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute)
  geometry.setDrawRange(0, 0)
  return geometry
}

export class Ball {
  readonly radius: number
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  readonly inertialTrail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  readonly grabTarget: GrabTarget

  private readonly lifetimeSeconds: number
  private readonly maxTrailPoints: number
  private readonly trailPoints: THREE.Vector3[] = []
  private readonly inertialTrailPoints: THREE.Vector3[] = []
  private readonly trailPositions: Float32Array
  private readonly inertialTrailPositions: Float32Array
  private readonly onReleased?: (
    controller: THREE.XRTargetRaySpace,
    ball: Ball,
    heldSeconds: number
  ) => void
  private readonly onBounce?: (ball: Ball, impactSpeed: number) => void
  private readonly nowSeconds: () => number
  private readonly world: World
  private readonly restitution: number
  private readonly units: UnitsContext
  private readonly rigidBody: RigidBody
  private readonly inertialPosition = new THREE.Vector3()
  private readonly inertialVelocity = new THREE.Vector3()
  private readonly rotatingPosition = new THREE.Vector3()
  private readonly rotatingVelocity = new THREE.Vector3()
  private collider: Collider

  private hovered = false
  private grabbed = false
  private ageSeconds = 0
  private grabStartedAtSeconds = 0
  private releasedChargeRatio = 0
  private frameAngle: number
  private omega: number

  constructor(options: BallOptions) {
    this.radius = options.radius ?? 0.18
    this.lifetimeSeconds = options.lifetimeSeconds
    this.maxTrailPoints = options.maxTrailPoints
    this.onReleased = options.onReleased
    this.onBounce = options.onBounce
    this.nowSeconds = options.nowSeconds ?? (() => performance.now() * 0.001)
    this.world = options.physics.world
    this.restitution = options.physics.restitution
    this.units = options.physics.units ?? createUnitsContext(1)
    this.frameAngle = options.frameAngle
    this.omega = options.omega
    this.trailPositions = new Float32Array(this.maxTrailPoints * 3)
    this.inertialTrailPositions = new Float32Array(this.maxTrailPoints * 3)

    this.rotatingPosition.copy(options.initialPosition)
    rotatingPositionToInertial(this.rotatingPosition, this.frameAngle, this.inertialPosition)

    if (options.initialVelocity !== undefined) {
      this.rotatingVelocity.copy(options.initialVelocity)
      rotatingVelocityToInertial(
        this.rotatingPosition,
        this.rotatingVelocity,
        this.omega,
        this.frameAngle,
        this.inertialVelocity
      )
    }

    this.rigidBody = createRigidBodyAtRealPose(
      this.world,
      options.physics.rapier.RigidBodyDesc.dynamic()
        .setGravityScale(0)
        .setLinearDamping(0)
        .setAngularDamping(1.4)
        .lockRotations()
        .setCanSleep(false)
        .setCcdEnabled(true),
      {
        position: this.inertialPosition,
        linearVelocity: this.inertialVelocity
      },
      this.units
    )
    this.collider = this.world.createCollider(
      options.physics.rapier.ColliderDesc.ball(scaleLengthForRapier(this.radius, this.units))
        .setRestitution(options.physics.restitution)
        .setFriction(0.8)
        // Keep the solver out of ball<->building contact; balls resolve
        // buildings analytically (without this, the default all-ones groups let
        // Rapier collide them with the streamed building colliders too).
        .setCollisionGroups(BALL_COLLISION_GROUPS),
      this.rigidBody
    )

    const material = new THREE.MeshStandardMaterial({
      color: options.color ?? 0xf59e0b,
      emissive: 0x000000
    })

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 24, 24),
      material
    )
    this.mesh.position.copy(this.rotatingPosition)

    this.trail = new THREE.Line(
      createTrailGeometry(this.trailPositions),
      new THREE.LineBasicMaterial({
        color: options.color ?? 0xfbbf24,
        transparent: true,
        opacity: 0.8
      })
    )
    this.inertialTrail = new THREE.Line(
      createTrailGeometry(this.inertialTrailPositions),
      new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.72
      })
    )

    this.resetTrail()
    this.updateTrails('rotating')
    this.updateAppearance()

    this.grabTarget = {
      object: this.mesh,
      holdOffset: DEFAULT_HOLD_OFFSET,
      onHoverChange: (hovered) => {
        this.hovered = hovered
        this.updateAppearance()
      },
      onGrabStart: () => {
        this.grabbed = true
        this.grabStartedAtSeconds = this.nowSeconds()
        this.releasedChargeRatio = 0
        this.syncFromWorldPose()
        this.rotatingVelocity.set(0, 0, 0)
        this.inertialVelocity.set(0, 0, 0)
        this.rigidBody.setBodyType(options.physics.rapier.RigidBodyType.KinematicPositionBased, true)
        setRigidBodyLinvelFromReal(this.rigidBody, this.inertialVelocity, this.units, true)
        this.collider.setEnabled(false)
        this.resetTrail()
        this.updateAppearance()
      },
      onGrabEnd: (controller) => {
        this.grabbed = false
        const heldSeconds = Math.max(0, this.nowSeconds() - this.grabStartedAtSeconds)
        this.releasedChargeRatio = computeThrowChargeRatio(heldSeconds)
        this.syncFromWorldPose()
        this.resetTrail()
        setRigidBodyTranslationFromReal(this.rigidBody, this.inertialPosition, this.units, true)
        this.rigidBody.setBodyType(options.physics.rapier.RigidBodyType.Dynamic, true)
        this.collider.setEnabled(true)
        this.updateAppearance()
        this.onReleased?.(controller, this, heldSeconds)
      }
    }
  }

  get position() {
    return this.rotatingPosition
  }

  get velocity() {
    return this.rotatingVelocity
  }

  get isGrabbed() {
    return this.grabbed
  }

  isExpired() {
    return !this.grabbed && this.ageSeconds > this.lifetimeSeconds
  }

  copyInertialVelocity(target = new THREE.Vector3()) {
    return target.copy(this.inertialVelocity)
  }

  copyInertialPosition(target = new THREE.Vector3()) {
    return target.copy(this.inertialPosition)
  }

  setVelocity(nextVelocity: THREE.Vector3) {
    this.rotatingVelocity.copy(nextVelocity)
    rotatingVelocityToInertial(
      this.rotatingPosition,
      this.rotatingVelocity,
      this.omega,
      this.frameAngle,
      this.inertialVelocity
    )
    setRigidBodyLinvelFromReal(this.rigidBody, this.inertialVelocity, this.units, true)
  }

  step(config: BallStepConfig) {
    this.omega = config.omega
    this.frameAngle = config.frameAngleEnd

    if (this.grabbed) {
      this.syncFromWorldPose()
      setNextKinematicTranslationFromReal(this.rigidBody, this.inertialPosition, this.units)
      this.updateTrails(config.trailMode)
      this.updateAppearance()
      return
    }

    this.ageSeconds += config.deltaSeconds
    readRigidBodyPoseAsReal(this.rigidBody, this.units, {
      position: this.inertialPosition,
      linearVelocity: this.inertialVelocity
    })
    this.syncRenderState()
    this.applyHabitatCollision(config)
    this.updateTrails(config.trailMode)
    this.appendTrailPoint()
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh)
    this.trail.parent?.remove(this.trail)
    this.inertialTrail.parent?.remove(this.inertialTrail)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.trail.geometry.dispose()
    this.trail.material.dispose()
    this.inertialTrail.geometry.dispose()
    this.inertialTrail.material.dispose()
    this.world.removeRigidBody(this.rigidBody)
  }

  private resetTrail() {
    this.trailPoints.length = 0
    this.inertialTrailPoints.length = 0
    this.trailPoints.push(this.position.clone())
    this.inertialTrailPoints.push(this.inertialPosition.clone())
    this.syncTrailGeometry()
    this.syncInertialTrailGeometry()
  }

  private appendTrailPoint() {
    this.trailPoints.push(this.position.clone())
    this.inertialTrailPoints.push(this.inertialPosition.clone())

    while (this.trailPoints.length > this.maxTrailPoints) {
      this.trailPoints.shift()
    }

    while (this.inertialTrailPoints.length > this.maxTrailPoints) {
      this.inertialTrailPoints.shift()
    }

    this.syncTrailGeometry()
    this.syncInertialTrailGeometry()
  }

  private syncRenderState() {
    inertialPositionToRotating(this.inertialPosition, this.frameAngle, this.rotatingPosition)
    inertialVelocityToRotating(
      this.inertialPosition,
      this.inertialVelocity,
      this.omega,
      this.frameAngle,
      this.rotatingVelocity
    )
    this.mesh.position.copy(this.rotatingPosition)
  }

  private syncFromWorldPose() {
    this.mesh.updateWorldMatrix(true, false)
    this.mesh.getWorldPosition(this.rotatingPosition)
    rotatingPositionToInertial(this.rotatingPosition, this.frameAngle, this.inertialPosition)
  }

  private syncTrailGeometry() {
    this.writeTrailPoints(this.trail.geometry, this.trailPoints, this.trailPositions)
  }

  private syncInertialTrailGeometry() {
    const attribute = this.inertialTrail.geometry.getAttribute('position') as THREE.BufferAttribute

    for (let index = 0; index < this.inertialTrailPoints.length; index += 1) {
      const pointIndex = index * 3
      inertialPositionToRotating(
        this.inertialTrailPoints[index],
        this.frameAngle,
        trailDisplayPoint
      )
      this.inertialTrailPositions[pointIndex] = trailDisplayPoint.x
      this.inertialTrailPositions[pointIndex + 1] = trailDisplayPoint.y
      this.inertialTrailPositions[pointIndex + 2] = trailDisplayPoint.z
    }

    this.inertialTrail.geometry.setDrawRange(0, this.inertialTrailPoints.length)
    attribute.needsUpdate = true
    this.inertialTrail.geometry.computeBoundingSphere()
  }

  private writeTrailPoints(
    geometry: THREE.BufferGeometry,
    points: THREE.Vector3[],
    positions: Float32Array
  ) {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const pointIndex = index * 3
      positions[pointIndex] = point.x
      positions[pointIndex + 1] = point.y
      positions[pointIndex + 2] = point.z
    }

    geometry.setDrawRange(0, points.length)
    attribute.needsUpdate = true
    geometry.computeBoundingSphere()
  }

  private updateTrails(trailMode: TrailMode) {
    this.trail.visible = trailMode === 'rotating' || trailMode === 'both'
    this.inertialTrail.visible = trailMode === 'inertial' || trailMode === 'both'
  }

  private applyHabitatCollision(config: BallStepConfig) {
    preCollisionVelocity.copy(this.rotatingVelocity)
    const collidedWall = confineSphereToRotatingCylinder(this.rotatingPosition, this.rotatingVelocity, {
      radius: config.habitatRadius,
      length: config.habitatLength,
      sphereRadius: this.radius,
      restitution: this.restitution,
      omega: this.omega,
      capEnds: false
    })
    // Buildings co-rotate with the wall, so they are static obstacles in the
    // rotating frame and share the same resolve-then-write-back path.
    const collidedCity = collideSphereWithBuildings(
      this.rotatingPosition,
      this.rotatingVelocity,
      config.buildings ?? [],
      {
        habitatRadius: config.habitatRadius,
        sphereRadius: this.radius,
        restitution: this.restitution
      }
    )

    if (!collidedWall && !collidedCity) {
      return
    }

    this.onBounce?.(this, preCollisionVelocity.sub(this.rotatingVelocity).length())

    this.mesh.position.copy(this.rotatingPosition)
    rotatingPositionToInertial(this.rotatingPosition, this.frameAngle, this.inertialPosition)
    rotatingVelocityToInertial(
      this.rotatingPosition,
      this.rotatingVelocity,
      this.omega,
      this.frameAngle,
      this.inertialVelocity
    )
    setRigidBodyTranslationFromReal(this.rigidBody, this.inertialPosition, this.units, true)
    setRigidBodyLinvelFromReal(this.rigidBody, this.inertialVelocity, this.units, true)
  }

  private updateAppearance() {
    if (this.grabbed) {
      const chargeRatio = computeThrowChargeRatio(this.nowSeconds() - this.grabStartedAtSeconds)
      this.mesh.material.color.copy(displayColor.lerpColors(IDLE_COLOR, CHARGED_COLOR, chargeRatio))
      this.mesh.material.emissive.copy(
        displayEmissive.lerpColors(GRABBED_EMISSIVE, CHARGED_EMISSIVE, chargeRatio)
      )
      return
    }

    this.mesh.material.color.copy(
      displayColor.lerpColors(IDLE_COLOR, CHARGED_COLOR, this.releasedChargeRatio)
    )
    this.mesh.material.emissive.copy(this.hovered ? HOVER_EMISSIVE : IDLE_EMISSIVE)
  }
}
