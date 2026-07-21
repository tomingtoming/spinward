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
import { loadDepthMode, toggleDepthModeAndReload } from './depthMode'
import { DesktopLookControls } from './desktopLookControls'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import { createPerfMeter } from './perfMeter'
import { getDaylight, stepDayNightPhase } from './dayNight'
import { computeAmbienceMix } from './ambienceMix'
import { capturePhoto } from './photoMode'
import {
  decodeShareState,
  encodeShareState,
  type ShareOrientation,
  type SharePose
} from './shareLink'
import { createWeatherState, stepWeather } from './weather'
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
  respawnPlayerExteriorRuntime,
  respawnPlayerInnerWallRuntime,
  respawnPlayerOldTownRuntime,
  respawnPlayerOverlookRuntime
} from './playerRespawnRuntime'
import {
  createTourGuideState,
  notifyTourEvent,
  resolveTourCard,
  stepTourGuide
} from './tourGuide'
import { getSurfacePosition, type SurfaceRigState } from './surfaceRig'
import { Ball } from '../objects/ball'
import { Explosions } from '../objects/explosion'
import { PROJECTILES, cycleProjectile, type ProjectileType } from '../gameplay/projectileTypes'
import { Car } from '../objects/car'
import {
  getArrivalSquare,
  getCityExpressway,
  getCityGroundHeight,
  getExpresswayElevation,
  getPlazaTangentHalfWidth,
  resolveCitySurfaceCollision
} from '../objects/cityLayout'
import { Cityscape } from '../objects/cityscape'
import { CylinderHabitat } from '../objects/cylinder'
import { RainStreaks } from '../objects/rain'
import { ForceVectorArrows } from '../objects/forceVectors'
import { Spaceport } from '../objects/spaceport'
import { Starfield } from '../objects/starfield'
import { Sun } from '../objects/sun'
import { AtmosphereGlow } from '../objects/atmosphereGlow'
import { getQualityProfile } from './quality'
import { MobileControls, isQuestBrowser, isTouchDevice } from '../pc/mobileControls'
import { createFullscreenToggle } from '../pc/fullscreen'
import { JUMP_SPEED, computeJumpLaunchVelocity } from '../gameplay/jump'
import {
  respawnAxisEnd,
  respawnExterior,
  respawnInnerWall,
  respawnOldTown,
  respawnOverlook
} from '../gameplay/respawn'
import { computeThrowVelocityReal } from '../gameplay/throwVelocity'
import { computeThrowChargeRatio } from '../xr/throwCharge'
import type { ControlPlatform } from '../xr/controlScheme'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { applyPresetToSettingsStore, canRespawnOnAxisEnd, getPresetById, getPresetName } from '../presets/presetManager'
import { inertialPositionToRotating, inertialVelocityToRotating } from '../sim/frameTransforms'
import { createRainSample, sampleRainField } from '../sim/rainField'
import {
  getAirColumnFraction,
  getAtmosphereDepth,
  getHabitatSpan
} from '../sim/habitatConfig'
import { createSettingsStore } from '../state/settingsStore'
import { createDebugGui } from '../ui/debugGui'
import { createBeatBar } from '../ui/beatBar'
import { createDockBar } from '../ui/dockBar'
import { createShareBar } from '../ui/shareBar'
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
  // The preset a session is BASED on, kept across parameter tweaks: the store
  // flips currentPresetId to 'custom' on any adjustment, but a share link must
  // still name the base habitat (topology, sky look) plus the divergences.
  let lastAppliedPresetId =
    requestedPreset !== null && getPresetById(requestedPreset) !== null
      ? requestedPreset
      : 'izma'
  applyPresetToSettingsStore(settingsStore, lastAppliedPresetId)
  // Share links restore spin / dimensions / time-of-day / pose on top of the
  // preset boot (?rain feeds the weather state below, ?preset= above).
  const shareState = decodeShareState(window.location.search)
  if (shareState.rpm !== null) {
    settingsStore.setHabitatConfig({ rpm: shareState.rpm })
  }
  if (shareState.radius !== null) {
    settingsStore.setHabitatConfig({ radius: shareState.radius })
  }
  if (shareState.length !== null) {
    settingsStore.setHabitatConfig({ length: shareState.length })
  }
  const habitatConfig = settingsStore.habitat
  const reattachTuning = settingsStore.reattach
  const initialSurfaceState: SurfaceRigState = {
    axialPosition: 0,
    azimuth: 0
  }
  const debugVisuals = {
    // Off by default — the fictitious-force arrows on projectiles are a debug aid,
    // toggled back on via the debug GUI (?debug).
    showForceVectors: false,
    forceVectorScale: 0.08,
    showHud: true,
    observerMode: 'colony-fixed' as const,
    trailMode: 'rotating' as const
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
  // keyframed profile; Izma keeps a physically honest neutral grade (no warm
  // sunset — a cylinder has no limb), other presets keep the cool legacy grade.
  // Boot at the look's chosen time of day.
  const skyGrade = createSkyGrade()
  let dayNightPhase =
    shareState.dayNightPhase ?? getInitialDayNightPhase(habitatConfig.skyLook)
  const audio = new GameAudio()
  // The Sun's true (Sol) colour. The colony beam stays this at every hour — see
  // the setSunlight call below for why colony dusk carries no warm tint.
  const sunBeamColor = new THREE.Color(0xfff6ee)
  const worldRoot = new THREE.Group()
  const skyLayer = new THREE.Group()
  const farLayer = new THREE.Group()
  const nearLayer = new THREE.Group()
  scene.add(worldRoot)
  worldRoot.add(skyLayer, farLayer, nearLayer)
  // Impact bursts for the beam / firework bolts live alongside the balls in the
  // colony-fixed near layer.
  const explosions = new Explosions(nearLayer)

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
    {
      maxBuildings: quality.maxBuildings,
      farMinAngularSize: quality.farMinAngularSize,
      maxTraffic: quality.maxTraffic,
      detailedLod0Distance: quality.detailedLod0Distance,
      detailedLod1Distance: quality.detailedLod1Distance,
      maxDetailedLod0: quality.maxDetailedLod0,
      maxDetailedLod1: quality.maxDetailedLod1,
      lod1FullKitGeometry: quality.lod1FullKitGeometry,
      roadTileDistance: quality.roadTileDistance
    }
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

  // Weather: rain streaks live in the colony-fixed layer (drops co-move with
  // the air, minus the analytic Coriolis lag). `?rain` deep-links a shower —
  // decoded by the share codec so the whole URL scheme lives in one module.
  const weather = createWeatherState(shareState.raining)
  const rain = new RainStreaks(quality.rainStreaks)
  rain.setBounds(habitatConfig.radius)
  nearLayer.add(rain.lines)
  const rainSample = createRainSample()
  const carrierRotatingPosition = new THREE.Vector3()
  const carrierRotatingVelocity = new THREE.Vector3()

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
  // Whether the one-time boot flash of the CONTROL card has fired — armed by
  // the game loop the first time no tour card is on screen.
  let controlsBootFlashDone = false
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
  // But log depth writes gl_FragDepth, which disables early-Z — on tile GPUs
  // (Quest, phones) every occluded fragment of the night city still shades.
  // The wrist RENDER card toggles 'log' vs 'plain' (persisted; ?depth= URL
  // param overrides) to price that tax on-device. Reversed-Z would give both,
  // but three's WebXR path takes projection matrices straight from the XR
  // runtime, so the reversedDepthBuffer flag cannot apply in-headset.
  const depthMode = loadDepthMode()
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: depthMode === 'log'
  })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  // The perf meter reads renderer.info once per game-loop tick; manual reset
  // lets the counters accumulate across bloom's sub-passes instead of being
  // wiped by every internal render() call.
  renderer.info.autoReset = false
  const perfMeter = createPerfMeter()

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
    renderer.domElement,
    // Right-click (a tap, not a look-drag) cycles the throwable — the mouse
    // equivalent of X, for players who never look down at the keyboard.
    () => cycleSelectedProjectile()
  )
  // One bottom row holds everything. Created before mobileControls so its
  // button row can measure the dock's actual height and stay clear of it
  // (see MobileControls.dockRoot).
  const dock = createDockBar()

  // The Quest browser reports as a touch device, so the on-screen controls are
  // built there too: they remain the usable fallback if immersive VR turns out
  // unavailable, and get switched off below once a VR session is confirmed.
  const mobileControls = isTouchDevice()
    ? new MobileControls(
        camera,
        renderer.domElement,
        {
          onThrow: () => requestDesktopThrow(),
          onJump: () => {
            desktopJumpQueued = true
          },
          onToggleDrive: () => tryToggleDrive(),
          isUiPointerBlocked: () => false,
          onUserInput: () => desktopLookControls.cancelIntroReveal()
        },
        dock.root
      )
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

  // VR is a right-hand action → right cluster. Fullscreen is a system toggle →
  // it leads the left cluster, ahead of the HUD chips.
  const mountVrButton = () => dock.right.appendChild(VRButton.createButton(renderer))
  let fullscreenToggle: ReturnType<typeof createFullscreenToggle> = null

  if (!onQuest) {
    fullscreenToggle = createFullscreenToggle()

    if (fullscreenToggle !== null) {
      dock.left.appendChild(fullscreenToggle.button)
    }
  }

  if (!isTouchDevice()) {
    // Without navigator.xr at all (desktop Safari / Firefox), three's VRButton
    // returns a bare "WEBXR NOT AVAILABLE" <a> that lacks the #VRButton id, so
    // the dock CSS cannot capture it and it floats over the scene. Mount
    // nothing, matching how unsupported touch devices are handled below.
    if ('xr' in navigator) {
      mountVrButton()
    }
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

  // The one-shot 'start' intro card fires at boot, before a Quest player has
  // the headset on (and outside XR the dock/tour overlay they were looking at
  // is the flat screen). Replay it on the first VR entry so the VR player
  // actually sees the intro; later re-entries stay quiet.
  let vrStartCardReplayed = false
  renderer.xr.addEventListener('sessionstart', () => {
    if (vrStartCardReplayed) {
      return
    }

    vrStartCardReplayed = true
    tourGuide.shown.delete('start')
    notifyTourEvent(tourGuide, 'start')
  })

  // Ambient fill only — the colony's directional sunlight is owned by the
  // cityscape, which rigs it to the actual daylighting geometry (mirror-reflected
  // beams for Izma, an axial end-sun for the full-360 colonies) and re-rigs it on
  // a preset switch. This hemisphere stands in for the soft earthshine/city
  // bounce that keeps the night side from going pitch black.
  const light = new THREE.HemisphereLight(0xdfeeff, 0x33404e, 1.1)
  scene.add(light)

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
    units: getUnits(),
    expressway: getCityExpressway(habitatConfig.radius, getHabitatSpanMeters())
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
      habitatConfig.radius - drive.parkedElevation
    )
  }

  parkCarNearPlaza()
  const balls: Ball[] = []
  const forceVectorArrows = new ForceVectorArrows()
  const controllerVelocity = new ControllerVelocityTracker()
  const worldForward = new THREE.Vector3()
  const worldPosition = new THREE.Vector3()
  const controllerWorldProbe = new THREE.Vector3()
  const worldVelocity = new THREE.Vector3()
  const controllerLocalVelocity = new THREE.Vector3()
  const controllerCarrierVelocity = new THREE.Vector3()
  const controllerParentQuaternion = new THREE.Quaternion()
  const throwDebugDirection = new THREE.Vector3()
  const rotatingCameraPosition = new THREE.Vector3()
  const rotatingCameraOrientation = new THREE.Quaternion()
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
  // Queued desktop throw: the held-seconds of the ball charge, or null when idle.
  let desktopThrowQueued: number | null = null
  // Left-button hold tracking for the PC ball charge-shot.
  let desktopCharging = false
  let desktopChargeStartMs = 0
  let desktopJumpQueued = false
  // The throwable currently selected; cycle with X (PC) / right stick-click (VR).
  let selectedProjectile: ProjectileType = 'ball'
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

  const throwDebugArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(),
    1,
    0x67e8f9
  )
  throwDebugArrow.visible = false
  nearLayer.add(throwDebugArrow)
  nearLayer.add(forceVectorArrows.group)

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

      // The bolt's POSITION should come from the visible hand (grip), but the
      // event only hands us the target-ray controller — look its grip up by
      // identity. Undefined (no match) falls back to the controller in spawn.
      const firingGrip = grabSystem
        .getControllers()
        .find((c) => c.controller === controller)?.grip
      const projectile = spawnProjectile(selectedProjectile, {
        origin: controller,
        positionSource: firingGrip,
        releasedByController: controller
      })
      // Bolts fire on the trigger press; only the grabbable ball is held to throw.
      return PROJECTILES[selectedProjectile].grabbable ? projectile.grabTarget : null
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
  scene.add(watchPanel.group)
  vrLocomotion.setProfile(settingsStore.getLocomotionProfile())
  settingsStore.subscribe(() => {
    settingsDirty = true
    vrLocomotion.setProfile(settingsStore.getLocomotionProfile())
  })

  const clearAllBalls = () => {
    clearBalls(balls, (grabTarget) => {
      grabSystem.unregisterTarget(grabTarget)
    })
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

  const respawnPlayerOldTown = () => {
    const didRespawn = respawnPlayerOldTownRuntime(
      {
        respawnOldTown,
        applyPlayerTraversalState
      },
      {
        playerTraversal,
        playerRig,
        length: getHabitatSpanMeters(),
        radius: habitatConfig.radius,
        frameAngle,
        omega: rpmToOmega(habitatConfig.rpm)
      }
    )
    if (didRespawn) {
      // Arrive facing down the construction timeline: the old town around
      // you, the civic core far down the axial boulevard ahead.
      desktopLookControls.resetLook()
      mobileControls?.resetLook()
      vrLocomotion?.faceAxis(1)
    }
    return didRespawn
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

  const exteriorFacing = new THREE.Vector3()
  const respawnPlayerExterior = () => {
    const didRespawn = respawnPlayerExteriorRuntime(
      {
        respawnExterior,
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
    // Look back at the colony from the exterior vantage. The colony centre is the
    // world origin, so face the negated rig position. (VR keeps head-look.)
    if (didRespawn && !renderer.xr.isPresenting) {
      exteriorFacing.copy(playerRig.position).negate()
      desktopLookControls.faceDirection(exteriorFacing)
    }
    return didRespawn
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
      .multiplyScalar(
        habitatConfig.radius - drive.parkedElevation - PLAYER_DISMOUNT_HEIGHT
      )
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
      habitatConfig.radius - drive.parkedElevation
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
        lastAppliedPresetId = runtimeAction.presetId
        applyPresetToSettingsStore(settingsStore, runtimeAction.presetId)
        clearAllBalls()
        rebuildPlayerTraversal('inner-wall')
        drive.rebuild({ rapier, world: physicsWorld, units: getUnits() })
        parkCarNearPlaza()
        syncHabitat()
        settingsDirty = false
        return true
      case 'rain-toggle':
        audio.playClick()
        setRaining(!weather.raining)
        return true
      case 'depth-toggle':
        audio.playClick()
        toggleDepthModeAndReload(depthMode)
        return true
      case 'respawn':
        audio.playClick()
        if (runtimeAction.mode === 'inner-wall') {
          notifyTourEvent(tourGuide, 'surface')
          return respawnPlayerInnerWall()
        }
        if (runtimeAction.mode === 'old-town') {
          return respawnPlayerOldTown()
        }
        if (runtimeAction.mode === 'overlook') {
          notifyTourEvent(tourGuide, 'overlook')
          return respawnPlayerOverlook()
        }
        if (runtimeAction.mode === 'exterior') {
          return respawnPlayerExterior()
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
    // fog.density is owned by the frame loop (it folds the live rain level in
    // every frame); nothing to set here.
    rain.setBounds(habitatConfig.radius)
  }

  syncHabitat()

  // The control scheme to display: VR while presenting, SP on a touchscreen,
  // else PC. Drives the HUD's CONTROL card and the tour cards' control lines.
  const currentControlPlatform = (): ControlPlatform =>
    renderer.xr.isPresenting ? 'vr' : isTouchDevice() ? 'sp' : 'pc'

  const hud = createHud(
    dock.left,
    // Reuses the exact same action the Tab panel's Habitat preset buttons
    // used to dispatch, so there is one reset sequence, not two.
    (presetId) => handleWatchAction(`preset-apply-${presetId}` as WatchActionId),
    (projectile) => selectProjectile(projectile)
  )
  // Always-visible self-driving nav (non-VR): Travel + Spin so the demo's
  // payoff beats don't hide behind 1/2/3 and Tab. These are right-hand actions,
  // so they live in the right cluster (prepended before the VR button).
  const setRaining = (raining: boolean) => {
    weather.raining = raining
    if (raining) {
      notifyTourEvent(tourGuide, 'rain')
    }
  }
  const beatBar = createBeatBar((action) => handleWatchAction(action), dock.right, () =>
    setRaining(!weather.raining)
  )

  // Fold the current view into a URL: opening it boots at this exact spot,
  // look, hour, spin and weather. The photo burns the wordmark + site in, so
  // a posted image and "see it yourself" travel together.
  const shareQuaternionScratch = new THREE.Quaternion()
  const shareFreeFlyScratch = new THREE.Vector3()
  const buildShareUrl = () => {
    camera.updateWorldMatrix(true, false)
    camera.getWorldQuaternion(shareQuaternionScratch)
    const grounded = drive.driving || playerTraversal.mode === 'grounded'
    const surface = drive.driving ? drive.surface : playerTraversal.surface
    const pose: SharePose = grounded
      ? {
          mode: 'grounded',
          azimuth: surface.azimuth,
          axialPosition: surface.axialPosition,
          // Rooftops: without this a shared rooftop vista restores at street
          // level, inside the building the sharer was standing on.
          groundHeight: playerTraversal.groundHeight
        }
      : {
          mode: 'free-fly',
          position: inertialPositionToRotating(
            playerTraversal.inertialPosition,
            frameAngle,
            shareFreeFlyScratch
          )
        }
    // The base preset survives parameter tweaks (currentPresetId flips to
    // 'custom' on any adjustment); divergent spin/dimensions ride as overrides.
    const preset = getPresetById(lastAppliedPresetId)
    const query = encodeShareState({
      presetId: lastAppliedPresetId,
      rpm: habitatConfig.rpm,
      presetRpm: preset?.real.rpm ?? null,
      radius: habitatConfig.radius,
      presetRadius: preset?.real.radius_m ?? null,
      length: habitatConfig.length,
      presetLength: preset?.real.length_m ?? null,
      dayNightPhase,
      raining: weather.raining,
      pose,
      orientation: shareQuaternionScratch
    })
    return `${window.location.origin}${window.location.pathname}?${query}`
  }

  // Boot-time restore of a shared pose: seat the traversal state first, then
  // recover the look. Grounded hands yaw/pitch to the look controls (they own
  // the camera euler); free-fly sets the camera directly and the controls'
  // grounded→free-fly seeding adopts it into the rig attitude on frame one.
  const applySharedPose = (pose: SharePose, orientation: ShareOrientation | null) => {
    const omega = rpmToOmega(habitatConfig.rpm)
    const habitatSpan = getHabitatSpan(habitatConfig)

    // The codec only guarantees finiteness; the bounds live here where the
    // habitat is known. Clamping (not rejecting) keeps a coordinate-mangled
    // link opening somewhere sensible instead of in empty black space.
    if (pose.mode === 'grounded') {
      const halfSpan = Math.max(0, habitatSpan * 0.5 - 1.5)
      resetPlayerToGrounded(playerTraversal, {
        axialPosition: THREE.MathUtils.clamp(pose.axialPosition, -halfSpan, halfSpan),
        azimuth: THREE.MathUtils.euclideanModulo(pose.azimuth, Math.PI * 2),
        radius: habitatConfig.radius,
        frameAngle,
        omega,
        groundHeight: THREE.MathUtils.clamp(pose.groundHeight, 0, habitatConfig.radius * 0.5)
      })
    } else {
      shareFreeFlyScratch.set(pose.position.x, pose.position.y, pose.position.z)
      // Radial cap comfortably beyond the Exterior vantage (1.6 R), axial cap
      // half a span beyond either end.
      const radial = Math.hypot(shareFreeFlyScratch.x, shareFreeFlyScratch.z)
      const maxRadial = habitatConfig.radius * 2.5
      if (radial > maxRadial) {
        const scale = maxRadial / radial
        shareFreeFlyScratch.x *= scale
        shareFreeFlyScratch.z *= scale
      }
      shareFreeFlyScratch.y = THREE.MathUtils.clamp(
        shareFreeFlyScratch.y,
        -habitatSpan,
        habitatSpan
      )
      resetPlayerToFreeFly(playerTraversal, {
        rotatingPosition: shareFreeFlyScratch,
        frameAngle,
        omega
      })
    }

    applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)

    if (orientation === null) {
      return
    }

    shareQuaternionScratch.set(orientation.x, orientation.y, orientation.z, orientation.w)
    // The camera's parent chain must be in its steady state (spawn view yaw on
    // the viewRig) before the shared world orientation is folded into a local.
    vrLocomotion.applySpawnView()
    viewRig.updateWorldMatrix(true, false)
    const cameraLocal = viewRig
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(shareQuaternionScratch)

    if (pose.mode === 'grounded') {
      const euler = new THREE.Euler().setFromQuaternion(cameraLocal, 'YXZ')
      desktopLookControls.setLook(euler.y, euler.x)
    } else {
      camera.quaternion.copy(cameraLocal)
    }
  }

  const shareBar = createShareBar(dock.right, {
    onShareLink: async () => {
      const url = buildShareUrl()

      // Touch gets the system share sheet (X/LINE/etc. one tap away);
      // desktop copies. A dismissed sheet falls through to the clipboard.
      if (isTouchDevice() && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'Spinward', url })
          return 'shared'
        } catch {
          // fall through
        }
      }

      try {
        await navigator.clipboard.writeText(url)
        return 'copied'
      } catch {
        return 'failed'
      }
    },
    onPhoto: () =>
      capturePhoto(
        renderer.domElement,
        () => {
          // Fresh pixels: the drawing buffer is cleared after compositing, so
          // re-render synchronously along the same path the loop uses.
          if (bloomComposer !== null && !renderer.xr.isPresenting) {
            bloomComposer.render()
          } else {
            renderer.render(scene, camera)
          }
        },
        {
          url: 'spinward.toming.app',
          filename: `spinward-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`
        }
      )
  })

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

  if (debugEnabled) {
    // Console access for headless/manual debugging — same ?debug gate as the
    // lil-gui panel, absent from a normal session. __spinwardDrive lets a
    // debugging session teleport the rover to a spot (e.g. a ramp mouth) and
    // enter it without a minutes-long manual drive at software-GL framerates.
    ;(window as unknown as Record<string, unknown>).__spinwardScene = scene
    ;(window as unknown as Record<string, unknown>).__spinwardDrive = {
      runtime: drive,
      world: physicsWorld,
      enterAt: (azimuth: number, axialPosition: number, heading: number) => {
        drive.parkAt(azimuth, axialPosition, heading)
        drive.enter(frameAngle, rpmToOmega(habitatConfig.rpm), habitatConfig.radius, {
          rapier,
          world: physicsWorld,
          units: getUnits()
        })
        // Seat the rig at the car (same as VR pointer entry), so the driver
        // camera actually rides along in a remote debug session.
        resetPlayerToGrounded(playerTraversal, {
          axialPosition: drive.surface.axialPosition,
          azimuth: drive.surface.azimuth,
          radius: habitatConfig.radius,
          frameAngle,
          omega: rpmToOmega(habitatConfig.rpm)
        })
        applyPlayerTraversalState(playerRig, playerTraversal, habitatConfig.radius, frameAngle)
        desktopLookControls.resetLook()
      }
    }
  }

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

  const spawnProjectile = (
    type: ProjectileType,
    {
      origin,
      positionSource,
      releasedByController,
      heldSeconds = 0
    }: {
      origin: THREE.Object3D
      // Visible-hand (grip) space used for the SPAWN POSITION while `origin`
      // (target-ray) stays the AIM. Optional: desktop falls back to `origin`.
      positionSource?: THREE.Object3D
      releasedByController?: THREE.XRTargetRaySpace
      // Desktop ball charge: how long the mouse was held (0 = a plain tap).
      heldSeconds?: number
    }
  ) => {
    const spec = PROJECTILES[type]
    const omega = rpmToOmega(habitatConfig.rpm)

    // POSITION comes from the visible hand (grip) when present; AIM always comes
    // from the target-ray `origin`. three.js getControllerGrip returns a non-null
    // object even before it is posed, when its world matrix is still at the rig
    // origin — so `?? origin` alone is not enough. Fall back to the target-ray
    // controller unless the grip resolves to a position close to it (i.e. it is
    // actually tracked); a collapsed/unposed grip sits metres away at the rig
    // centre and would otherwise spawn the shot at the player's feet.
    let posSource: THREE.Object3D = positionSource ?? origin
    if (positionSource !== undefined && positionSource !== origin) {
      positionSource.getWorldPosition(worldPosition)
      origin.getWorldPosition(controllerWorldProbe)
      if (worldPosition.distanceToSquared(controllerWorldProbe) > 0.25) {
        posSource = origin
      }
    }
    posSource.getWorldPosition(worldPosition)
    getForwardDirection(origin, worldForward)
    // Spawn just ahead of the muzzle. A bolt's body trails BACK from here (its
    // leading tip is the collision point). Grabbable balls keep the 0.35 m push
    // that stops a released ball clipping the hand. Fire-and-forget bolts spawn at
    // the visible hand (grip) plus only a SMALL clearance along the aim — their own
    // radius plus a ~5 cm pad — so the beam/firework reads as leaving the HAND. The
    // old fixed 0.4 m was sized for a 0.35 m-radius bolt, but the beam radius was
    // later cut to 0.14 m (projectileTypes) and the offset was never followed down:
    // 0.4 m along the Quest target-ray (which tilts ~20° below the grip) put the
    // streak ~0.38 m ahead of AND ~0.14 m below the hand — the "発射源ずれ" the user
    // kept seeing. Tying the offset to spec.radius keeps it from being orphaned
    // again. Safe at the hand: explodeOnImpact only bursts on the wall/city, never
    // the player, so a hand-adjacent muzzle cannot self-burst.
    const muzzleOffset = spec.grabbable ? 0.35 : spec.radius + 0.05
    spawnOffset.copy(worldForward).multiplyScalar(muzzleOffset)

    // Decide inside-vs-outside the colony ONCE here, from the spawn position.
    // A fast beam tunnels r<radius → r>>radius in a single frame, so a per-frame
    // radial gate would misclassify a valid interior shot; the spawn-time flag is
    // stable. worldPosition is the rotating-frame render position — the same frame
    // the inner-wall confine uses. The inward (radius − spec.radius) margin keeps a
    // point-blank interior shot (muzzle ≈ on the wall) flagged inside.
    const spawnPos = worldPosition.clone().add(spawnOffset)
    const halfSpan = getHabitatSpanMeters() * 0.5
    const insideHabitat =
      Math.hypot(spawnPos.x, spawnPos.z) < habitatConfig.radius - spec.radius &&
      Math.abs(spawnPos.y) <= halfSpan

    const ball = new Ball({
      physics: {
        rapier,
        world: physicsWorld,
        // Bolts don't bounce — they burst in place on first contact (restitution
        // 0 kills the rebound; explodeOnImpact despawns them the same frame).
        restitution: spec.explodeOnImpact ? 0 : restitution,
        units: getUnits()
      },
      initialPosition: spawnPos,
      radius: spec.radius,
      color: spec.color,
      emissive: spec.emissive !== 0 ? spec.emissive : undefined,
      explodeOnImpact: spec.explodeOnImpact,
      boltLength: spec.boltLength,
      // Orient the bolt mesh on frame 0 so it never flashes as a vertical stub
      // before the first step() runs orientToVelocity. Gated on boltLength so it
      // is a no-op for the firework (no bolt mesh). worldForward is the aim.
      initialAim: spec.boltLength !== undefined ? worldForward.clone() : undefined,
      confineToHabitat: insideHabitat,
      maxTrailPoints: habitatConfig.maxTrailPoints,
      lifetimeSeconds:
        spec.lifetimeSeconds > 0 ? spec.lifetimeSeconds : habitatConfig.ballLifetimeSeconds,
      frameAngle,
      omega,
      onBounce: (bouncedBall, impactSpeed) => {
        const distance = bouncedBall.position.distanceTo(playerFixedColliderPosition)
        const nearness = Math.min(1, 12 / (distance + 3))
        if (spec.explodeOnImpact) {
          explosions.spawn(bouncedBall.position, spec.explosionColor, spec.explosionRadius)
          // Heavy boom for bolts instead of the ball's light bounce ping.
          audio.playExplosion(nearness)
        } else {
          audio.playBounce(impactSpeed * nearness)
        }
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

    if (spec.launchSpeed > 0) {
      // Fire-and-forget bolts launch instantly at a fixed muzzle speed PLUS the
      // thrower's own motion. The carrier velocity matters even for the 10 km/s
      // beam: it keeps the bolt riding with a MOVING shooter so the streak stays
      // attached to the hand instead of being left behind (a beam fired while
      // jetpacking would otherwise trail off to the side of the moving hand).
      // The aim skew it adds is atan(|carrier|/launchSpeed) — negligible for the
      // beam, correct platform-inheritance for the slow firework.
      fillCarrierRotatingVelocity(controllerCarrierVelocity)
      worldVelocity
        .copy(worldForward)
        .multiplyScalar(spec.launchSpeed)
        .add(controllerCarrierVelocity)
      ball.setVelocity(worldVelocity)
    } else if (releasedByController !== undefined) {
      ball.setVelocity(new THREE.Vector3())
    } else {
      // Desktop ball throws inherit the thrower's motion AND a hold-to-charge
      // ramp: a tap leaves at the base 8 m/s, a full (~1.2 s) hold climbs to ~30.
      fillCarrierRotatingVelocity(controllerCarrierVelocity)
      const chargeSpeed =
        (8 + 22 * computeThrowChargeRatio(heldSeconds)) * habitatConfig.ballSpeedScale
      worldVelocity
        .copy(worldForward)
        .multiplyScalar(chargeSpeed)
        .add(controllerCarrierVelocity)
      ball.setVelocity(worldVelocity)
    }

    nearLayer.add(ball.mesh)
    // The beam bolt is its own streak; everything else draws a motion trail.
    if (spec.trail !== false) {
      nearLayer.add(ball.trail)
      nearLayer.add(ball.inertialTrail)
    }
    if (spec.grabbable) {
      grabSystem.registerTarget(ball.grabTarget)
    }
    balls.push(ball)
    notifyTourEvent(tourGuide, 'throw')

    return ball
  }

  const removeDisposedBalls = () => {
    removeExpiredBalls(balls, (grabTarget) => {
      grabSystem.unregisterTarget(grabTarget)
    })
  }

  const throwDesktopBall = (heldSeconds: number) => {
    if (renderer.xr.isPresenting) {
      return
    }

    spawnProjectile(selectedProjectile, { origin: camera, heldSeconds })
    audio.playThrow()
    vibrate(8)
  }

  // Queue a throw with the given charge (0 = a plain tap, used by the mobile tap).
  const requestDesktopThrow = (heldSeconds = 0) => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopThrowQueued = heldSeconds
  }

  const cycleSelectedProjectile = () => {
    selectedProjectile = cycleProjectile(selectedProjectile)
    audio.playClick()
    vibrate(6)
  }

  const selectProjectile = (type: ProjectileType) => {
    selectedProjectile = type
    audio.playClick()
    vibrate(6)
  }

  window.addEventListener('keydown', (event) => {
    audio.unlock()

    if (event.code === 'KeyM' && !event.repeat) {
      audio.toggleMuted()
    }

    if (renderer.xr.isPresenting) {
      return
    }

    // No menu lives behind Tab any more, but it still must not leave the
    // browser's default focus-cycling to steal keyboard/Space from gameplay.
    if (event.code === 'Tab') {
      event.preventDefault()
      return
    }

    if (event.code === 'KeyX') {
      cycleSelectedProjectile()
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

    if (event.code === 'Digit4') {
      handleWatchAction('respawn-exterior')
      return
    }

    if (event.code === 'Digit5') {
      handleWatchAction('respawn-old-town')
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

  renderer.domElement.addEventListener('pointerdown', (event) => {
    audio.unlock()

    if (event.button !== 0) {
      return
    }

    // Touch taps are handled by MobileControls (tap vs drag discrimination).
    if (event.pointerType === 'touch') {
      return
    }

    // Beam / firework are instant bolts: fire on press. The ball charges while
    // the button is held and throws on release (see the pointerup below) — hold
    // longer to throw harder.
    if (PROJECTILES[selectedProjectile].launchSpeed > 0) {
      requestDesktopThrow(0)
    } else {
      desktopCharging = true
      desktopChargeStartMs = performance.now()
    }
  })

  // Release of the held left button throws the charged ball. On window (not the
  // canvas) so a drag that ends off-canvas still releases the shot.
  window.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || !desktopCharging) {
      return
    }
    desktopCharging = false
    if (renderer.xr.isPresenting) {
      return
    }
    requestDesktopThrow(Math.max(0, (performance.now() - desktopChargeStartMs) * 0.001))
  })

  // Expressway surface height at a point (0 off the structure). Both the
  // walker's ground sampler and the car's grounding share this, so foot and
  // wheel agree with the physics colliders about where the deck is.
  const sampleExpresswayElevation = (azimuth: number, axialPosition: number) => {
    const expressway = getCityExpressway(habitatConfig.radius, getHabitatSpanMeters())
    return expressway === null
      ? 0
      : getExpresswayElevation(expressway, habitatConfig.radius, azimuth, axialPosition)
  }

  const sampleGroundHeight = (azimuth: number, axialPosition: number, altitude: number) => {
    const cityHeight = getCityGroundHeight(
      cityscape.getCollisionIndex(),
      habitatConfig.radius,
      azimuth,
      axialPosition,
      altitude
    )
    // The deck behaves like a roof: it is your floor only when your feet are
    // already at (or just above) it — street level stays real underneath.
    const expresswayHeight = sampleExpresswayElevation(azimuth, axialPosition)
    const deckCounts = expresswayHeight > 0 && altitude >= expresswayHeight - 1.5

    return Math.max(cityHeight, deckCounts ? expresswayHeight : 0)
  }

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
  // Paces the continuous throttle/brake hand-rumble so we don't fire a haptic
  // pulse on every single frame.
  let feedbackHapticAccumulator = 0

  const gameLoop = new GameLoop(renderer, ({ deltaSeconds }) => {
    // Sample the previous frame's accumulated renderer counters, then clear
    // them for the passes this tick will issue.
    perfMeter.frame(deltaSeconds, renderer.info.render)
    renderer.info.reset()

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
      playerTraversal.mode === 'free-fly' && !drive.driving,
      !drive.driving && (mobileControls?.isJumpHeld() ?? false)
    )
    // Snapshot the mode before any detach/landing so we can announce a
    // grounded<->free-fly transition (VR has no DOM mode chip).
    const modeAtFrameStart = playerTraversal.mode
    let justJumped = false
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

    // Right stick-click cycles the throwable (ball → beam → firework).
    if (xrWatchInput.weaponCyclePressed && !drive.driving) {
      cycleSelectedProjectile()
    }

    // Left B = recenter the view — the "menu" verb on the left hand.
    if (xrWatchInput.leftMenuPressed) {
      vrLocomotion.faceForward()
      vibrate(8)
    }

    // Continuous VR feedback so analog inputs are felt and heard, not silently
    // applied: a jetpack tone tracking the throttle, a paced throttle/brake
    // rumble on the left hand, and a tick on each snap turn.
    const vrFeedback = vrLocomotion.feedback

    // Right-stick vertical flick cycles the throwable (up = next). Backward
    // steps around the 3-item ring by cycling twice.
    if (vrFeedback.projectileCycle === 1) {
      cycleSelectedProjectile()
    } else if (vrFeedback.projectileCycle === -1) {
      cycleSelectedProjectile()
      cycleSelectedProjectile()
    }
    if (renderer.xr.isPresenting) {
      const leftRumble = Math.max(vrFeedback.throttle, vrFeedback.brakeAmount)
      feedbackHapticAccumulator += deltaSeconds
      if (leftRumble > 0.04 && feedbackHapticAccumulator >= 0.05) {
        feedbackHapticAccumulator = 0
        xrInputMap.pulse(0.05 + leftRumble * 0.3, 40, 'left')
      }
      if (vrFeedback.snapped) {
        xrInputMap.pulse(0.5, 12, 'right')
        audio.playClick()
      }
    }

    if (throwDebugTimer > 0) {
      throwDebugTimer -= deltaSeconds
      if (throwDebugTimer <= 0) {
        throwDebugArrow.visible = false
      }
    }

    if (desktopThrowQueued !== null) {
      const heldSeconds = desktopThrowQueued
      desktopThrowQueued = null
      throwDesktopBall(heldSeconds)
    }

    grabSystem.update()

    // Update order: input -> grab state -> simulation -> render.
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + omega * deltaSeconds, Math.PI * 2)
    starfield.setFrameAngle(frameAngle)
    mergeLocomotionIntent(desktopIntent, vrIntent, locomotionIntent)
    // The jetpack hiss follows EVERY thrust source, not just the VR trigger:
    // held jump climbing away, WASD/stick translation in the air, Shift
    // descent — if the pack is pushing, it is heard. Sampled before the step
    // consumes (and rescales) the intent vector.
    const jetpackAcousticThrottle =
      playerTraversal.mode === 'free-fly' && !drive.driving
        ? Math.min(
            1,
            Math.max(vrFeedback.throttle, locomotionIntent.freeFlyThrust.length())
          )
        : 0
    audio.setJetpackThrottle(jetpackAcousticThrottle)

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
          units: getUnits(),
          surfaceElevation: sampleExpresswayElevation
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
      justJumped = true
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
        brakeDamping: 6
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
    cityscape.setFocusSurface(
      drive.driving ? drive.surface.azimuth : playerAzimuth,
      drive.driving ? drive.surface.axialPosition : playerFixedColliderPosition.y
    )

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
      // Ride at the car's ACTUAL surface height — pinning these to the wall
      // radius left the camera and mesh at street level while the physics
      // sphere climbed the expressway ramp overhead.
      playerTraversal.groundHeight = drive.lastElevation
      car.setPose(
        drive.surface.azimuth,
        drive.surface.axialPosition,
        drive.heading,
        habitatConfig.radius - drive.lastElevation
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

    // Announce a grounded<->free-fly transition. Flash a brief label (only when
    // no richer card is up, so the first-jump tutorial still wins), and add a
    // generic cue when jump/landing did not already sound the change.
    if (playerTraversal.mode !== modeAtFrameStart) {
      const enteredFreeFly = playerTraversal.mode === 'free-fly'
      if (tourGuide.activeEvent === null) {
        notifyTourEvent(tourGuide, enteredFreeFly ? 'enter-freefly' : 'enter-grounded')
      }
      if (!justJumped && !landed) {
        audio.playModeChange()
        vibrate(14)
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

    // Apply the landing heading on the SAME frame the body settles (the rig is
    // now grounded), so the view never snaps to level forward for a frame before
    // the stand-up ease. Head-tracked XR keeps its own orientation.
    if (landed && !renderer.xr.isPresenting) {
      desktopLookControls.notifyLanded()
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
    explosions.step(deltaSeconds)
    const trackedBall = getTrackedBall(balls)

    forceVectorArrows.update({
      ball: trackedBall,
      omega,
      scale: debugVisuals.forceVectorScale,
      visible: debugVisuals.showForceVectors
    })
    const playerRegion = getPlayerTraversalRegion(
      playerTraversal,
      habitatConfig.radius,
      habitatSpan,
      frameAngle
    )

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
      platform: currentControlPlatform(),
      region: playerRegion,
      observerMode: effectiveObserverMode,
      trailMode: debugVisuals.trailMode,
      ballCount: balls.length,
      feltGravity,
      feltSpeed,
      raining: weather.raining,
      perf: perfMeter.stats(),
      depthMode,
      absoluteVelocity: {
        x: playerTraversal.inertialVelocity.x,
        y: playerTraversal.inertialVelocity.y,
        z: playerTraversal.inertialVelocity.z,
        speed: playerTraversal.inertialVelocity.length()
      }
    })

    hud.update({
      rpm: habitatConfig.rpm,
      presetName: getPresetName(habitatConfig.currentPresetId),
      currentPresetId: habitatConfig.currentPresetId,
      platform: currentControlPlatform(),
      ballCount: balls.length,
      projectile: selectedProjectile,
      projectileLabel: PROJECTILES[selectedProjectile].label,
      feltGravity,
      feltSpeed,
      region: playerRegion,
      playerMode: playerTraversal.mode,
      reattach:
        playerTraversal.mode !== 'free-fly' || reattachStatus === null
          ? null
          : {
              radialError: reattachStatus.radialError,
              ready: reattachStatus.canAttach
            }
    })
    // The whole dock hides in VR; Travel/Spin stay reachable while driving.
    dock.setVisible(!renderer.xr.isPresenting)
    beatBar.update({
      rpm: habitatConfig.rpm,
      feltGravity,
      axisAvailable: canRespawnOnAxisEnd(habitatConfig.type),
      oldTownAvailable:
        getArrivalSquare(habitatConfig.radius, getHabitatSpanMeters()) !== null,
      raining: weather.raining
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

    // Weather first: the shower strength feeds both the streaks and the
    // overcast dimming below. The field is sampled at the active carrier
    // (walker or car) in colony-fixed coordinates; outside the hull there is
    // no air, so the shower gates off entirely.
    const rainLevel = stepWeather(weather, deltaSeconds)
    inertialPositionToRotating(
      drive.driving ? drive.lastInertialPosition : playerTraversal.inertialPosition,
      frameAngle,
      carrierRotatingPosition
    )
    // The air can be thinner than the bore: an open ring holds only a shell
    // against its floor, and both the rain field (cloud deck at the top of the
    // air) and the ambience (vacuum in the bore) read that depth.
    const atmosphereDepth = getAtmosphereDepth(habitatConfig)
    const carrierRadial = Math.hypot(carrierRotatingPosition.x, carrierRotatingPosition.z)
    const carrierInAir =
      playerRegion === 'inside' &&
      carrierRadial >= habitatConfig.radius - atmosphereDepth - 1
    sampleRainField(
      carrierRotatingPosition,
      omega,
      habitatConfig.radius,
      rainSample,
      atmosphereDepth
    )
    const rainStrength =
      playerRegion === 'inside' ? rainLevel * rainSample.strength : 0
    fillCarrierRotatingVelocity(carrierRotatingVelocity)
    rain.update({
      cameraPosition: carrierRotatingPosition,
      rainVelocity: rainSample.velocity,
      cameraVelocity: carrierRotatingVelocity,
      deltaSeconds,
      intensity: rainStrength
    })
    audio.setRainLevel(rainStrength)

    dayNightPhase = stepDayNightPhase(
      dayNightPhase,
      deltaSeconds,
      settingsStore.environment.dayCycleSeconds
    )
    // Overcast: rain dims the whole light rig coherently (sun beams, fill,
    // bloom's night boost) by scaling the one daylight scalar they all read.
    const daylight = getDaylight(dayNightPhase) * (1 - 0.45 * rainLevel)

    // What you hear follows where you are: street murmur near the floor, wind
    // at airspeed through the co-rotating air, and wherever the air ends —
    // outside the hull, or in an open ring's vacuum bore — the world bus
    // mutes, leaving only your own breath and heartbeat.
    audio.setEnvironment(
      computeAmbienceMix({
        radialFraction: carrierRadial / Math.max(1e-6, habitatConfig.radius),
        inAir: carrierInAir,
        airspeed: carrierRotatingVelocity.length(),
        daylight
      })
    )

    light.intensity = 0.22 + daylight * 0.9

    // Izma is mirror-lit: its key light is the radial window-mirror beams owned
    // by the cityscape. A hemisphere fill graded along the spin axis would read
    // as light from the occluded axial sun and fight the mirrors, so flatten it
    // to a near-uniform fill there and let the beams shape the shading. The
    // axial end-lit colonies keep the graded fill — it agrees with their sun.
    if (cityscape.isMirrorLit()) {
      light.color.setHex(0xccdaec)
      light.groundColor.setHex(0xb7c4d6)
    } else {
      light.color.setHex(0xdfeeff)
      light.groundColor.setHex(0x33404e)
    }

    // The beam keeps the Sun's true (Sol) colour at every hour: inside the colony
    // the reflected light crosses at most a few km of air on a straight path (no
    // planetary limb), so Rayleigh reddening is ~50× weaker than an Earth sunset
    // — imperceptible. Dusk reads from the beam sweeping off the floor and dimming
    // (the daylighting geometry in cityscape drives that — mirror swing for Izma,
    // axial intensity for Cooper/Playground/Elysium), not a warm tint.
    cityscape.setSunlight(daylight, sunBeamColor)

    // Colour grade from the active look's keyframed profile (neutral honest grade
    // for Izma, cool legacy for the rest). Light intensities stay on `daylight`
    // above; this drives only the haze/space/sun colour and exposure.
    sampleSkyGrade(dayNightPhase, getSkyLook(habitatConfig.skyLook), skyGrade)
    fog.color.copy(skyGrade.fog)
    // The single owner of fog.density. Haze is the fixed air extinction
    // (AIR_FOG_DENSITY) scaled by how much of a cross-interior sightline
    // actually lies in air — a cylinder is air to the axis (fraction 1), an
    // open ring like Elysium is mostly vacuum bore, so the far rim stays
    // visible instead of socking in (representative-sightline approximation).
    // Rain murk thickens it while the shower is up.
    fog.density =
      AIR_FOG_DENSITY * getAirColumnFraction(habitatConfig) * (1 + 2.5 * rainLevel)
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
    cityscape.update(deltaSeconds)
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
    const activeTourCard = stepTourGuide(tourGuide, deltaSeconds)
    // Boot flash of the CONTROL bindings card, held until the intro card has
    // left the screen — shown together they overlap and both turn unreadable.
    // Keyed off the tour state (game time), not a wall-clock timer: on a slow
    // device the card outlives its nominal duration and a timer would fire
    // straight into the overlap this exists to avoid.
    if (!controlsBootFlashDone && activeTourCard === null) {
      controlsBootFlashDone = true
      hud.peekControls()
    }
    tourCardPanel.update(resolveTourCard(activeTourCard, currentControlPlatform()), {
      camera: desktopUiCamera,
      deltaSeconds,
      xrActive: renderer.xr.isPresenting,
      bottomClearancePx: mobileControls?.getReservedBottomHeight() ?? 0
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
  // A shared link spawns where it points; otherwise the first-boot "look up"
  // reveal shows the far side of the colony overhead before the player
  // settles. Desktop/mobile only; XR is head-tracked.
  if (shareState.pose !== null) {
    applySharedPose(shareState.pose, shareState.orientation)
  } else if (!renderer.xr.isPresenting) {
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
    rain.dispose()
    cityscape.dispose()
    spaceport.dispose()
    sun.dispose()
    atmosphereGlow.dispose()
    tourCardPanel.dispose()
    mobileControls?.dispose()
    fullscreenToggle?.dispose()
    hud.destroy()
    beatBar.destroy()
    shareBar.destroy()
    dock.destroy()
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
