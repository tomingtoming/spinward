import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

import { DesktopLookControls } from './desktopLookControls'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import {
  applyReattachAssist,
  applyPlayerTraversalState,
  createPlayerTraversalState,
  DEFAULT_REATTACH_TUNING,
  detachPlayerToFreeFly,
  disposePlayerTraversalState,
  evaluateReattachPlayer,
  getIdleLocomotionIntent,
  getPlayerTraversalRegion,
  mergeLocomotionIntent,
  syncPlayerTraversalFromPhysics,
  tryReattachPlayer,
  stepAttachedPlayer,
  stepFreeFlyPlayer
} from './playerTraversal'
import type { SurfaceRigState } from './surfaceRig'
import { Ball } from '../objects/ball'
import { CylinderHabitat } from '../objects/cylinder'
import { DockingGuide, computeDockingGuideState } from '../objects/dockingGuide'
import { ForceVectorArrows } from '../objects/forceVectors'
import { Starfield } from '../objects/starfield'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import {
  DEFAULT_HABITAT_CONFIG,
  rpmToOmega,
  surfaceGravityFromConfig
} from '../sim/habitatConfig'
import { createDebugGui } from '../ui/debugGui'
import { createHud } from '../ui/hud'
import { ControllerVelocityTracker } from '../xr/controllerVelocity'
import { GrabSystem } from '../xr/grabSystem'
import { computeThrowChargeSpeed } from '../xr/throwCharge'
import { VRLocomotion } from '../xr/vrLocomotion'

export const bootstrapApp = async () => {
  const habitatConfig = { ...DEFAULT_HABITAT_CONFIG }
  const reattachTuning = { ...DEFAULT_REATTACH_TUNING }
  const initialSurfaceState: SurfaceRigState = {
    axialPosition: 0,
    azimuth: 0
  }
  const debugVisuals = {
    showForceVectors: true,
    forceVectorScale: 0.08,
    showHud: true
  }
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x08131d)

  const habitat = new CylinderHabitat({
    radius: habitatConfig.radius,
    length: habitatConfig.length
  })
  const starfield = new Starfield({
    radius: habitatConfig.radius,
    length: habitatConfig.length
  })
  scene.add(starfield.group)
  scene.add(habitat.group)

  const playerRig = new THREE.Group()
  const viewRig = new THREE.Group()
  scene.add(playerRig)
  playerRig.add(viewRig)

  const rigBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1)
  )
  playerRig.quaternion.setFromRotationMatrix(rigBasis)

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    4000
  )
  camera.position.set(0, 1.6, 0)
  viewRig.add(camera)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  document.body.appendChild(renderer.domElement)
  document.body.appendChild(VRButton.createButton(renderer))

  const desktopLookControls = new DesktopLookControls(
    playerRig,
    camera,
    renderer.domElement
  )

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2)
  scene.add(light)

  const sun = new THREE.DirectionalLight(0xcde8ff, 0.7)
  sun.position.set(-10, 8, 6)
  scene.add(sun)

  const rapier = await initRapier()
  const physicsWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  physicsWorld.lengthUnit = 1
  physicsWorld.maxCcdSubsteps = 2
  const rotatingCylinder = createRotatingCylinderBody(rapier, physicsWorld, {
    radius: habitatConfig.radius,
    length: habitatConfig.length
  })

  const restitution = 0.55
  const balls: Ball[] = []
  const dockingGuide = new DockingGuide()
  const forceVectorArrows = new ForceVectorArrows()
  const controllerVelocity = new ControllerVelocityTracker()
  const worldForward = new THREE.Vector3()
  const worldPosition = new THREE.Vector3()
  const worldVelocity = new THREE.Vector3()
  const spawnOffset = new THREE.Vector3()
  const locomotionIntent = getIdleLocomotionIntent()
  let desktopThrowQueued = false
  let frameAngle = 0
  const playerTraversal = createPlayerTraversalState(
    initialSurfaceState,
    habitatConfig.radius,
    0,
    0,
    {
      rapier,
      world: physicsWorld
    }
  )
  let vrLocomotion: VRLocomotion | null = null

  scene.add(forceVectorArrows.group)
  scene.add(dockingGuide.group)

  const grabSystem = new GrabSystem({
    scene,
    camera,
    renderer,
    controllerRoot: viewRig,
    shouldBlockSelectStart: (controller) =>
      playerTraversal.mode === 'free-fly' && vrLocomotion?.getHandedness(controller) === 'left',
    onEmptySelectStart: (controller) => {
      const ball = spawnBall({
        origin: controller,
        releasedByController: controller
      })
      return ball.grabTarget
    }
  })

  for (const { controller } of grabSystem.getControllers()) {
    controllerVelocity.registerController(controller)
  }

  vrLocomotion = new VRLocomotion(
    grabSystem.getControllers(),
    playerRig,
    viewRig,
    camera
  )

  const syncHabitat = () => {
    habitat.setDimensions({
      radius: habitatConfig.radius,
      length: habitatConfig.length
    })
    starfield.setDimensions({
      radius: habitatConfig.radius,
      length: habitatConfig.length
    })
    camera.far = Math.max(4000, starfield.getSuggestedCameraFar())
    camera.updateProjectionMatrix()
    rotatingCylinder.rebuild({
      radius: habitatConfig.radius,
      length: habitatConfig.length
    })
    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
  }

  syncHabitat()

  const hud = createHud()

  const debugGui = createDebugGui({
    config: habitatConfig,
    reattachTuning,
    debugVisuals,
    onHabitatChange: () => {
      syncHabitat()
    },
    onVisualChange: () => {
      hud.setVisible(debugVisuals.showHud)
    }
  })
  hud.setVisible(debugVisuals.showHud)

  const spawnBall = ({
    origin,
    releasedByController
  }: {
    origin: THREE.Object3D
    releasedByController?: THREE.XRTargetRaySpace
  }) => {
    const omega = rpmToOmega(habitatConfig.rpm)

    // Balls spawn slightly in front of the hand/camera so they do not self-intersect on release.
    origin.getWorldPosition(worldPosition)
    getForwardDirection(origin, worldForward)
    spawnOffset.copy(worldForward).multiplyScalar(0.35)

    const ball = new Ball({
      physics: {
        rapier,
        world: physicsWorld,
        restitution
      },
      initialPosition: worldPosition.clone().add(spawnOffset),
      maxTrailPoints: habitatConfig.maxTrailPoints,
      lifetimeSeconds: habitatConfig.ballLifetimeSeconds,
      frameAngle,
      omega,
      onReleased: (controller, releasedBall, heldSeconds) => {
        worldVelocity.copy(controllerVelocity.getVelocity(controller))
        getForwardDirection(controller, worldForward)
        worldVelocity.addScaledVector(
          worldForward,
          computeThrowChargeSpeed(heldSeconds, habitatConfig.ballSpeedScale)
        )

        releasedBall.setVelocity(worldVelocity)
      }
    })

    if (releasedByController !== undefined) {
      ball.setVelocity(new THREE.Vector3())
    } else {
      worldVelocity.copy(worldForward).multiplyScalar(8 * habitatConfig.ballSpeedScale)
      ball.setVelocity(worldVelocity)
    }

    scene.add(ball.mesh)
    scene.add(ball.trail)
    grabSystem.registerTarget(ball.grabTarget)
    balls.push(ball)

    return ball
  }

  const removeExpiredBalls = () => {
    for (let index = balls.length - 1; index >= 0; index -= 1) {
      const ball = balls[index]

      if (!ball.isExpired()) {
        continue
      }

      grabSystem.unregisterTarget(ball.grabTarget)
      ball.dispose()
      balls.splice(index, 1)
    }
  }

  const getTrackedBall = () => {
    for (let index = balls.length - 1; index >= 0; index -= 1) {
      const ball = balls[index]

      if (!ball.isGrabbed) {
        return ball
      }
    }

    return balls.at(-1) ?? null
  }

  const throwDesktopBall = () => {
    if (renderer.xr.isPresenting) {
      return
    }

    spawnBall({ origin: camera })
  }

  const requestDesktopThrow = () => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopThrowQueued = true
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) {
      return
    }

    event.preventDefault()
    requestDesktopThrow()
  })

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return
    }

    requestDesktopThrow()
  })

  const gameLoop = new GameLoop(renderer, ({ deltaSeconds }) => {
    const omega = rpmToOmega(habitatConfig.rpm)
    const frameAngleStart = frameAngle

    const desktopIntent = desktopLookControls.update(deltaSeconds, renderer.xr.isPresenting)
    const vrIntent = vrLocomotion.update(
      deltaSeconds,
      renderer.xr.isPresenting,
      playerTraversal.mode,
      frameAngleStart
    )
    controllerVelocity.update(deltaSeconds)

    if (desktopThrowQueued) {
      desktopThrowQueued = false
      throwDesktopBall()
    }

    grabSystem.update()

    // Update order: input -> grab state -> simulation -> render.
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + omega * deltaSeconds, Math.PI * 2)
    starfield.setFrameAngle(frameAngle)
    mergeLocomotionIntent(desktopIntent, vrIntent, locomotionIntent)

    if (playerTraversal.mode === 'attached' && locomotionIntent.detachRequested) {
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: locomotionIntent.detachLaunchVelocity,
        frameAngle
      })
    } else if (playerTraversal.mode === 'attached') {
      stepAttachedPlayer(playerTraversal, {
        axisDistanceDelta: locomotionIntent.attachedAxis * 6 * deltaSeconds,
        tangentDistanceDelta: locomotionIntent.attachedTangent * 6 * deltaSeconds,
        radius: habitatConfig.radius,
        length: habitatConfig.length,
        deltaSeconds,
        omega,
        frameAngleEnd: frameAngle
      })
    } else {
      stepFreeFlyPlayer(playerTraversal, {
        thrustAcceleration: locomotionIntent.freeFlyThrust.multiplyScalar(9),
        deltaSeconds,
        frameAngleStart,
        frameAngleEnd: frameAngle,
        linearDamping: 0.7,
        brakeAmount: locomotionIntent.freeFlyBrake,
        brakeDamping: 6,
        maxSpeed: 14
      })
    }

    rotatingCylinder.syncToFrame(frameAngle)
    physicsWorld.timestep = deltaSeconds
    physicsWorld.step()
    syncPlayerTraversalFromPhysics(playerTraversal)
    const assistActive =
      playerTraversal.mode === 'free-fly'
        ? applyReattachAssist(playerTraversal, {
            ...reattachTuning,
            radius: habitatConfig.radius,
            length: habitatConfig.length,
            omega,
            frameAngle,
            deltaSeconds
          })
        : false
    const reattachStatus =
      playerTraversal.mode === 'free-fly'
        ? evaluateReattachPlayer(playerTraversal, {
            ...reattachTuning,
            radius: habitatConfig.radius,
            length: habitatConfig.length,
            omega,
            frameAngle
          })
        : null
    if (reattachStatus?.canAttach ?? false) {
      tryReattachPlayer(playerTraversal, {
        ...reattachTuning,
        radius: habitatConfig.radius,
        length: habitatConfig.length,
        omega,
        frameAngle
      })
    }
    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
    dockingGuide.update(
      computeDockingGuideState(playerTraversal, {
        radius: habitatConfig.radius,
        length: habitatConfig.length,
        frameAngle,
        ready: reattachStatus?.canAttach ?? false,
        assistActive
      })
    )

    for (const ball of balls) {
      ball.step({
        deltaSeconds,
        omega,
        frameAngleEnd: frameAngle
      })
    }

    removeExpiredBalls()
    const trackedBall = getTrackedBall()

    forceVectorArrows.update({
      ball: trackedBall,
      omega,
      scale: debugVisuals.forceVectorScale,
      visible: debugVisuals.showForceVectors
    })

    hud.update({
      radius: habitatConfig.radius,
      rpm: habitatConfig.rpm,
      gTarget: surfaceGravityFromConfig(habitatConfig),
      ballCount: balls.length,
      trackedBallSpeed: trackedBall?.velocity.length() ?? 0,
      xrActive: renderer.xr.isPresenting,
      forceVectors: debugVisuals.showForceVectors,
      region: getPlayerTraversalRegion(playerTraversal, habitatConfig.length, frameAngle),
      playerMode: playerTraversal.mode,
      reattach:
        playerTraversal.mode !== 'free-fly' || reattachStatus === null
          ? null
          : {
              radialError: reattachStatus.radialError,
              radialTolerance: reattachTuning.radialTolerance,
              normalSpeed: reattachStatus.normalSpeed,
              maxNormalSpeed: reattachTuning.maxNormalSpeed,
              surfaceSpeed: reattachStatus.surfaceSpeed,
              maxSurfaceSpeed: reattachTuning.maxSurfaceSpeed,
              assistActive,
              ready: reattachStatus.canAttach
            }
    })
    debugGui.update()
    renderer.render(scene, camera)
  })

  gameLoop.start()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  window.addEventListener('beforeunload', () => {
    desktopLookControls.dispose()
    disposePlayerTraversalState(playerTraversal)
    rotatingCylinder.dispose()
    physicsWorld.free()
    debugGui.destroy()
  })

  console.info(
    `Cylinder axis: Y, Omega: (0, ${rpmToOmega(habitatConfig.rpm).toFixed(3)}, 0), g=${surfaceGravityFromConfig(habitatConfig).toFixed(2)}`
  )
}
