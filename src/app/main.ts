import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

import {
  computeInertialObserverPose,
  getDisplayRootRotation,
  getEffectiveObserverMode
} from './observerMode'
import { clearBalls, getTrackedBall, removeExpiredBalls } from './ballCollection'
import { DesktopLookControls } from './desktopLookControls'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import {
  DEFAULT_DAY_NIGHT_CYCLE_SECONDS,
  INITIAL_DAY_NIGHT_PHASE,
  getDaylight,
  stepDayNightPhase
} from './dayNight'
import { syncHabitatRuntime } from './habitatRuntime'
import {
  applyPlayerTraversalState,
  createPlayerTraversalState,
  detachPlayerToFreeFly,
  disposePlayerTraversalState,
  evaluateReattachPlayer,
  getIdleLocomotionIntent,
  getPlayerTraversalRegion,
  mergeLocomotionIntent,
  syncPlayerTraversalFromPhysics,
  stepAttachedPlayer,
  stepFreeFlyPlayer,
  tryReattachPlayer
} from './playerTraversal'
import {
  rebuildPlayerTraversalRuntime,
  respawnPlayerAxisEndRuntime,
  respawnPlayerInnerWallRuntime,
  respawnPlayerOverlookRuntime
} from './playerRespawnRuntime'
import {
  createTourGuideState,
  notifyTourEvent,
  stepTourGuide
} from './tourGuide'
import { getSurfacePosition, type SurfaceRigState } from './surfaceRig'
import { Ball } from '../objects/ball'
import { Clouds } from '../objects/clouds'
import { getWindowStripArcs, resolveCitySurfaceCollision } from '../objects/cityLayout'
import { Cityscape } from '../objects/cityscape'
import { CylinderHabitat } from '../objects/cylinder'
import { DockingGuide, computeDockingGuideState } from '../objects/dockingGuide'
import { ForceVectorArrows } from '../objects/forceVectors'
import { Starfield } from '../objects/starfield'
import { MobileControls, isTouchDevice } from '../pc/mobileControls'
import { PcQuickPanel } from '../pc/pcQuickPanel'
import {
  JUMP_SPEED,
  beginJump,
  computeJumpLaunchVelocity,
  createJumpState,
  resetJumpState,
  stepJumpState
} from '../gameplay/jump'
import { respawnAxisEnd, respawnInnerWall, respawnOverlook } from '../gameplay/respawn'
import { computeThrowVelocityReal } from '../gameplay/throwVelocity'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { applyPresetToSettingsStore, getPresetById, getPresetName } from '../presets/presetManager'
import { computeFrameVerification } from '../sim/frameVerification'
import { inertialPositionToRotating, inertialVelocityToRotating } from '../sim/frameTransforms'
import { getHabitatSpan } from '../sim/habitatConfig'
import { createSettingsStore } from '../state/settingsStore'
import { createDebugGui } from '../ui/debugGui'
import { createHud } from '../ui/hud'
import { TourCardPanel } from '../ui/tourCardPanel'
import { applyWatchAction, createWatchRenderSnapshot } from '../ui/watch/watchBindings'
import { WatchPanel } from '../ui/watch/watchPanel'
import type { WatchActionId } from '../ui/watch/watchLayout'
import { resolveRuntimeWatchAction } from './watchActionRouting'
import { createUnitsContext, rpmToOmega } from '../units/units'
import { ControllerVelocityTracker } from '../xr/controllerVelocity'
import { GrabSystem } from '../xr/grabSystem'
import { LaserPointer } from '../xr/laserPointer'
import { VRLocomotion } from '../xr/vrLocomotion'
import { XRInputMap } from '../xr/xrInputMap'

export const bootstrapApp = async () => {
  const settingsStore = createSettingsStore()
  // The demo opens at Izma scale; Playground stays one preset tap away for
  // close-range physics play. `?preset=` deep-links any preset for testing
  // and sharing.
  const requestedPreset = new URLSearchParams(window.location.search).get('preset')
  applyPresetToSettingsStore(
    settingsStore,
    requestedPreset !== null && getPresetById(requestedPreset) !== null
      ? requestedPreset
      : 'izma'
  )
  const habitatConfig = settingsStore.habitat
  const reattachTuning = settingsStore.reattach
  const initialSurfaceState: SurfaceRigState = {
    axialPosition: 0,
    azimuth: 0
  }
  const debugVisuals = {
    showForceVectors: true,
    forceVectorScale: 0.08,
    showHud: true,
    observerMode: 'colony-fixed' as const,
    trailMode: 'rotating' as const,
    verificationErrorThreshold: 4,
    dayNightCycleSeconds: DEFAULT_DAY_NIGHT_CYCLE_SECONDS
  }
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x08131d)
  // Aero perspective: the far side of town fades into a light haze. Density
  // is rescaled to the habitat radius in syncHabitat.
  const fog = new THREE.FogExp2(0x5f7587, 0.02)
  scene.fog = fog
  const fogDayColor = new THREE.Color(0x5f7587)
  const fogNightColor = new THREE.Color(0x1b2530)
  const backgroundDayColor = new THREE.Color(0x08131d)
  const backgroundNightColor = new THREE.Color(0x040810)
  let dayNightPhase = INITIAL_DAY_NIGHT_PHASE
  const worldRoot = new THREE.Group()
  const skyLayer = new THREE.Group()
  const farLayer = new THREE.Group()
  const nearLayer = new THREE.Group()
  scene.add(worldRoot)
  worldRoot.add(skyLayer, farLayer, nearLayer)

  const habitat = new CylinderHabitat({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  const cityscape = new Cityscape({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  const clouds = new Clouds({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  const starfield = new Starfield({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  skyLayer.add(starfield.group)
  nearLayer.add(habitat.group)
  nearLayer.add(cityscape.group)
  nearLayer.add(clouds.group)

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

  const tourGuide = createTourGuideState()
  const tourCardPanel = new TourCardPanel()
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    4000
  )
  const inertialObserverCamera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    4000
  )
  camera.position.set(0, 1.6, 0)
  viewRig.add(camera)
  scene.add(tourCardPanel.mesh)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
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
  const mobileControls = isTouchDevice()
    ? new MobileControls(camera, renderer.domElement, {
        onThrow: () => requestDesktopThrow(),
        onJump: () => {
          desktopJumpQueued = true
        },
        onTravel: (target) =>
          handleWatchAction(
            target === 'surface'
              ? 'respawn-inner-wall'
              : target === 'overlook'
                ? 'respawn-overlook'
                : 'respawn-axis-end'
          )
      })
    : null

  const light = new THREE.HemisphereLight(0xdfeeff, 0x33404e, 1.1)
  scene.add(light)

  // Sunlight enters through the three window strips: one directional light
  // per strip, pointing inward from the window's center azimuth. They live in
  // nearLayer so they stay colony-fixed under the inertial observer mode.
  const windowSuns: THREE.DirectionalLight[] = []

  for (const arc of getWindowStripArcs()) {
    const windowSun = new THREE.DirectionalLight(0xfff2dd, 1.3)
    windowSun.position.set(
      Math.cos(arc.centerAzimuth) * 10,
      0,
      Math.sin(arc.centerAzimuth) * 10
    )
    nearLayer.add(windowSun)
    nearLayer.add(windowSun.target)
    windowSuns.push(windowSun)
  }

  const rapier = await initRapier()
  const physicsWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  physicsWorld.lengthUnit = 1
  physicsWorld.maxCcdSubsteps = 4
  const getHabitatSpanMeters = () => getHabitatSpan(habitatConfig)
  const getUnits = () => createUnitsContext(habitatConfig.simScale)

  const restitution = 0.55
  const cylinderWall = createRotatingCylinderBody(rapier, physicsWorld, {
    radius: habitatConfig.radius,
    length: getHabitatSpanMeters(),
    units: getUnits()
  })
  cylinderWall.setAngularVelocity(rpmToOmega(habitatConfig.rpm))
  const balls: Ball[] = []
  const dockingGuide = new DockingGuide()
  const forceVectorArrows = new ForceVectorArrows()
  const controllerVelocity = new ControllerVelocityTracker()
  const worldForward = new THREE.Vector3()
  const worldPosition = new THREE.Vector3()
  const worldVelocity = new THREE.Vector3()
  const controllerLocalVelocity = new THREE.Vector3()
  const controllerCarrierVelocity = new THREE.Vector3()
  const controllerParentQuaternion = new THREE.Quaternion()
  const throwDebugDirection = new THREE.Vector3()
  const rotatingCameraPosition = new THREE.Vector3()
  const rotatingCameraOrientation = new THREE.Quaternion()
  const trackedBallInertialVelocity = new THREE.Vector3()
  const spawnOffset = new THREE.Vector3()
  const observerPose = {
    position: new THREE.Vector3(),
    orientation: new THREE.Quaternion()
  }
  const playerFixedColliderPosition = new THREE.Vector3()
  const locomotionIntent = getIdleLocomotionIntent()
  const jumpState = createJumpState()
  const jumpLaunchVelocity = new THREE.Vector3()
  const jumpProbePosition = new THREE.Vector3()
  const jumpProbeVelocity = new THREE.Vector3()
  // Landing snap after a jump or an overlook drop: position must match the
  // surface but arrival speed is forgiven (the snap absorbs it).
  const jumpLandingTuning = {
    endCapMargin: 1.5,
    radialTolerance: 0.3,
    maxNormalSpeed: Number.POSITIVE_INFINITY,
    maxSurfaceSpeed: Number.POSITIVE_INFINITY
  }
  let desktopThrowQueued = false
  let desktopJumpQueued = false
  let frameAngle = 0
  let settingsDirty = false
  let watchUiHot = false
  let throwDebugTimer = 0
  const THROW_DEBUG_DURATION = 1.5
  let desktopUiCamera: THREE.PerspectiveCamera = camera
  const buildPlayerTraversal = () =>
    createPlayerTraversalState(initialSurfaceState, habitatConfig.radius, frameAngle, rpmToOmega(habitatConfig.rpm), {
      rapier,
      world: physicsWorld,
      units: getUnits()
    })
  let playerTraversal = buildPlayerTraversal()
  let vrLocomotion: VRLocomotion | null = null
  let verificationBall: Ball | null = null
  const previousTrackedRotatingVelocity = new THREE.Vector3()

  const throwDebugArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(),
    1,
    0x67e8f9
  )
  throwDebugArrow.visible = false
  nearLayer.add(throwDebugArrow)
  nearLayer.add(forceVectorArrows.group)
  nearLayer.add(dockingGuide.group)

  const grabSystem = new GrabSystem({
    scene,
    releaseRoot: nearLayer,
    camera,
    renderer,
    controllerRoot: viewRig,
    shouldBlockSelectStart: (controller) => {
      const handedness = vrLocomotion?.getHandedness(controller)
      return (
        handedness === 'left' ||
        (watchUiHot && handedness === 'right')
      )
    },
    onEmptySelectStart: (controller) => {
      if (vrLocomotion?.getHandedness(controller) !== 'right') {
        return null
      }

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
  playerRig.add(vrLocomotion.clutchDebug.group)
  const xrInputMap = new XRInputMap(grabSystem.getControllers())
  const watchPanel = new WatchPanel((action) => handleWatchAction(action))
  const laserPointer = new LaserPointer()
  const desktopQuickPanel = new PcQuickPanel((action) => handleWatchAction(action))
  scene.add(watchPanel.group)
  scene.add(desktopQuickPanel.mesh)
  vrLocomotion.setProfile(settingsStore.getLocomotionProfile())
  settingsStore.subscribe(() => {
    settingsDirty = true
    vrLocomotion.setProfile(settingsStore.getLocomotionProfile())
  })

  const clearAllBalls = () => {
    clearBalls(balls, (grabTarget) => {
      grabSystem.unregisterTarget(grabTarget)
    })
    verificationBall = null
  }

  const respawnPlayerInnerWall = () => {
    return respawnPlayerInnerWallRuntime(
      {
        respawnInnerWall,
        applyPlayerTraversalState
      },
      {
        playerTraversal,
        playerRig,
        radius: habitatConfig.radius,
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      }
    )
  }

  const respawnPlayerOverlook = () => {
    const didRespawn = respawnPlayerOverlookRuntime(
      {
        respawnOverlook,
        applyPlayerTraversalState
      },
      {
        playerTraversal,
        playerRig,
        radius: habitatConfig.radius,
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      }
    )
    // Arm the landing snap so the drop from the overlook ends back on the
    // surface in attached mode, exactly like a jump landing.
    beginJump(jumpState)
    return didRespawn
  }

  const respawnPlayerAxisEnd = () => {
    return respawnPlayerAxisEndRuntime(
      {
        respawnAxisEnd,
        applyPlayerTraversalState
      },
      {
        playerTraversal,
        playerRig,
        type: habitatConfig.type,
        length: getHabitatSpanMeters(),
        radius: habitatConfig.radius,
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      }
    )
  }

  const rebuildPlayerTraversal = (respawnMode: 'inner-wall' | 'axis-end' = 'inner-wall') => {
    playerTraversal = rebuildPlayerTraversalRuntime(
      {
        playerTraversal,
        buildPlayerTraversal,
        disposePlayerTraversalState,
        respawnInnerWall,
        respawnAxisEnd,
        applyPlayerTraversalState,
        playerRig
      },
      {
        respawnMode,
        type: habitatConfig.type,
        radius: habitatConfig.radius,
        length: getHabitatSpanMeters(),
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      }
    )
  }

  function handleWatchAction(action: WatchActionId) {
    if (applyWatchAction(settingsStore, action)) {
      if (action.startsWith('rpm-')) {
        notifyTourEvent(tourGuide, 'spin-change')
      }
      return true
    }

    const runtimeAction = resolveRuntimeWatchAction(action)

    switch (runtimeAction?.kind) {
      case 'preset':
        frameAngle = 0
        applyPresetToSettingsStore(settingsStore, runtimeAction.presetId)
        clearAllBalls()
        resetJumpState(jumpState)
        rebuildPlayerTraversal('inner-wall')
        syncHabitat()
        settingsDirty = false
        return true
      case 'respawn':
        if (runtimeAction.mode === 'inner-wall') {
          notifyTourEvent(tourGuide, 'surface')
          return respawnPlayerInnerWall()
        }
        if (runtimeAction.mode === 'overlook') {
          notifyTourEvent(tourGuide, 'overlook')
          return respawnPlayerOverlook()
        }
        notifyTourEvent(tourGuide, 'axis')
        return respawnPlayerAxisEnd()
      default:
        return false
    }
  }

  const syncHabitat = () => {
    syncHabitatRuntime(
      {
        habitat,
        cityscape,
        clouds,
        starfield,
        camera,
        inertialObserverCamera,
        cylinderWall,
        applyPlayerTraversalState,
        playerRig,
        playerTraversal
      },
      {
        radius: habitatConfig.radius,
        span: getHabitatSpanMeters(),
        rpm: habitatConfig.rpm,
        frameAngle,
        focusAzimuth: 0,
        units: getUnits()
      }
    )
    // Noticeable haze at roughly one diameter, regardless of habitat scale.
    fog.density = 0.26 / habitatConfig.radius
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
    onSettingsChange: () => {
      settingsStore.notify()
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
        restitution,
        units: getUnits()
      },
      initialPosition: worldPosition.clone().add(spawnOffset),
      maxTrailPoints: habitatConfig.maxTrailPoints,
      lifetimeSeconds: habitatConfig.ballLifetimeSeconds,
      frameAngle,
      omega,
      onReleased: (controller, releasedBall, heldSeconds) => {
        getForwardDirection(controller, worldForward)
        controllerVelocity.getLocalVelocity(controller, controllerLocalVelocity)

        if (controller.parent !== null) {
          controller.parent.getWorldQuaternion(controllerParentQuaternion)
          controllerLocalVelocity.applyQuaternion(controllerParentQuaternion)
        } else {
          controllerParentQuaternion.identity()
        }

        if (playerTraversal.mode === 'free-fly') {
          inertialVelocityToRotating(
            playerTraversal.inertialPosition,
            playerTraversal.inertialVelocity,
            omega,
            frameAngle,
            controllerCarrierVelocity
          )
        } else {
          controllerCarrierVelocity.set(0, 0, 0)
        }

        computeThrowVelocityReal(
          controllerCarrierVelocity,
          controllerLocalVelocity,
          worldForward,
          heldSeconds,
          habitatConfig.ballSpeedScale,
          worldVelocity
        )

        releasedBall.setVelocity(worldVelocity)

        const throwSpeed = worldVelocity.length()
        if (throwSpeed > 0.01) {
          throwDebugDirection.copy(worldVelocity).divideScalar(throwSpeed)
          throwDebugArrow.position.copy(releasedBall.position)
          throwDebugArrow.setDirection(throwDebugDirection)
          throwDebugArrow.setLength(
            Math.min(throwSpeed * 0.15, 2.5),
            Math.min(0.4, throwSpeed * 0.04),
            Math.min(0.2, throwSpeed * 0.025)
          )
          throwDebugArrow.visible = true
          throwDebugTimer = THROW_DEBUG_DURATION
        }
      }
    })

    if (releasedByController !== undefined) {
      ball.setVelocity(new THREE.Vector3())
    } else {
      worldVelocity.copy(worldForward).multiplyScalar(8 * habitatConfig.ballSpeedScale)
      ball.setVelocity(worldVelocity)
    }

    nearLayer.add(ball.mesh)
    nearLayer.add(ball.trail)
    nearLayer.add(ball.inertialTrail)
    grabSystem.registerTarget(ball.grabTarget)
    balls.push(ball)
    notifyTourEvent(tourGuide, 'throw')

    return ball
  }

  const removeDisposedBalls = () => {
    removeExpiredBalls(balls, (grabTarget) => {
      grabSystem.unregisterTarget(grabTarget)
    })
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
    if (renderer.xr.isPresenting) {
      return
    }

    if (event.code === 'Tab') {
      event.preventDefault()
      desktopQuickPanel.toggle()
      return
    }

    if (event.repeat) {
      return
    }

    if (event.code === 'Digit1') {
      handleWatchAction('respawn-inner-wall')
      return
    }

    if (event.code === 'Digit2') {
      handleWatchAction('respawn-overlook')
      return
    }

    if (event.code === 'Digit3') {
      handleWatchAction('respawn-axis-end')
      return
    }

    if (event.code !== 'Space') {
      return
    }

    event.preventDefault()

    if (desktopQuickPanel.isVisible) {
      return
    }

    desktopJumpQueued = true
  })

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopQuickPanel.handlePointerMove(event, desktopUiCamera, renderer.domElement)
  })

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return
    }

    if (!renderer.xr.isPresenting && desktopQuickPanel.isVisible) {
      event.preventDefault()
      desktopQuickPanel.handlePointerDown(event, desktopUiCamera, renderer.domElement)
      return
    }

    // Touch taps are handled by MobileControls (tap vs drag discrimination).
    if (event.pointerType === 'touch') {
      return
    }

    requestDesktopThrow()
  })

  const gameLoop = new GameLoop(renderer, ({ deltaSeconds }) => {
    if (settingsDirty) {
      syncHabitat()
      settingsDirty = false
    }

    const omega = rpmToOmega(habitatConfig.rpm)
    const habitatSpan = getHabitatSpanMeters()
    const frameAngleStart = frameAngle
    const effectiveObserverMode = getEffectiveObserverMode(
      debugVisuals.observerMode,
      renderer.xr.isPresenting
    )

    const desktopIntent = desktopLookControls.update(deltaSeconds, renderer.xr.isPresenting)
    const vrIntent = vrLocomotion.update(
      deltaSeconds,
      renderer.xr.isPresenting,
      playerTraversal.mode,
      frameAngleStart,
      omega
    )
    const xrWatchInput = xrInputMap.update(deltaSeconds, renderer.xr.isPresenting)
    controllerVelocity.update(deltaSeconds)

    if (throwDebugTimer > 0) {
      throwDebugTimer -= deltaSeconds
      if (throwDebugTimer <= 0) {
        throwDebugArrow.visible = false
      }
    }

    if (desktopThrowQueued) {
      desktopThrowQueued = false
      throwDesktopBall()
    }

    grabSystem.update()

    // Update order: input -> grab state -> simulation -> render.
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + omega * deltaSeconds, Math.PI * 2)
    starfield.setFrameAngle(frameAngle)
    mergeLocomotionIntent(desktopIntent, vrIntent, locomotionIntent)

    const jumpRequested = desktopJumpQueued || xrWatchInput.jumpPressed
    desktopJumpQueued = false

    if (playerTraversal.mode === 'attached' && jumpRequested) {
      computeJumpLaunchVelocity(playerTraversal.surface.azimuth, JUMP_SPEED, jumpLaunchVelocity)
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: jumpLaunchVelocity,
        radius: habitatConfig.radius,
        omega,
        frameAngle
      })
      beginJump(jumpState)
      notifyTourEvent(tourGuide, 'jump')
    }

    if (playerTraversal.mode === 'attached' && locomotionIntent.detachRequested) {
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: locomotionIntent.detachLaunchVelocity,
        radius: habitatConfig.radius,
        omega,
        frameAngle
      })
    } else if (playerTraversal.mode === 'attached') {
      stepAttachedPlayer(playerTraversal, {
        axisDistanceDelta: locomotionIntent.attachedAxis * 6 * deltaSeconds,
        tangentDistanceDelta: locomotionIntent.attachedTangent * 6 * deltaSeconds,
        radius: habitatConfig.radius,
        length: habitatSpan,
        deltaSeconds,
        omega,
        frameAngleEnd: frameAngle
      })
    } else {
      stepFreeFlyPlayer(playerTraversal, {
        thrustAcceleration: locomotionIntent.freeFlyThrust.multiplyScalar(
          habitatConfig.jetpackAcceleration
        ),
        deltaSeconds,
        frameAngleStart,
        frameAngleEnd: frameAngle,
        omega,
        linearDamping: 0,
        brakeAmount: locomotionIntent.freeFlyBrake,
        brakeDamping: 6,
        maxSpeed: 14
      })
    }

    if (playerTraversal.mode === 'attached') {
      resolveCitySurfaceCollision(
        playerTraversal.surface,
        cityscape.getBuildings(),
        habitatConfig.radius
      )
      getSurfacePosition(playerTraversal.surface, habitatConfig.radius, playerFixedColliderPosition)
    } else {
      inertialPositionToRotating(
        playerTraversal.inertialPosition,
        frameAngle,
        playerFixedColliderPosition
      )
    }

    const playerAzimuth = Math.atan2(playerFixedColliderPosition.z, playerFixedColliderPosition.x)
    habitat.setFocusAzimuth(playerAzimuth)
    cylinderWall.updateActiveColliders(playerAzimuth, frameAngle)

    physicsWorld.timestep = deltaSeconds
    physicsWorld.step()
    syncPlayerTraversalFromPhysics(playerTraversal)
    const reattachStatus =
      playerTraversal.mode === 'free-fly'
        ? evaluateReattachPlayer(playerTraversal, {
            ...reattachTuning,
            radius: habitatConfig.radius,
            length: habitatSpan,
            omega,
            frameAngle
          })
        : null

    // The landing snap only fires while sinking toward the wall, so flying
    // along or away from the surface (left-grip thrust) is never interrupted.
    let descending = true

    if (playerTraversal.mode === 'free-fly') {
      inertialPositionToRotating(playerTraversal.inertialPosition, frameAngle, jumpProbePosition)
      inertialVelocityToRotating(
        playerTraversal.inertialPosition,
        playerTraversal.inertialVelocity,
        omega,
        frameAngle,
        jumpProbeVelocity
      )
      const radialDistance = Math.hypot(jumpProbePosition.x, jumpProbePosition.z)
      descending =
        radialDistance <= 1e-6 ||
        (jumpProbePosition.x * jumpProbeVelocity.x +
          jumpProbePosition.z * jumpProbeVelocity.z) /
          radialDistance >
          -0.05
    }

    const jumpLanded = stepJumpState(jumpState, {
      mode: playerTraversal.mode,
      radialError: reattachStatus?.radialError ?? 0,
      descending
    })

    if (jumpLanded) {
      tryReattachPlayer(playerTraversal, {
        ...jumpLandingTuning,
        radius: habitatConfig.radius,
        length: habitatSpan,
        omega,
        frameAngle
      })
    }

    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
    dockingGuide.update(
      computeDockingGuideState(playerTraversal, {
        radius: habitatConfig.radius,
        length: habitatSpan,
        frameAngle,
        ready: reattachStatus?.canAttach ?? false
      })
    )

    for (const ball of balls) {
      ball.step({
        deltaSeconds,
        habitatRadius: habitatConfig.radius,
        habitatLength: habitatSpan,
        omega,
        frameAngleEnd: frameAngle,
        trailMode: debugVisuals.trailMode,
        buildings: cityscape.getBuildings()
      })
    }

    removeDisposedBalls()
    const trackedBall = getTrackedBall(balls)
    const verificationBallTarget =
      trackedBall !== null && !trackedBall.isGrabbed ? trackedBall : null
    const verification =
      verificationBallTarget === null
        ? null
        : computeFrameVerification({
            omega,
            rotatingPosition: verificationBallTarget.position,
            rotatingVelocity: verificationBallTarget.velocity,
            previousRotatingVelocity:
              verificationBall === verificationBallTarget ? previousTrackedRotatingVelocity : null,
            deltaSeconds,
            errorThreshold: debugVisuals.verificationErrorThreshold
          })

    if (verificationBallTarget === null) {
      verificationBall = null
    } else {
      verificationBall = verificationBallTarget
      previousTrackedRotatingVelocity.copy(verificationBallTarget.velocity)
    }

    forceVectorArrows.update({
      ball: trackedBall,
      omega,
      scale: debugVisuals.forceVectorScale,
      visible: debugVisuals.showForceVectors
    })
    const playerRegion = getPlayerTraversalRegion(playerTraversal, habitatSpan, frameAngle)
    const watchMenuOpen = renderer.xr.isPresenting || desktopQuickPanel.isVisible
    const watchSnapshot = createWatchRenderSnapshot(settingsStore, {
      playerMode: playerTraversal.mode,
      region: playerRegion,
      watchMenuOpen,
      observerMode: effectiveObserverMode,
      trailMode: debugVisuals.trailMode,
      ballCount: balls.length,
      absoluteVelocity: {
        x: playerTraversal.inertialVelocity.x,
        y: playerTraversal.inertialVelocity.y,
        z: playerTraversal.inertialVelocity.z,
        speed: playerTraversal.inertialVelocity.length()
      }
    })

    hud.update({
      radius: habitatConfig.radius,
      span: habitatSpan,
      rpm: habitatConfig.rpm,
      gTarget: settingsStore.getSurfaceGravity(),
      presetName: getPresetName(habitatConfig.currentPresetId),
      habitatType: habitatConfig.type,
      simScale: habitatConfig.simScale,
      ballCount: balls.length,
      trackedBallSpeed: trackedBall?.velocity.length() ?? 0,
      xrActive: renderer.xr.isPresenting,
      forceVectors: debugVisuals.showForceVectors,
      observerMode: effectiveObserverMode,
      trailMode: debugVisuals.trailMode,
      region: playerRegion,
      playerMode: playerTraversal.mode,
      watchMenuOpen,
      verification:
        verificationBallTarget === null || verification === null
          ? null
          : {
              inertialVelocity: verificationBallTarget.copyInertialVelocity(trackedBallInertialVelocity),
              rotatingVelocity: verificationBallTarget.velocity,
              fictitiousAcceleration: verification.breakdown.total,
              estimatedAcceleration: verification.estimatedAcceleration,
              errorMagnitude: verification.errorMagnitude,
              warning: verification.warning
            },
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
              ready: reattachStatus.canAttach
            }
    })
    debugGui.update()
    worldRoot.rotation.y = getDisplayRootRotation(effectiveObserverMode, frameAngle)
    desktopUiCamera = camera

    if (effectiveObserverMode === 'inertial-fixed' && !renderer.xr.isPresenting) {
      camera.updateWorldMatrix(true, false)
      camera.getWorldPosition(rotatingCameraPosition)
      camera.getWorldQuaternion(rotatingCameraOrientation)
      computeInertialObserverPose(
        rotatingCameraPosition,
        rotatingCameraOrientation,
        frameAngle,
        observerPose
      )
      inertialObserverCamera.position.copy(observerPose.position)
      inertialObserverCamera.quaternion.copy(observerPose.orientation)
      inertialObserverCamera.updateMatrixWorld(true)
      desktopUiCamera = inertialObserverCamera
    }
    watchPanel.update(
      watchSnapshot,
      renderer.xr.isPresenting,
      xrWatchInput.leftGrip,
      xrWatchInput.leftController
    )
    laserPointer.setController(renderer.xr.isPresenting ? xrWatchInput.rightController : null)
    watchPanel.updateHover(
      laserPointer.update(
        watchPanel.interactiveObject,
        renderer.xr.isPresenting
      )?.uv ?? null
    )
    watchUiHot = renderer.xr.isPresenting && watchPanel.hasHover

    if (renderer.xr.isPresenting && xrWatchInput.rightTriggerPressed) {
      watchPanel.clickHovered()
    }

    dayNightPhase = stepDayNightPhase(
      dayNightPhase,
      deltaSeconds,
      debugVisuals.dayNightCycleSeconds
    )
    const daylight = getDaylight(dayNightPhase)
    light.intensity = 0.22 + daylight * 0.9

    for (const windowSun of windowSuns) {
      windowSun.intensity = 0.06 + daylight * 1.25
    }

    fog.color.lerpColors(fogNightColor, fogDayColor, daylight)
    ;(scene.background as THREE.Color).lerpColors(
      backgroundNightColor,
      backgroundDayColor,
      daylight
    )
    cityscape.setDaylight(daylight)
    clouds.setDaylight(daylight)
    clouds.update(deltaSeconds)

    desktopQuickPanel.update(desktopUiCamera, watchSnapshot, !renderer.xr.isPresenting)
    mobileControls?.update(renderer.xr.isPresenting)
    tourCardPanel.update(stepTourGuide(tourGuide, deltaSeconds), {
      camera: desktopUiCamera,
      deltaSeconds,
      xrActive: renderer.xr.isPresenting
    })
    renderer.render(scene, desktopUiCamera)
  })

  notifyTourEvent(tourGuide, 'start')
  gameLoop.start()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    inertialObserverCamera.aspect = window.innerWidth / window.innerHeight
    inertialObserverCamera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  window.addEventListener('beforeunload', () => {
    cityscape.dispose()
    clouds.dispose()
    tourCardPanel.dispose()
    mobileControls?.dispose()
    desktopLookControls.dispose()
    disposePlayerTraversalState(playerTraversal)
    cylinderWall.dispose()
    vrLocomotion?.clutchDebug.dispose()
    physicsWorld.free()
    debugGui.destroy()
  })

  console.info(
    `Cylinder axis: Y, Omega: (0, ${rpmToOmega(habitatConfig.rpm).toFixed(3)}, 0), g=${settingsStore.getSurfaceGravity().toFixed(2)}`
  )
}
