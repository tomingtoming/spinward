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
import { computeEarthGhostPath } from '../gameplay/earthGhost'
import { createUnitsContext, type UnitsContext } from '../units/units'

type BallOptions = {
  physics: BallPhysicsContext
  initialPosition: THREE.Vector3
  initialVelocity?: THREE.Vector3
  radius?: number
  color?: number
  maxTrailPoints: number
  // Draw the flat-Earth ghost (gameplay/earthGhost.ts) on the first real
  // release: the parabola this throw would follow without the spin. Needs
  // the floor radius the ghost lands on. Absent = no ghost (bolts, fireworks).
  earthGhost?: { floorRadius: number }
  lifetimeSeconds: number
  frameAngle: number
  omega: number
  // A constant emissive colour for fire-and-forget glowing bolts (beam/firework);
  // omitted for the plain ball, whose appearance follows the charge/hover state.
  emissive?: number
  // Burst-and-despawn on the first wall/building hit instead of bouncing.
  explodeOnImpact?: boolean
  // Render as an elongated glowing bolt of this length, oriented to the velocity,
  // instead of a sphere. Used by the beam rifle.
  boltLength?: number
  // Unit aim direction used purely to orient a bolt mesh before its first step
  // (does NOT set physics velocity — keep separate from initialVelocity).
  initialAim?: THREE.Vector3
  // Whether this projectile is confined by / bursts on the colony inner wall and
  // city buildings. False for shots fired from the Exterior vantage (r ≈ 1.6×
  // radius): the inner-wall confine is an infinite cylinder with no inside/outside
  // gate and would otherwise teleport them onto the inner wall (hiding balls,
  // bursting bolts) on their first step. Defaults true so interior callers are
  // unchanged.
  confineToHabitat?: boolean
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
const ghostInward = new THREE.Vector3()
const ghostUp = new THREE.Vector3(0, 0, 1)
const preCollisionVelocity = new THREE.Vector3()
// The capsule's long axis; bolts orient this toward their velocity.
const BOLT_AXIS = new THREE.Vector3(0, 1, 0)
const boltDir = new THREE.Vector3()
// Sub-metre floor for the drawn bolt length so the residual streak at the spawn
// instant (before it has flown any distance) is < 1 m, not the full ~400 m.
const MIN_BOLT_DRAW = 0.5

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
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  readonly inertialTrail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  // The Earth-intuition ghost, dashed and static in the rotating frame; null
  // for projectile kinds that don't teach the curve.
  readonly earthGhost: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial> | null
  private ghostArmed = false
  private readonly ghostFloorRadius: number
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
  private readonly explodeOnImpact: boolean
  private readonly glowColor: THREE.Color | null
  private readonly glowEmissive: THREE.Color | null
  private readonly boltLength: number | null
  // Muzzle anchor (frame-invariant inertial position at spawn). The DRAWN bolt
  // length is clamped to how far it has flown from here, so the body grows
  // forward from the muzzle instead of trailing its full length back through the
  // shooter at t≈0.
  private readonly boltSpawnInertial = new THREE.Vector3()
  private readonly confineToHabitat: boolean
  private exploded = false

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
    this.explodeOnImpact = options.explodeOnImpact ?? false
    this.glowColor =
      options.emissive !== undefined ? new THREE.Color(options.color ?? 0xffffff) : null
    this.glowEmissive = options.emissive !== undefined ? new THREE.Color(options.emissive) : null
    this.boltLength = options.boltLength ?? null
    this.confineToHabitat = options.confineToHabitat ?? true
    this.trailPositions = new Float32Array(this.maxTrailPoints * 3)
    this.inertialTrailPositions = new Float32Array(this.maxTrailPoints * 3)

    this.rotatingPosition.copy(options.initialPosition)
    rotatingPositionToInertial(this.rotatingPosition, this.frameAngle, this.inertialPosition)
    this.boltSpawnInertial.copy(this.inertialPosition)

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

    // A bolt is a capsule stretched along its travel axis (everything else is a
    // plain sphere). Shift it so the leading +Y tip sits at the origin: the bolt
    // then trails BACK from its collision point (orientToVelocity aligns +Y to
    // the velocity), so a long beam streaks behind its impact instead of poking
    // hundreds of metres past whatever it hits.
    let geometry: THREE.BufferGeometry
    if (this.boltLength !== null) {
      geometry = new THREE.CapsuleGeometry(this.radius, this.boltLength, 6, 16)
      geometry.translate(0, -(this.boltLength / 2 + this.radius), 0)
    } else {
      geometry = new THREE.SphereGeometry(this.radius, 24, 24)
    }
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.copy(this.rotatingPosition)
    if (this.boltLength !== null) {
      // Start as a sub-metre stub so a bolt rendered before its first step never
      // flashes at full length through the shooter; orientToVelocity grows it.
      this.mesh.scale.set(1, MIN_BOLT_DRAW / this.boltLength, 1)
      // Orient to the known aim immediately so the stub points down the shot axis
      // on frame 0 instead of standing vertically (+Y) at the muzzle. Same
      // BOLT_AXIS(+Y) convention as orientToVelocity, so the tip stays at the spawn.
      if (options.initialAim !== undefined && options.initialAim.lengthSq() > 1e-6) {
        this.mesh.quaternion.setFromUnitVectors(
          BOLT_AXIS,
          boltDir.copy(options.initialAim).normalize()
        )
      }
    }

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

    this.ghostFloorRadius = options.earthGhost?.floorRadius ?? 0
    this.earthGhost =
      options.earthGhost !== undefined
        ? new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineDashedMaterial({
              color: 0xffffff,
              transparent: true,
              opacity: 0.85,
              dashSize: 1.0,
              gapSize: 0.7,
              depthWrite: false
            })
          )
        : null
    if (this.earthGhost !== null) {
      this.earthGhost.visible = false
      this.earthGhost.frustumCulled = false
      // Landing ring: where Earth intuition says the ball comes down. The
      // ball's real landing sits beside it — that gap is the lesson.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.26, 0.42, 28),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      ring.name = 'earth-ghost-landing'
      this.earthGhost.add(ring)
    }

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
    return this.exploded || (!this.grabbed && this.ageSeconds > this.lifetimeSeconds)
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
    this.armEarthGhost()
  }

  // Draw the ghost once, on the first release with real speed (a VR grab
  // parks the ball at rest first; a tap throw releases at ≥ 8 m/s). Static
  // afterwards: it is the counterfactual for THIS release, not a tracker.
  private armEarthGhost() {
    if (this.earthGhost === null || this.ghostArmed || this.rotatingVelocity.lengthSq() < 1) {
      return
    }
    const path = computeEarthGhostPath(
      this.rotatingPosition,
      this.rotatingVelocity,
      this.omega,
      this.ghostFloorRadius
    )
    if (path.length < 2) {
      return
    }
    const positions = new Float32Array(path.length * 3)
    path.forEach((point, index) => point.toArray(positions, index * 3))
    this.earthGhost.geometry.dispose()
    this.earthGhost.geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    )
    this.earthGhost.computeLineDistances()
    // Seat the landing ring on the real floor at the ghost's end azimuth
    // (a long flat-Earth throw ends a little inside the curved wall).
    const landing = path[path.length - 1].clone()
    const radial = Math.hypot(landing.x, landing.z)
    if (radial > 1e-6) {
      const onFloor = (this.ghostFloorRadius - 0.06) / radial
      landing.x *= onFloor
      landing.z *= onFloor
    }
    const ring = this.earthGhost.getObjectByName('earth-ghost-landing')
    if (ring !== undefined) {
      ring.position.copy(landing)
      ghostInward.set(-landing.x, 0, -landing.z).normalize()
      ring.quaternion.setFromUnitVectors(ghostUp, ghostInward)
    }
    this.earthGhost.visible = true
    this.ghostArmed = true
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
    this.orientToVelocity()
  }

  // Point a bolt along its travel direction AND grow it forward from the muzzle
  // (no-op for spheres). The capsule's +Y tip is pinned at local y=0 (= mesh
  // origin = rigid-body / collision point), so scaling scale.y about the origin
  // keeps the tip fixed and pulls the tail toward it: the drawn body spans
  // muzzle→tip and only reaches full boltLength once the bolt has actually flown
  // boltLength metres (~0.04 s), instead of trailing its whole length back
  // through the shooter at t≈0.
  private orientToVelocity() {
    if (this.boltLength === null) {
      return
    }
    boltDir.copy(this.rotatingVelocity)
    if (boltDir.lengthSq() < 1e-6) {
      return
    }
    this.mesh.quaternion.setFromUnitVectors(BOLT_AXIS, boltDir.normalize())

    // Frame-invariant chord from the muzzle (curvature over 400 m / 0.04 s is
    // negligible, so chord ≈ path length). x/z stay at 1 so the cross-section
    // (thickness) is untouched — only the length compresses.
    const travelled = this.inertialPosition.distanceTo(this.boltSpawnInertial)
    const drawn = Math.max(MIN_BOLT_DRAW, Math.min(this.boltLength, travelled))
    this.mesh.scale.set(1, drawn / this.boltLength, 1)
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh)
    this.trail.parent?.remove(this.trail)
    this.inertialTrail.parent?.remove(this.inertialTrail)
    if (this.earthGhost !== null) {
      this.earthGhost.parent?.remove(this.earthGhost)
      this.earthGhost.geometry.dispose()
      this.earthGhost.material.dispose()
      const ring = this.earthGhost.getObjectByName('earth-ghost-landing') as
        | THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
        | undefined
      ring?.geometry.dispose()
      ring?.material.dispose()
    }
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
    // Exterior-spawned shots (r ≈ 1.6× radius) are not confined: the infinite-
    // cylinder inner-wall confine has no inside/outside gate and would teleport
    // them onto the inner wall — bursting bolts and hiding balls — on step 1. They
    // currently fly straight through the hull (an outer-hull burst is a separate,
    // deferred enhancement); this guard only restores their visibility.
    if (!this.confineToHabitat) {
      return
    }
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

    // Glowing bolts burst on contact instead of bouncing: the FX is spawned by
    // the onBounce handler above; here we just mark it spent so it despawns.
    if (this.explodeOnImpact) {
      this.exploded = true
    }

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

    // Fire-and-forget bolts glow with a fixed colour rather than the ball's
    // charge/hover tinting.
    if (this.glowEmissive !== null && this.glowColor !== null) {
      this.mesh.material.color.copy(this.glowColor)
      this.mesh.material.emissive.copy(this.glowEmissive)
      return
    }

    this.mesh.material.color.copy(
      displayColor.lerpColors(IDLE_COLOR, CHARGED_COLOR, this.releasedChargeRatio)
    )
    this.mesh.material.emissive.copy(this.hovered ? HOVER_EMISSIVE : IDLE_EMISSIVE)
  }
}
