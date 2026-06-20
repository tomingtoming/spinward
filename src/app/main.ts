import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import {
  computeInertialObserverPose,
  getDisplayRootRotation,
  getEffectiveObserverMode
} from './observerMode'
import { GameAudio } from './audio'
import { clearBalls, getTrackedBall, removeExpiredBalls } from './ballCollection'
import { DesktopLookControls } from './desktopLookControls'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import { getDaylight, stepDayNightPhase } from './dayNight'
import {
  createSkyGrade,
  getInitialDayNightPhase,
  getSkyLook,
  sampleSkyGrade
} from './skyGrade'
import { DriveRuntime } from './driveRuntime'
import { Accelerometer } from '../sim/accelerometer'
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
  resetPlayerToFreeFly,
  resetPlayerToGrounded,
  syncGroundedSurfaceFromPhysics,
  syncPlayerTraversalFromPhysics,
  stepGroundedPlayer,
  stepFreeFlyPlayer,
  updatePlayerGroundContact
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
import { Car } from '../objects/car'
import {
  getCityGroundHeight,
  getPlazaTangentHalfWidth,
  getWindowStripArcs,
  resolveCitySurfaceCollision
} from '../objects/cityLayout'
import { Cityscape } from '../objects/cityscape'
import { CylinderHabitat } from '../objects/cylinder'
import { DockingGuide, computeDockingGuideState } from '../objects/dockingGuide'
import { ForceVectorArrows } from '../objects/forceVectors'
import { Spaceport } from '../objects/spaceport'
import { Starfield } from '../objects/starfield'
import { Sun, getWindowSunPosition } from '../objects/sun'
import { AtmosphereGlow } from '../objects/atmosphereGlow'
import { getQualityProfile } from './quality'
import { MobileControls, isQuestBrowser, isTouchDevice } from '../pc/mobileControls'
import { createFullscreenToggle } from '../pc/fullscreen'
import { PcQuickPanel } from '../pc/pcQuickPanel'
import { JUMP_SPEED, computeJumpLaunchVelocity } from '../gameplay/jump'
import { respawnAxisEnd, respawnInnerWall, respawnOverlook } from '../gameplay/respawn'
import { computeThrowVelocityReal } from '../gameplay/throwVelocity'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { applyPresetToSettingsStore, canRespawnOnAxisEnd, getPresetById, getPresetName } from '../presets/presetManager'
import { computeFrameVerification } from '../sim/frameVerification'
import { inertialPositionToRotating, inertialVelocityToRotating } from '../sim/frameTransforms'
import { getAirColumnFraction, getHabitatSpan } from '../sim/habitatConfig'
import { createSettingsStore } from '../state/settingsStore'
import { createDebugGui } from '../ui/debugGui'
import { createBeatBar } from '../ui/beatBar'
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
    verificationErrorThreshold: 4
  }
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x08131d)
  // Aero perspective: the far side of town softens into haze — but the air is
  // kept fairly CLEAR so the colony interior reads THROUGH it (the far cities
  // arching overhead, the night grid, the curvature), rather than being socked
  // in fog. Haze is a property of the AIR — a fixed extinction per metre — so a
  // giant colony's far wall (km of air) still softens while a small one stays
  // crisp. Lowered from 2.2e-4 to reveal the far side; the remaining far-rim
  // shimmer is dissolved by the cityscape distance fade (pushed to ~2.9 radii)
  // rather than by blanket fog. The confined-air case (a ring's vacuum bore) is
  // handled in syncHabitat, which scales this by getAirColumnFraction.
  const AIR_FOG_DENSITY = 1.0e-4
  const fog = new THREE.FogExp2(0x5f7587, AIR_FOG_DENSITY)
  scene.fog = fog
  // The day/night colour grade (fog/background/sun/exposure) is a per-look
  // keyframed profile; Izma wears a warm dusk, other presets keep the cool
  // legacy grade. Boot at the look's chosen time of day.
  const skyGrade = createSkyGrade()
  let dayNightPhase = getInitialDayNightPhase(habitatConfig.skyLook)
  const audio = new GameAudio()
  const sunNoonColor = new THREE.Color(0xfff2dd)
  const sunLowColor = new THREE.Color(0xffbe82)
  const worldRoot = new THREE.Group()
  const skyLayer = new THREE.Group()
  const farLayer = new THREE.Group()
  const nearLayer = new THREE.Group()
  scene.add(worldRoot)
  worldRoot.add(skyLayer, farLayer, nearLayer)

  const habitat = new CylinderHabitat({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig),
    topology: habitatConfig.topology,
    type: habitatConfig.type
  })
  const quality = getQualityProfile()
  const cityscape = new Cityscape(
    {
      radius: habitatConfig.radius,
      length: getHabitatSpan(habitatConfig),
      topology: habitatConfig.topology,
      type: habitatConfig.type
    },
    { maxBuildings: quality.maxBuildings }
  )
  const spaceport = new Spaceport({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  const starfield = new Starfield({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  // The sun hangs on the +Y axis — the spaceport-free end — so that end always
  // faces it. It lives in the inertial sky, not the rotating colony.
  const sun = new Sun({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  // Airlight up the bore: a sky-tinted glow on the axis for atmospheric depth.
  const atmosphereGlow = new AtmosphereGlow({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig)
  })
  skyLayer.add(starfield.group)
  skyLayer.add(sun.group)
  skyLayer.add(atmosphereGlow.group)
  nearLayer.add(habitat.group)
  nearLayer.add(cityscape.group)
  nearLayer.add(spaceport.group)

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

  // A logarithmic depth buffer: at colony scale the camera far plane is huge
  // (km-deep bore + the distant star shell), so a linear depth buffer has almost
  // no precision out there and coplanar surfaces — roads/fields on the ground,
  // glass on the wall — z-fight. Log depth redistributes precision across the
  // whole range and keeps the near plane small (so VR hands stay un-clipped).
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')

  // Bloom makes the night city glow (windows, teal road grid, beacons, the sun).
  // EffectComposer does NOT compose with WebXR's multi-view rendering, so bloom
  // is desktop/flat-screen only (quality.bloom; off on phone/Quest); in XR we
  // render directly. MSAA + HalfFloat keep edge AA and HDR for the glow. Strength
  // ramps up at night so daytime keeps a subtle sun glow, not a washout.
  const BLOOM_BASE_STRENGTH = 0.9
  let bloomComposer: EffectComposer | null = null
  let bloomRenderPass: RenderPass | null = null
  let bloomPass: UnrealBloomPass | null = null
  if (quality.bloom) {
    const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2())
    const bloomTarget = new THREE.WebGLRenderTarget(drawingSize.x, drawingSize.y, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    bloomComposer = new EffectComposer(renderer, bloomTarget)
    bloomComposer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap))
    bloomComposer.setSize(window.innerWidth, window.innerHeight)
    bloomRenderPass = new RenderPass(scene, camera)
    bloomComposer.addPass(bloomRenderPass)
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      BLOOM_BASE_STRENGTH,
      0.5,
      0.55
    )
    bloomComposer.addPass(bloomPass)
    // OutputPass applies the renderer's ACES tone map + sRGB once, at the end.
    bloomComposer.addPass(new OutputPass())
  }
  document.body.appendChild(renderer.domElement)

  const onQuest = isQuestBrowser()

  const desktopLookControls = new DesktopLookControls(
    playerRig,
    camera,
    renderer.domElement
  )
  // The Quest browser reports as a touch device, so the on-screen controls are
  // built there too: they remain the usable fallback if immersive VR turns out
  // unavailable, and get switched off below once a VR session is confirmed.
  const mobileControls = isTouchDevice()
    ? new MobileControls(camera, renderer.domElement, {
        onThrow: () => requestDesktopThrow(),
        onJump: () => {
          desktopJumpQueued = true
        },
        onToggleDrive: () => tryToggleDrive(),
        onToggleSettings: () => desktopQuickPanel.toggle(),
        isUiPointerBlocked: () => desktopQuickPanel.isVisible,
        onUserInput: () => desktopLookControls.cancelIntroReveal()
      })
    : null

  // VR entry + fullscreen affordances, by device class:
  //  · A corner fullscreen toggle on every non-Quest device that supports it
  //    (createFullscreenToggle returns null on iPhone Safari, which has no
  //    element Fullscreen API).
  //  · PC (pointer) mounts the VR button immediately; touch devices only once a
  //    session is actually possible — a permanent "VR NOT SUPPORTED" pill is
  //    just clutter. On Quest a supported session goes VR-first: a big centered
  //    "ENTER VR" call-to-action with the unreachable touch stick switched off.
  //    If immersive VR is unavailable the touch controls stay, so the headset
  //    is never a dead end.
  const mountVrButton = () =>
    document.body.appendChild(VRButton.createButton(renderer))
  let fullscreenToggle: ReturnType<typeof createFullscreenToggle> = null

  if (!onQuest) {
    fullscreenToggle = createFullscreenToggle()

    if (fullscreenToggle !== null) {
      document.body.appendChild(fullscreenToggle.button)
    }
  }

  if (!isTouchDevice()) {
    mountVrButton()
  } else {
    navigator.xr
      ?.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (!supported) {
          return
        }

        mountVrButton()

        if (onQuest) {
          document.body.classList.add('is-vr-entry')
          mobileControls?.setEnabled(false)
          // Demote the CTA to a compact pill after the first entry, so it stops
          // covering the flat-view scene once the user exits VR.
          renderer.xr.addEventListener('sessionstart', () =>
            document.body.classList.remove('is-vr-entry')
          )
        }
      })
      .catch(() => {})
  }
  renderer.xr.addEventListener('sessionstart', () => audio.unlock())

  const light = new THREE.HemisphereLight(0xdfeeff, 0x33404e, 1.1)
  scene.add(light)

  // Sunlight enters through the three window strips: one directional light
  // per strip, pointing inward from the window's center azimuth. They live in
  // nearLayer so they stay colony-fixed under the inertial observer mode. Each
  // is lifted toward +Y so the light rakes down from the sun end — agreeing
  // with where the sun visibly hangs — rather than arriving dead flat.
  const windowSuns: THREE.DirectionalLight[] = []

  for (const arc of getWindowStripArcs()) {
    const windowSun = new THREE.DirectionalLight(0xfff2dd, 1.3)
    windowSun.position.copy(getWindowSunPosition(arc.centerAzimuth))
    nearLayer.add(windowSun)
    nearLayer.add(windowSun.target)
    windowSuns.push(windowSun)
  }

  const rapier = await initRapier()
  const physicsWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  applyWorldLengthUnit(physicsWorld, habitatConfig.simScale)
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
  // Real co-rotating building colliders, streamed near the car (P1). Inflated a
  // little so the car's small physics sphere stops near where its larger body
  // would. Collides with the car only for now; the walker still uses analytic
  // building collision. Rebuilt with the real city index in syncHabitat below.
  const cityColliders = createRotatingCityColliders(rapier, physicsWorld, {
    radius: habitatConfig.radius,
    index: cityscape.getCollisionIndex(),
    units: getUnits(),
    omega: rpmToOmega(habitatConfig.rpm),
    // Compromise inflation for two collider sizes sharing one set: the car's
    // 0.5 m sphere and the walker's 0.32 m sphere both stop near their bodies.
    margin: 0.25
  })
  const car = new Car()
  nearLayer.add(car.group)
  const drive = new DriveRuntime()
  drive.rebuild({ rapier, world: physicsWorld, units: getUnits() })
  const driveKeys = { forward: false, back: false, left: false, right: false, brake: false }

  const parkCarNearPlaza = () => {
    // Beside the spawn ring, but never inside a building: probe outward for
    // the first pose with car-sized clearance on all sides.
    const buildings = cityscape.getCollisionIndex()
    const baseTangent = Math.min(getPlazaTangentHalfWidth(habitatConfig.radius) * 0.5, 4.5)
    const probe = { azimuth: 0, axialPosition: 0 }
    let parked = false

    candidateSearch: for (const ring of [0, 4, 8, 14, 22, 32]) {
      for (const [tangentStep, axialStep] of [
        [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]
      ]) {
        const tangent = baseTangent + tangentStep * ring
        const axial = axialStep * ring
        probe.azimuth = tangent / habitatConfig.radius
        probe.axialPosition = axial

        if (!resolveCitySurfaceCollision(probe, buildings, habitatConfig.radius, 4)) {
          drive.parkAt(tangent / habitatConfig.radius, axial, 0)
          parked = true
          break candidateSearch
        }
      }
    }

    if (!parked) {
      drive.parkAt(baseTangent / habitatConfig.radius, 0, 0)
    }

    car.setPose(
      drive.surface.azimuth,
      drive.surface.axialPosition,
      drive.heading,
      habitatConfig.radius
    )
  }

  parkCarNearPlaza()
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
  const jumpLaunchVelocity = new THREE.Vector3()
  // Dedicated long ray for aiming the right VR pointer at the car; the watch
  // LaserPointer is capped at 1.8 m and non-recursive, so it can't reach it.
  const carRaycaster = new THREE.Raycaster()
  carRaycaster.far = 60
  // Simulated accelerometer for the felt g-force readout (measured, not ω²R).
  const feltAccelerometer = new Accelerometer()
  let feltAccelDriving = false
  let desktopThrowQueued = false
  let desktopJumpQueued = false
  let frameAngle = 0
  let settingsDirty = false
  let watchUiHot = false
  let rightLaserOverCar = false
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

      // Aiming the right pointer at the car climbs in instead of spawning a
      // ball. Deciding it here — in the same select event that would otherwise
      // spawn the ball — means one trigger pull can never do both.
      if (!drive.driving && rightLaserOverCar) {
        tryToggleDrive(true)
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

  const carExitVelocity = new THREE.Vector3()
  const carExitPosition = new THREE.Vector3()
  const PLAYER_DISMOUNT_HEIGHT = 1.1

  const exitDrive = () => {
    const omega = rpmToOmega(habitatConfig.rpm)
    // Step off carrying the car's momentum: leave on foot in free-fly with the
    // car's rotating-frame velocity. A near-stopped car re-attaches next frame
    // (the ground-contact gate sees a low relative speed); a moving one flings
    // you forward, like stepping off a moving vehicle.
    carExitVelocity.copy(drive.lastRotatingVelocity)
    drive.exit()
    const exitAzimuth = drive.surface.azimuth + 2.6 / habitatConfig.radius
    carExitPosition
      .set(Math.cos(exitAzimuth), 0, Math.sin(exitAzimuth))
      .multiplyScalar(habitatConfig.radius - PLAYER_DISMOUNT_HEIGHT)
      .setY(drive.surface.axialPosition)
    resetPlayerToFreeFly(playerTraversal, {
      rotatingPosition: carExitPosition,
      rotatingVelocity: carExitVelocity,
      frameAngle,
      omega
    })
    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
    car.setPose(
      drive.surface.azimuth,
      drive.surface.axialPosition,
      drive.heading,
      habitatConfig.radius
    )
    audio.playClick()
  }

  const tryToggleDrive = (viaPointer = false) => {
    if (drive.driving) {
      exitDrive()
      return
    }

    // The VR pointer is its own spatial gate (you must aim the laser at the
    // car), so it bypasses the walk-up proximity check that desktop/mobile use.
    if (
      !viaPointer &&
      (playerTraversal.mode !== 'grounded' ||
        !drive.isPlayerNear(
          playerTraversal.surface.azimuth,
          playerTraversal.surface.axialPosition,
          habitatConfig.radius
        ))
    ) {
      return
    }

    drive.enter(frameAngle, rpmToOmega(habitatConfig.rpm), habitatConfig.radius, {
      rapier,
      world: physicsWorld,
      units: getUnits()
    })
    if (viaPointer) {
      // Pointer entry can come from across the habitat; seat the rig at the car
      // this frame so the driver view doesn't render once at the old spot.
      resetPlayerToGrounded(playerTraversal, {
        axialPosition: drive.surface.axialPosition,
        azimuth: drive.surface.azimuth,
        radius: habitatConfig.radius,
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      })
      applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
    }
    // Face the hood, not wherever you last looked while walking.
    desktopLookControls.resetLook()
    mobileControls?.resetLook()
    vrLocomotion?.faceForward()
    notifyTourEvent(tourGuide, 'drive')
    audio.playClick()
  }

  function handleWatchAction(action: WatchActionId) {
    if (applyWatchAction(settingsStore, action)) {
      audio.playClick()
      if (action.startsWith('rpm-')) {
        notifyTourEvent(tourGuide, 'spin-change')
      }
      return true
    }

    const runtimeAction = resolveRuntimeWatchAction(action)

    switch (runtimeAction?.kind) {
      case 'preset':
        audio.playClick()
        frameAngle = 0
        applyPresetToSettingsStore(settingsStore, runtimeAction.presetId)
        clearAllBalls()
        rebuildPlayerTraversal('inner-wall')
        drive.rebuild({ rapier, world: physicsWorld, units: getUnits() })
        parkCarNearPlaza()
        syncHabitat()
        settingsDirty = false
        return true
      case 'respawn':
        audio.playClick()
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
    applyWorldLengthUnit(physicsWorld, habitatConfig.simScale)
    syncHabitatRuntime(
      {
        habitat,
        cityscape,
        spaceport,
        starfield,
        sun,
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
        units: getUnits(),
        topology: habitatConfig.topology,
        type: habitatConfig.type
      }
    )
    // The city index was just rebuilt for the new dimensions; re-seat the
    // streamed building colliders onto it (and the new sim scale / spin).
    cityColliders.rebuild({
      radius: habitatConfig.radius,
      index: cityscape.getCollisionIndex(),
      units: getUnits()
    })
    cityColliders.setAngularVelocity(rpmToOmega(habitatConfig.rpm))
    // Haze is the fixed air extinction (AIR_FOG_DENSITY) scaled by how much of a
    // cross-interior sightline actually lies in air. A cylinder is air to the
    // axis (fraction 1, unchanged); an open ring like Elysium holds only a thin
    // shell on its floor, so most of a cross-bore sightline is vacuum and the
    // far rim stays visible instead of socking in. THREE's fog is uniform, so
    // this is the representative-sightline approximation, not a per-ray integral.
    fog.density = AIR_FOG_DENSITY * getAirColumnFraction(habitatConfig)
  }

  syncHabitat()

  const hud = createHud()
  // Always-visible self-driving nav (non-VR): Travel + Spin so the demo's
  // payoff beats don't hide behind 1/2/3 and Tab.
  const beatBar = createBeatBar((action) => handleWatchAction(action))

  // The lil-gui tuning panel is a developer tool, off by default so the demo
  // stays clean — append `?debug` to the URL to bring it back top-right.
  const debugEnabled =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('debug')
  const debugGui = debugEnabled
    ? createDebugGui({
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
    : null
  hud.setVisible(debugVisuals.showHud)

  // The thrower's own motion rides on the ball. While driving that is the CAR's
  // inertial velocity (it can be screaming along the wall) — NOT the seated
  // player's co-rotation, which playerTraversal holds while driving; on foot it
  // is the walker's live body. Converted into the rotating frame to add to the
  // throw.
  const fillCarrierRotatingVelocity = (target: THREE.Vector3) =>
    inertialVelocityToRotating(
      drive.driving ? drive.lastInertialPosition : playerTraversal.inertialPosition,
      drive.driving ? drive.lastInertialVelocity : playerTraversal.inertialVelocity,
      rpmToOmega(habitatConfig.rpm),
      frameAngle,
      target
    )

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
      onBounce: (bouncedBall, impactSpeed) => {
        const distance = bouncedBall.position.distanceTo(playerFixedColliderPosition)
        audio.playBounce(impactSpeed * Math.min(1, 12 / (distance + 3)))
      },
      onReleased: (controller, releasedBall, heldSeconds) => {
        audio.playThrow()
        vibrate(8)
        getForwardDirection(controller, worldForward)
        controllerVelocity.getLocalVelocity(controller, controllerLocalVelocity)

        if (controller.parent !== null) {
          controller.parent.getWorldQuaternion(controllerParentQuaternion)
          controllerLocalVelocity.applyQuaternion(controllerParentQuaternion)
        } else {
          controllerParentQuaternion.identity()
        }

        // The thrower's own motion rides on the ball in every mode — a grounded
        // runner's body is a live physics body, and a driver carries the car's
        // speed.
        fillCarrierRotatingVelocity(controllerCarrierVelocity)

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
      // Desktop throws also inherit the thrower's motion (walking or driving).
      fillCarrierRotatingVelocity(controllerCarrierVelocity)
      worldVelocity
        .copy(worldForward)
        .multiplyScalar(8 * habitatConfig.ballSpeedScale)
        .add(controllerCarrierVelocity)
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
    audio.playThrow()
    vibrate(8)
  }

  const requestDesktopThrow = () => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopThrowQueued = true
  }

  window.addEventListener('keydown', (event) => {
    audio.unlock()

    if (event.code === 'KeyM' && !event.repeat) {
      audio.toggleMuted()
    }

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

    if (event.code === 'KeyE') {
      tryToggleDrive()
      return
    }

    if (event.code === 'KeyW') driveKeys.forward = true
    if (event.code === 'KeyS') driveKeys.back = true
    if (event.code === 'KeyA') driveKeys.left = true
    if (event.code === 'KeyD') driveKeys.right = true

    if (event.code !== 'Space') {
      return
    }

    event.preventDefault()

    if (desktopQuickPanel.isVisible) {
      return
    }

    if (drive.driving) {
      driveKeys.brake = true
      return
    }

    desktopJumpQueued = true
  })

  window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyW') driveKeys.forward = false
    if (event.code === 'KeyS') driveKeys.back = false
    if (event.code === 'KeyA') driveKeys.left = false
    if (event.code === 'KeyD') driveKeys.right = false
    if (event.code === 'Space') driveKeys.brake = false
  })

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopQuickPanel.handlePointerMove(event, desktopUiCamera, renderer.domElement)
  })

  renderer.domElement.addEventListener('pointerdown', (event) => {
    audio.unlock()

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

  const sampleGroundHeight = (azimuth: number, axialPosition: number, altitude: number) =>
    getCityGroundHeight(
      cityscape.getCollisionIndex(),
      habitatConfig.radius,
      azimuth,
      axialPosition,
      altitude
    )

  // Seat height: on foot the eye is 1.6 m above the floor, but riding the rover
  // you sit up on the chassis, so lift the view while driving for a commanding
  // road view instead of a ground-level one.
  const DRIVER_VIEW_RAISE = 0.6
  // Landing absorb: the camera dips with the impact speed and springs back.
  const LAND_DIP_STIFFNESS = 6
  let landDipOffset = 0
  let landDipVelocity = 0
  // Smooths the free-fly→grounded eye handoff: seeded on landing with the
  // measured view gap (projected onto the colonist's up) and decays to 0, so it
  // can never leave a permanent offset. Desktop/mobile only — in XR a sudden
  // view shift moves the floor under a standing user.
  let landingSettle = 0
  const LANDING_SETTLE_TAU = 0.16
  let hasEyePrev = false
  const eyeWorldPrev = new THREE.Vector3()
  const eyeWorldNow = new THREE.Vector3()
  const eyeUp = new THREE.Vector3()
  let fallSpeed = 0
  const fallProbePosition = new THREE.Vector3()
  const fallProbeVelocity = new THREE.Vector3()

  // Haptics where available: navigator.vibrate (Android Chrome) for the phone,
  // and the Quest controllers' actuators in VR (where navigator.vibrate is a
  // no-op). Intensity scales with the event size.
  const vibrate = (milliseconds: number) => {
    navigator.vibrate?.(milliseconds)

    if (renderer.xr.isPresenting) {
      xrInputMap.pulse(THREE.MathUtils.clamp(milliseconds / 40, 0.25, 1), milliseconds)
    }
  }
  let wasCarCrashed = false
  const VR_TRAVEL_TARGETS = [
    'respawn-inner-wall',
    'respawn-overlook',
    'respawn-axis-end'
  ] as const
  let vrTravelCycleIndex = 0

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

    const touchMove = mobileControls?.getMoveInput()
    const desktopIntent = desktopLookControls.update(
      deltaSeconds,
      renderer.xr.isPresenting,
      drive.driving ? undefined : touchMove,
      playerTraversal.mode === 'free-fly' && !drive.driving
    )
    const vrIntent = vrLocomotion.update(
      deltaSeconds,
      renderer.xr.isPresenting,
      playerTraversal.mode,
      frameAngleStart,
      omega,
      drive.driving
    )
    const xrWatchInput = xrInputMap.update(deltaSeconds, renderer.xr.isPresenting)
    controllerVelocity.update(deltaSeconds)

    // Right B cycles Surface → Overlook → Axis, so the demo's climax beats
    // don't require aiming the throwing-hand laser at the wrist Travel buttons.
    if (xrWatchInput.travelCyclePressed && !drive.driving) {
      vrTravelCycleIndex = (vrTravelCycleIndex + 1) % VR_TRAVEL_TARGETS.length
      handleWatchAction(VR_TRAVEL_TARGETS[vrTravelCycleIndex])
      vibrate(10)
    }

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

    const jumpRequested = (desktopJumpQueued || xrWatchInput.jumpPressed) && !drive.driving
    // While driving, the VR jump button (right A) is the dismount, not a jump.
    if (drive.driving && xrWatchInput.jumpPressed) {
      exitDrive()
    }
    desktopJumpQueued = false

    if (drive.driving) {
      drive.preStep(
        {
          throttle: THREE.MathUtils.clamp(
            (driveKeys.forward ? 1 : 0) +
              (driveKeys.back ? -1 : 0) +
              (touchMove?.forward ?? 0) +
              xrWatchInput.driveThrottle,
            -1,
            1
          ),
          steer: THREE.MathUtils.clamp(
            (driveKeys.right ? 1 : 0) +
              (driveKeys.left ? -1 : 0) +
              (touchMove?.right ?? 0) +
              xrWatchInput.driveSteer,
            -1,
            1
          ),
          brake: Math.max(
            driveKeys.brake || mobileControls?.isBrakeHeld() ? 1 : 0,
            xrWatchInput.driveBrake
          )
        },
        {
          deltaSeconds,
          frameAngle,
          omega,
          radius: habitatConfig.radius,
          units: getUnits()
        }
      )
    }

    if (playerTraversal.mode === 'grounded' && jumpRequested) {
      computeJumpLaunchVelocity(playerTraversal.surface.azimuth, JUMP_SPEED, jumpLaunchVelocity)
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: jumpLaunchVelocity,
        radius: habitatConfig.radius,
        omega,
        frameAngle
      })
      notifyTourEvent(tourGuide, 'jump')
      audio.playJump()
      vibrate(12)
    }

    if (playerTraversal.mode === 'grounded' && locomotionIntent.detachRequested) {
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: locomotionIntent.detachLaunchVelocity,
        radius: habitatConfig.radius,
        omega,
        frameAngle
      })
    } else if (playerTraversal.mode === 'grounded' && !drive.driving) {
      stepGroundedPlayer(playerTraversal, {
        axisDistanceDelta: locomotionIntent.groundedAxis * 6 * deltaSeconds,
        tangentDistanceDelta: locomotionIntent.groundedTangent * 6 * deltaSeconds,
        radius: habitatConfig.radius,
        length: habitatSpan,
        deltaSeconds,
        omega,
        frameAngleEnd: frameAngle,
        sampleGroundHeight
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
        // Top speed scales with the colony, so a jetpack feels fast across a
        // huge habitat (Izma R=3200 → ~48 m/s) without instantly overshooting a
        // tiny one (Playground → the 16 floor). The old flat 14 m/s made
        // crossing a km-scale colony a slog. Raise the factor for more speed.
        maxSpeed: THREE.MathUtils.clamp(habitatConfig.radius * 0.015, 16, 80)
      })
    }

    if (playerTraversal.mode === 'grounded') {
      // Walking into a building is real now: the streamed building colliders
      // (P1) block the live body during the step — height-aware, so you still
      // walk over shorter neighbours — and the analytic footprint pushout is
      // gone. (Rooftops keep the analytic radial follow for now; the colliders
      // hold the body just under it without conflict.)
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
    cityscape.setFocusAzimuth(playerAzimuth)

    // Stream the building colliders to whatever we're controlling — the car
    // while driving, otherwise the walker — before stepping.
    cityColliders.update(
      drive.driving ? drive.surface.azimuth : playerAzimuth,
      drive.driving ? drive.surface.axialPosition : playerFixedColliderPosition.y
    )
    physicsWorld.timestep = deltaSeconds
    physicsWorld.step()
    syncPlayerTraversalFromPhysics(playerTraversal)
    syncGroundedSurfaceFromPhysics(playerTraversal, frameAngle)

    if (drive.driving) {
      drive.postStep({ frameAngle, units: getUnits() })
      resetPlayerToGrounded(playerTraversal, {
        axialPosition: drive.surface.axialPosition,
        azimuth: drive.surface.azimuth,
        radius: habitatConfig.radius,
        frameAngle,
        omega
      })
      car.setPose(
        drive.surface.azimuth,
        drive.surface.axialPosition,
        drive.heading,
        habitatConfig.radius
      )
    }
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

    // Track the fall: the deepest recent outward speed sets how hard the
    // upcoming landing is (slow decay so a long drop is not forgotten by a
    // gentle final touchdown).
    if (playerTraversal.mode === 'free-fly') {
      inertialPositionToRotating(playerTraversal.inertialPosition, frameAngle, fallProbePosition)
      inertialVelocityToRotating(
        playerTraversal.inertialPosition,
        playerTraversal.inertialVelocity,
        omega,
        frameAngle,
        fallProbeVelocity
      )
      const fallRadial = Math.hypot(fallProbePosition.x, fallProbePosition.z)

      if (fallRadial > 1e-6) {
        const outwardSpeed =
          (fallProbeVelocity.x * fallProbePosition.x +
            fallProbeVelocity.z * fallProbePosition.z) /
          fallRadial
        fallSpeed = Math.max(outwardSpeed, fallSpeed * Math.exp(-deltaSeconds * 2))
      }
    }

    // Walking is physics now: free-fly ends the moment the body has settled
    // onto the wall — jumps, overlook drops, and clutch flights all land the
    // same natural way.
    let landed = false
    if (!drive.driving) {
      landed = updatePlayerGroundContact(playerTraversal, {
        radius: habitatConfig.radius,
        length: habitatSpan,
        frameAngle,
        omega,
        sampleGroundHeight
      })

      if (landed) {
        audio.playLand()
        vibrate(Math.min(10 + fallSpeed * 4, 45))
        // Knees flex with the impact: a brief view dip, springing back.
        landDipVelocity -= THREE.MathUtils.clamp((fallSpeed - 1) * 0.35, 0, 4.5)
        fallSpeed = 0
      }
    }

    if (drive.driving) {
      if (drive.lastCrashed && !wasCarCrashed) {
        vibrate(25)
      }

      wasCarCrashed = drive.lastCrashed
    } else {
      wasCarCrashed = false
    }

    // Critically damped spring brings the view back up after a landing dip.
    landDipVelocity +=
      (-LAND_DIP_STIFFNESS * LAND_DIP_STIFFNESS * landDipOffset -
        2 * LAND_DIP_STIFFNESS * landDipVelocity) *
      deltaSeconds
    landDipOffset = Math.max(-0.35, landDipOffset + landDipVelocity * deltaSeconds)
    landingSettle *= Math.exp(-Math.max(0, deltaSeconds) / LANDING_SETTLE_TAU)
    viewRig.position.y = landDipOffset + landingSettle + (drive.driving ? DRIVER_VIEW_RAISE : 0)

    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)

    if (drive.driving) {
      // Driver view: same surface anchor, but facing the car's heading.
      drive.getRigQuaternion(playerRig.quaternion)
    }

    // Landing eye handoff: free-fly tracks the body's real position; grounded
    // snaps to the pinned standing height. On the landing frame, seed the
    // settle with the actual gap (last frame's free-fly eye vs this frame's
    // pinned eye, projected onto the colonist's up) so the spring eases it away
    // instead of popping. Skipped in XR (the head is tracked).
    if (landed && hasEyePrev && !renderer.xr.isPresenting) {
      camera.getWorldPosition(eyeWorldNow)
      eyeUp.set(0, 1, 0).applyQuaternion(playerRig.quaternion).normalize()
      landingSettle = THREE.MathUtils.clamp(
        (eyeWorldPrev.x - eyeWorldNow.x) * eyeUp.x +
          (eyeWorldPrev.y - eyeWorldNow.y) * eyeUp.y +
          (eyeWorldPrev.z - eyeWorldNow.z) * eyeUp.z,
        -2,
        2
      )
      viewRig.position.y = landDipOffset + landingSettle + (drive.driving ? DRIVER_VIEW_RAISE : 0)
    }
    camera.getWorldPosition(eyeWorldPrev)
    hasEyePrev = true

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
        buildings: cityscape.getCollisionIndex()
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

    // Felt g-force: difference the active body's real inertial velocity (resync
    // across the walk↔drive handoff so the swap isn't read as a spike). It
    // reads ~1g on the wall and drains toward 0 as the car cancels the spin.
    // Driving uses a longer low-pass: near float the wheels barely touch, so
    // seam micro-bumps would jitter the readout; walking keeps the crisp one so
    // landings still spike.
    if (drive.driving !== feltAccelDriving) {
      feltAccelerometer.resync()
      feltAccelerometer.setSmoothingTime(drive.driving ? 0.7 : 0.2)
      feltAccelDriving = drive.driving
    }
    const feltGravity = feltAccelerometer.sample(
      drive.driving ? drive.lastInertialVelocity : playerTraversal.inertialVelocity,
      drive.driving ? drive.lastInertialPosition : playerTraversal.inertialPosition,
      deltaSeconds
    )
    const feltSpeed = drive.driving ? drive.lastSpeed : -1

    const watchSnapshot = createWatchRenderSnapshot(settingsStore, {
      playerMode: playerTraversal.mode,
      region: playerRegion,
      watchMenuOpen,
      observerMode: effectiveObserverMode,
      trailMode: debugVisuals.trailMode,
      ballCount: balls.length,
      feltGravity,
      feltSpeed,
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
      feltGravity,
      feltSpeed,
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
    beatBar.setVisible(!renderer.xr.isPresenting && !drive.driving)
    beatBar.update({
      rpm: habitatConfig.rpm,
      feltGravity,
      axisAvailable: canRespawnOnAxisEnd(habitatConfig.type)
    })
    debugGui?.update()
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

    // Aim the right pointer at the car to highlight it; pull the trigger to
    // climb in. Gated off while the watch UI owns the laser or while driving.
    rightLaserOverCar = false
    if (
      renderer.xr.isPresenting &&
      xrWatchInput.rightController &&
      !watchUiHot &&
      !drive.driving
    ) {
      car.group.updateWorldMatrix(true, true)
      carRaycaster.setFromXRController(xrWatchInput.rightController)
      rightLaserOverCar = carRaycaster.intersectObject(car.group, true).length > 0
    }
    car.setHighlighted(rightLaserOverCar)

    if (renderer.xr.isPresenting && xrWatchInput.rightTriggerPressed) {
      watchPanel.clickHovered()
    }

    dayNightPhase = stepDayNightPhase(
      dayNightPhase,
      deltaSeconds,
      settingsStore.environment.dayCycleSeconds
    )
    const daylight = getDaylight(dayNightPhase)
    light.intensity = 0.22 + daylight * 0.9

    for (const windowSun of windowSuns) {
      windowSun.intensity = 0.06 + daylight * 1.25
      // Color temperature drops toward sunset: warm low sun, white noon.
      windowSun.color.lerpColors(sunLowColor, sunNoonColor, Math.min(1, daylight * 2))
    }

    // Colour grade from the active look's keyframed profile (warm dusk for
    // Izma, cool legacy for the rest). Light intensities stay on `daylight`
    // above; this drives only the haze/space/sun colour and exposure.
    sampleSkyGrade(dayNightPhase, getSkyLook(habitatConfig.skyLook), skyGrade)
    fog.color.copy(skyGrade.fog)
    habitat.setAtmosphere(fog.color, fog.density)
    ;(scene.background as THREE.Color).copy(skyGrade.background)
    sun.setGrade(skyGrade.sunCore, skyGrade.sunGlow, skyGrade.sunGlowScale)
    atmosphereGlow.setDimensions({
      radius: habitatConfig.radius,
      length: getHabitatSpan(habitatConfig)
    })
    // The air column glows with the sky colour, brighter by day, faint at night.
    atmosphereGlow.setGrade(skyGrade.fog, 0.08 + daylight * 0.24)
    renderer.toneMappingExposure = skyGrade.exposure
    cityscape.setSkyColor(skyGrade.fog)
    cityscape.setDaylight(daylight)
    spaceport.update(deltaSeconds)

    // Lightweight state probe for headless debugging.
    inertialPositionToRotating(playerTraversal.inertialPosition, frameAngle, rotatingCameraPosition)
    ;(window as unknown as { __spinward?: unknown }).__spinward = {
      mode: playerTraversal.mode,
      radial: Math.hypot(rotatingCameraPosition.x, rotatingCameraPosition.z),
      radius: habitatConfig.radius,
      axial: rotatingCameraPosition.y,
      speed: playerTraversal.inertialVelocity.length(),
      frameAngle,
      groundHeight: playerTraversal.groundHeight,
      dip: landDipOffset,
      drive: {
        driving: drive.driving,
        azimuth: drive.surface.azimuth,
        axial: drive.surface.axialPosition,
        heading: drive.heading,
        crashed: drive.lastCrashed,
        grounded: drive.lastGrounded,
        speed: drive.lastSpeed,
        gap: drive.lastRadialGap,
        contacts: drive.lastContacts
      }
    }

    desktopQuickPanel.update(desktopUiCamera, watchSnapshot, !renderer.xr.isPresenting)
    if (mobileControls !== null) {
      mobileControls.update(renderer.xr.isPresenting)
      mobileControls.setDriving(drive.driving)
      mobileControls.setDriveAvailable(
        drive.driving ||
          (playerTraversal.mode === 'grounded' &&
            drive.isPlayerNear(
              playerTraversal.surface.azimuth,
              playerTraversal.surface.axialPosition,
              habitatConfig.radius
            ))
      )
    }
    tourCardPanel.update(stepTourGuide(tourGuide, deltaSeconds), {
      camera: desktopUiCamera,
      deltaSeconds,
      xrActive: renderer.xr.isPresenting
    })
    if (bloomComposer !== null && bloomRenderPass !== null && !renderer.xr.isPresenting) {
      bloomRenderPass.camera = desktopUiCamera
      if (bloomPass !== null) {
        // Subtle by day (sun glow), full at night (city lights).
        bloomPass.strength = BLOOM_BASE_STRENGTH * (0.25 + (1 - daylight) * 0.75)
      }
      bloomComposer.render()
    } else {
      renderer.render(scene, desktopUiCamera)
    }
  })

  notifyTourEvent(tourGuide, 'start')
  // First-boot "look up" reveal: show the far side of the colony overhead
  // before the player settles. Desktop/mobile only; XR is head-tracked.
  if (!renderer.xr.isPresenting) {
    desktopLookControls.startIntroReveal()
  }
  gameLoop.start()

  const splash = document.getElementById('splash')

  if (splash !== null) {
    splash.classList.add('splash--done')
    window.setTimeout(() => splash.remove(), 700)
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    inertialObserverCamera.aspect = window.innerWidth / window.innerHeight
    inertialObserverCamera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    bloomComposer?.setSize(window.innerWidth, window.innerHeight)
  })

  window.addEventListener('beforeunload', () => {
    // Stop ticking before freeing physics, or a final frame races the
    // disposed Rapier world.
    renderer.setAnimationLoop(null)
    bloomComposer?.dispose()
    drive.dispose()
    car.dispose()
    cityscape.dispose()
    spaceport.dispose()
    sun.dispose()
    atmosphereGlow.dispose()
    tourCardPanel.dispose()
    mobileControls?.dispose()
    fullscreenToggle?.dispose()
    desktopLookControls.dispose()
    disposePlayerTraversalState(playerTraversal)
    cityColliders.dispose()
    cylinderWall.dispose()
    vrLocomotion?.clutchDebug.dispose()
    physicsWorld.free()
    debugGui?.destroy()
  })

  console.info(
    `Cylinder axis: Y, Omega: (0, ${rpmToOmega(habitatConfig.rpm).toFixed(3)}, 0), g=${settingsStore.getSurfaceGravity().toFixed(2)}`
  )
}
