import { NeighborhoodJourney, OUTING_DESTINATIONS, planNeighborhoodRoute, pavementExit, canParkAt, wrapAngle, type GuideAction, type OutingDestination } from './neighborhoodRoute'
import { createOutingPanel } from '../ui/outingPanel'
import { NeighborhoodLife } from '../objects/neighborhoodLife'
import { PlayerBodyView } from '../objects/playerBodyView'
import { sampleTrackedBodyPose } from '../xr/trackedBodyPose'
import { StreetWalkers } from '../objects/streetWalkers'
import { CoffeeService } from './coffeeService'
import { CoffeeServiceView } from '../objects/coffeeServiceView'
import { createCoffeeAction } from '../ui/coffeeAction'
import { RoomSeating, nearestRoomSeat } from './roomSeating'
import { createRoomAction } from '../ui/roomAction'
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
import { isAudioActive } from './audioActivity'
import { ThrowTarget } from '../objects/throwTarget'
import { clearBalls, getTrackedBall, removeExpiredBalls } from './ballCollection'
import { resolveFogVisibility, visibilityToFogDensity } from './airVisibility'
import {
  createHazeProfile,
  installLayeredFog,
  resolveHazeScaleHeight,
  setHazeProfile
} from '../objects/layeredHaze'
import {
  METRICS_ENDPOINT,
  createRecorder,
  createShipper,
  randomId,
  readAudience,
  readVisitor,
  referrerHost
} from './metrics'
import { loadDepthMode, toggleDepthModeAndReload } from './depthMode'
import { DesktopLookControls, composeCameraParentTwist } from './desktopLookControls'
import { isGameplayKeyboardEvent, onInputInterrupted } from './inputFocus'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import { createPerfMeter } from './perfMeter'
import { createResolutionGovernor, DESKTOP_GOVERNOR, resolvePixelRatio } from './resolutionGovernor'
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
  stepTourGuide,
  type TourEventId
} from './tourGuide'
import { getSurfacePosition, type SurfaceRigState } from './surfaceRig'
import { Ball } from '../objects/ball'
import { Explosions } from '../objects/explosion'
import { PROJECTILES, cycleProjectile, type ProjectileType } from '../gameplay/projectileTypes'
import { Car } from '../objects/car'
import { centralPlazaArrival } from '../objects/civicArrival'
import { CarShareStation, planCarShareBay } from '../objects/carShare'
import {
  getArrivalSquare,
  getCityExpressway,
  getCityGroundHeight,
  getExpresswayElevation,
  getSidewalkWidth,
  isInsidePlaza,
  isInsideArrivalSquare,
  getLandArcs,
  getWindowArcs,
} from '../objects/cityLayout'
import { Cityscape } from '../objects/cityscape'
import { IntersectionFurniture } from '../objects/intersectionFurniture'
import { ParkedCars } from '../objects/parkedCars'
import { Sidewalks, planSidewalkSegments } from '../objects/sidewalks'
import { StreetLamps } from '../objects/streetLamps'
import { CylinderHabitat } from '../objects/cylinder'
import { createCityShellTextureSet, resolveShellRoadGlowScale } from '../objects/cityShellBake'
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
import { BALL_THROW_SPEEDS, type BallThrowStyle } from '../gameplay/throwTarget'
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
import { PLACE_DESTINATIONS, resolvePlaceVisit, type PlaceVisitAction } from './placeVisits'
import { createDockBar } from '../ui/dockBar'
import { createShareBar } from '../ui/shareBar'
import { createStatsOverlay, isStatsOverlayRequested } from '../ui/statsOverlay'
import { createHud } from '../ui/hud'
import { createTourNotice } from '../ui/tourNotice'
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

// Aviation beacons never drop below this on-screen radius (CSS px on flat
// screens, framebuffer px in XR). `?beacon=<px>` overrides for on-device A/B;
// 0 draws the physical 0.45 m fixture only, which is sub-pixel past ~300 m.
const BEACON_MIN_SCREEN_RADIUS_PX = 1.0
const beaconViewportScratch = new THREE.Vector2()

export const resolveBeaconMinScreenRadius = (urlValue: string | null): number => {
  const parsed = urlValue === null ? Number.NaN : Number(urlValue)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 8 ? parsed : BEACON_MIN_SCREEN_RADIUS_PX
}

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
  const initialSurfaceState: SurfaceRigState = centralPlazaArrival(habitatConfig.radius)
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
  // crisp. The knob is a meteorological VISIBILITY per tier (docs/
  // far-field-lod.md slice ①): desktop keeps the historical clear look, the
  // mobile tiers run denser air, `?fog=<metres>` overrides for on-device
  // tuning and the `?debug` panel has a live slider. The confined-air case (a
  // ring's vacuum bore) is handled below by scaling with getAirColumnFraction.
  const quality = getQualityProfile()
  const beaconMinScreenRadiusPx = resolveBeaconMinScreenRadius(
    new URLSearchParams(window.location.search).get('beacon')
  )
  // Backing-store ratio: device DPR under the tier cap, or `?dpr=<n>` pinned.
  const pixelRatio = resolvePixelRatio(
    new URLSearchParams(window.location.search).get('dpr'),
    window.devicePixelRatio,
    quality.pixelRatioCap
  )
  const bootParams = new URLSearchParams(window.location.search)
  const airFog = {
    visibilityMeters: resolveFogVisibility(
      bootParams.get('fog'),
      quality.fogVisibilityMeters
    ),
    // Boundary-layer scale height in metres; 0 = the old uniform fog.
    // `?bl=<metres>` for on-device A/B (`?bl=0` → uniform).
    scaleHeightMeters: resolveHazeScaleHeight(bootParams.get('bl')) ?? 0
  }
  // Layered Beer–Lambert haze replaces three's Gaussian FogExp2 chunk for
  // every fogged material (objects/layeredHaze.ts). Installed before the
  // first render so the programs compile against the swapped chunks.
  const hazeProfile = createHazeProfile()
  installLayeredFog(hazeProfile)
  // Flat-Earth ghost line on thrown balls (gameplay/earthGhost.ts); `?ghost=0` off.
  const earthGhostEnabled = bootParams.get('ghost') !== '0'
  const fog = new THREE.FogExp2(
    0x5f7587,
    visibilityToFogDensity(airFog.visibilityMeters)
  )
  scene.fog = fog
  // The day/night colour grade (fog/background/sun/exposure) is a per-look
  // keyframed profile; Izma keeps a physically honest neutral grade (no warm
  // sunset — a cylinder has no limb), other presets keep the cool legacy grade.
  // Boot at the look's chosen time of day.
  const skyGrade = createSkyGrade()
  let dayNightPhase =
    shareState.dayNightPhase ?? getInitialDayNightPhase(habitatConfig.skyLook)
  const audio = new GameAudio()
  let audioSession: XRSession | null = null
  const syncAudioActivity = () => audio.setActive(isAudioActive(document.hidden, audioSession?.visibilityState ?? null))
  const hideAudio = () => audio.setActive(false)
  syncAudioActivity()
  document.addEventListener('visibilitychange', syncAudioActivity)
  window.addEventListener('pagehide', hideAudio)
  window.addEventListener('pageshow', syncAudioActivity)
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
  const throwTarget = new ThrowTarget(nearLayer, () => {
    audio.playModeChange()
    vibrate(20)
  })
  throwTarget.configure(habitatConfig.radius)

  const habitat = new CylinderHabitat({
    radius: habitatConfig.radius,
    length: getHabitatSpan(habitatConfig),
    topology: habitatConfig.topology,
    type: habitatConfig.type
  })
  const cityscape = new Cityscape(
    {
      radius: habitatConfig.radius,
      length: getHabitatSpan(habitatConfig),
      topology: habitatConfig.topology,
      type: habitatConfig.type
    },
    {
      maxBuildings: quality.maxBuildings,
      maxTraffic: quality.maxTraffic,
      focusStepMeters: quality.cityFocusStepMeters,
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
  rain.setBounds(habitatConfig.radius, habitatConfig.length)
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
  // Usage funnel (docs/metrics.md): the tour's own milestones, shipped to
  // /metric → Analytics Engine. Pure recorder + beacon shipper; `?metrics=off`
  // turns it off for this browser, `?metrics=dev` tags the maintainer's loads.
  const metricsStore = (() => {
    try {
      return window.localStorage
    } catch {
      return null
    }
  })()
  const metricsAudience = readAudience(metricsStore, window.location.search)
  const metrics =
    metricsAudience === 'off'
      ? null
      : (() => {
          const visitor = readVisitor(metricsStore, Date.now())
          const shipper = createShipper({
            endpoint: METRICS_ENDPOINT,
            vid: visitor.id,
            sid: randomId().slice(0, 12),
            aud: metricsAudience,
            build: typeof __SPINWARD_BUILD__ === 'string' ? __SPINWARD_BUILD__ : 'dev',
            send: (url, body) => {
              try {
                return navigator.sendBeacon(url, body)
              } catch {
                return false
              }
            },
            schedule: (flush, delayMs) => {
              window.setTimeout(flush, delayMs)
            }
          })
          const recorder = createRecorder({
            now: () => performance.now(),
            emit: (event) => shipper.emit(event),
            context: {
              preset: habitatConfig.currentPresetId,
              entry: shareState.pose !== null ? 'shared' : 'landing',
              device: isTouchDevice() ? 'touch' : 'desktop',
              lang: (navigator.language ?? '').slice(0, 16),
              tier: quality.tier
            }
          })
          recorder.session(visitor, referrerHost(document.referrer, window.location.hostname))
          document.addEventListener('visibilitychange', () => recorder.visibility(document.hidden))
          // pagehide (not unload): fires on tab close, navigation and bfcache
          // entry alike, and sendBeacon survives it.
          window.addEventListener('pagehide', () => recorder.leave('pagehide', perfMeter.stats().fps))
          return recorder
        })()
  // Every tour card goes through here so the funnel and the card agree on
  // what a milestone is.
  const reportTour = (event: TourEventId) => {
    notifyTourEvent(tourGuide, event)
    metrics?.milestone(event)
  }
  const tourCardPanel = new TourCardPanel()
  const tourNotice = createTourNotice()
  const tourOverlayScene = new THREE.Scene()
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
  camera.position.set(0, isTouchDevice() ? 1.6 : 1.8, 0)
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
  renderer.setPixelRatio(pixelRatio.ratio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  // The perf meter reads renderer.info once per game-loop tick; manual reset
  // lets the counters accumulate across bloom's sub-passes instead of being
  // wiped by every internal render() call.
  renderer.info.autoReset = false
  const perfMeter = createPerfMeter()
  // Desktop only: phones already cap the ratio at 1.75 and Quest renders into
  // the XR framebuffer, where setPixelRatio has no say. Started once the
  // splash is gone (below); steps down only, never up. `?dpr=` switches it off.
  const resolutionGovernor =
    quality.tier === 'desktop' && !pixelRatio.pinned
      ? createResolutionGovernor({ initialRatio: pixelRatio.ratio, ...DESKTOP_GOVERNOR })
      : null

  // The wrist watch shows these numbers in VR; `?stats` gives flat screens
  // (phones especially) the same readout for the on-device perf hunt.
  const statsOverlay = isStatsOverlayRequested(window.location.search)
    ? createStatsOverlay(document.body)
    : null

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
    bloomComposer.setPixelRatio(pixelRatio.ratio)
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
  // Opt-in mouse look on PC (click the view to grab the pointer, Esc to
  // release); never on touch, `?lock=0` turns it off.
  desktopLookControls.setPointerLockEnabled(!isTouchDevice() && bootParams.get('lock') !== '0')
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
          isUiPointerBlocked: () => false,
          onUserInput: () => { desktopLookControls.cancelIntroReveal() }
        },
        dock.root,
        dock.left
      )
    : null

  // Offer immersive entry only when supported. Quest keeps its first-entry
  // CTA above the flat UI; all other display controls live in Menu.
  const mountVrButton = () => {
    const button = VRButton.createButton(renderer)
    dock.system.appendChild(button)
    // Quest keeps its first-entry CTA outside the closed menu.
    if (onQuest) {
      document.body.appendChild(button)
      renderer.xr.addEventListener('sessionstart', () => dock.system.appendChild(button))
    }
  }
  let fullscreenToggle: ReturnType<typeof createFullscreenToggle> = null

  if (!onQuest) {
    fullscreenToggle = createFullscreenToggle()

    if (fullscreenToggle !== null) {
      dock.system.appendChild(fullscreenToggle.button)
    }
  }

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
  renderer.xr.addEventListener('sessionstart', () => {
    audioSession = renderer.xr.getSession()
    audioSession?.addEventListener('visibilitychange', syncAudioActivity)
    syncAudioActivity()
    audio.unlock()
  })
  renderer.xr.addEventListener('sessionend', () => {
    audioSession?.removeEventListener('visibilitychange', syncAudioActivity)
    audioSession = null
    syncAudioActivity()
  })
  renderer.xr.addEventListener('sessionstart', () => metrics?.vrStart())
  renderer.xr.addEventListener('sessionend', () => metrics?.vrEnd('exit', perfMeter.stats().fps))

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
    reportTour('start')
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
  const journey = new NeighborhoodJourney()
  const outingDestinations = new Map<GuideAction, OutingDestination>()
  const destinationStations: CarShareStation[] = []
  let outingPlan: ReturnType<typeof cityscape.getCityPlan> | undefined
  let outingDetail = ''
  let outingAngle = 0
  let outingCanPark = false
  let routeRetry = 0
  let driveExitHint = ''
  let routeOrigin = {azimuth:0,axial:0}
  const carShareStation = new CarShareStation()
  nearLayer.add(carShareStation.group)
  let carLayoutKey = ''
  let xrDriverHeightOffset = 0
  // Crosswalks, signal poles and name-plate posts at the road crossings near
  // the player (objects/intersectionFurniture.ts): near-field only, relaid
  // as the player moves. `?furniture=0` hides it for A/B.
  const intersectionFurniture = new IntersectionFurniture()
  intersectionFurniture.group.visible = bootParams.get('furniture') !== '0'
  nearLayer.add(intersectionFurniture.group)
  // Kerb-side parked cars in front of the parcels near the player
  // (objects/parkedCars.ts). `?parking=0` hides them for A/B.
  const parkedCars = new ParkedCars()
  parkedCars.group.visible = bootParams.get('parking') !== '0'
  nearLayer.add(parkedCars.group)
  // Paved sidewalks with a kerb along every grid road (objects/sidewalks.ts).
  // `?sidewalks=0` hides them for A/B.
  const sidewalks = new Sidewalks()
  sidewalks.group.visible = bootParams.get('sidewalks') !== '0'
  nearLayer.add(sidewalks.group)
  // Near-field street lamps on every grid road (objects/streetLamps.ts):
  // posts, arms, heads and night light pools around the player. The far city
  // uses the supported fixtures and baked city hierarchy. `?lamps=0` hides
  // the near set; local illumination uses two desktop slots and one elsewhere.
  const streetLamps = new StreetLamps(quality.tier === 'desktop' ? 2 : 1)
  streetLamps.group.visible = bootParams.get('lamps') !== '0'
  nearLayer.add(streetLamps.group)
  const drive = new DriveRuntime()
  const roomSeating = new RoomSeating()
  const seatFrame = () => ({ radius: habitatConfig.radius, frameAngle, omega: rpmToOmega(habitatConfig.rpm) })
  const toggleRoomSeat = () => {
    if (drive.driving || renderer.xr.isPresenting) return false
    audio.unlock()
    roomSeating.update(playerTraversal, seatFrame(), cityscape.getSeats())
    if (roomSeating.leave(playerTraversal, seatFrame())) { audio.playClick(); return true }
    const seat = nearestRoomSeat(cityscape.getSeats().filter(s => !neighborhoodLife.isSeatOccupied(s.id)), playerTraversal, habitatConfig.radius)
    if (!seat || !roomSeating.enter(seat, playerTraversal, seatFrame())) return false
    // Face the bench's clear aisle rather than retaining an approach heading
    // that can put the backrest in front of the seated player.
    const tangent = Math.atan2(Math.sin(seat.exit.azimuth-seat.azimuth), Math.cos(seat.exit.azimuth-seat.azimuth))*seat.radius
    const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.atan2(-(seat.exit.axialPosition-seat.axialPosition),-tangent),0))
    const localFacing = composeCameraParentTwist(camera,playerRig,new THREE.Quaternion()).invert().multiply(facing)
    const look = new THREE.Euler().setFromQuaternion(localFacing,'YXZ')
    desktopLookControls.setLook(look.y,look.x)
    audio.playClick(); return true
  }
  const roomAction = createRoomAction(() => { if (!toggleRoomSeat()) tryToggleDrive() }, () => Math.max(
    window.innerHeight - dock.root.getBoundingClientRect().top,
    mobileControls?.getReservedBottomHeight() ?? 0
  ))
  const coffeeService = new CoffeeService()
  const coffeeView = new CoffeeServiceView(cityscape.group, camera)
  const neighborhoodLife = new NeighborhoodLife(cityscape.group, cityscape)
  const playerBodyView = new PlayerBodyView(cityscape.group)
  const streetWalkers = new StreetWalkers(cityscape.group, quality.tier === 'desktop' ? 8 : 4)
  const bodyDirection = new THREE.Vector3()
  const bodyFrameInverse = new THREE.Matrix4()
  const airborneBodyView = new THREE.Matrix4()
  let bodyHeading = 0
  const coffeeContext = () => ({ station: cityscape.getCoffeeStation(), player: playerTraversal,
    radius: habitatConfig.radius, blocked: drive.driving || renderer.xr.isPresenting })
  const activateCoffee = () => {
    if (!coffeeService.activate(coffeeContext())) return
    audio.unlock(); audio.playClick()
  }
  const coffeeAction = createCoffeeAction(activateCoffee, () => Math.max(
    roomAction.getReservedBottomHeight(),
    window.innerHeight - dock.root.getBoundingClientRect().top,
    mobileControls?.getReservedBottomHeight() ?? 0
  ))
  drive.rebuild({ rapier, world: physicsWorld, units: getUnits() })
  const driveKeys = { forward: false, back: false, left: false, right: false, brake: false }

  const parkCarNearPlaza = () => {
    const bay = cityscape.getCarShareBay()
    const key = JSON.stringify([habitatConfig.radius, getHabitatSpanMeters(), bay])
    const plan=cityscape.getCityPlan()
    if (plan !== outingPlan) {
      outingPlan=plan;journey.cancel();outingDestinations.clear()
      for(const station of destinationStations)station.dispose()
      destinationStations.length=0
      if(plan && bay) {
        const square=centralPlazaArrival(habitatConfig.radius)
        outingDestinations.set('guide-square',{label:'Central Square',entrance:{azimuth:square.azimuth,axial:square.axialPosition},bay})
        const bays=[bay]
        for(const kind of ['cafe','park'] as const) {
          const entrance=cityscape.getInteriorVisit(kind)
          if(!entrance)continue
          const parking=planCarShareBay(plan,habitatConfig.radius,{azimuth:entrance.azimuth,axialPosition:entrance.axial},bays)
          outingDestinations.set(`guide-${kind}`,{label:kind==='cafe'?'Café':'Park',entrance,bay:parking})
          if(parking){const station=new CarShareStation();station.configure(parking,habitatConfig.radius,kind==='cafe'?'Café · 02':'Park · 03');nearLayer.add(station.group);destinationStations.push(station);bays.push(parking)}
        }
        parkedCars.reserve(bays)
      } else parkedCars.reserve(bay)
    }
    if (key === carLayoutKey) return
    carLayoutKey = key
    carShareStation.configure(bay, habitatConfig.radius)
    drive.parkAt(bay?.azimuth ?? Math.min(4.5, habitatConfig.radius * .2) / habitatConfig.radius,
      bay?.axial ?? 0, bay?.heading ?? 0, bay ? .2 : 0)
    car.setPose(drive.surface.azimuth, drive.surface.axialPosition, drive.heading, habitatConfig.radius - drive.parkedElevation)
  }

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
  let desktopThrowQueued = false
  let ballThrowStyle: BallThrowStyle = 'normal'
  let desktopJumpQueued = false
  // The throwable currently selected; cycle with X (PC) / right stick-click (VR).
  let selectedProjectile: ProjectileType = 'ball'
  let frameAngle = 0
  let settingsDirty = false
  let watchUiHot = false
  let watchUiFocusRemaining = 0
  let rightLaserOverCar = false
  let throwDebugTimer = 0
  const THROW_DEBUG_DURATION = 1.5
  let desktopUiCamera: THREE.PerspectiveCamera = camera
  const skyObserverPosition = new THREE.Vector3()
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
        (handedness === 'right' && watchPanel.group.visible &&
          laserPointer.hitTest(controller, watchPanel.interactiveObject) !== null)
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
    throwTarget.reset()
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
    if (didRespawn && !renderer.xr.isPresenting) {
      // A travel destination should reveal the streets below, even when the
      // previous view was the sky. Natural jumps still retain their gaze.
      const ahead = Math.max(8, Math.min(220, habitatConfig.radius * .08, getHabitatSpanMeters() * .2))
      const direction = new THREE.Vector3(habitatConfig.radius, ahead, 0).sub(playerRig.position)
      mobileControls?.resetLook()
      desktopLookControls.faceDirection(direction, new THREE.Vector3(-1, 0, 0))
    }
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
        aspect: renderer.xr.isPresenting ? 1 : camera.aspect,
        verticalFovDegrees: camera.fov,
        mirrorReach: getWindowArcs(habitatConfig.topology).length ? getHabitatSpanMeters() * 1.02 : 0,
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
      mobileControls?.resetLook()
      desktopLookControls.faceDirection(exteriorFacing)
      desktopLookControls.setInertialLook(true)
    }
    return didRespawn
  }

  const rebuildPlayerTraversal = (respawnMode: 'inner-wall' | 'axis-end' = 'inner-wall') => {
    coffeeService.reset()
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

  const exitDrive = (atBay = false) => {
    const streetExit=drive.mode==='street'||atBay
    const omega = rpmToOmega(habitatConfig.rpm)
    const plan=cityscape.getCityPlan()
    const pavement=plan && streetExit && drive.lastElevation<.8
      ? pavementExit(plan,habitatConfig.radius,{azimuth:drive.surface.azimuth,axial:drive.surface.axialPosition},drive.heading) : null
    if(streetExit && (drive.lastSpeed>.8 || !drive.lastGrounded))return
    if(streetExit && drive.lastElevation<.8 && !pavement){driveExitHint='Pull over beside the pavement';return}
    driveExitHint=''
    // Step off carrying the car's momentum: leave on foot in free-fly with the
    // car's rotating-frame velocity. A near-stopped car re-attaches next frame
    // (the ground-contact gate sees a low relative speed); a moving one flings
    // you forward, like stepping off a moving vehicle.
    carExitVelocity.copy(drive.lastRotatingVelocity)
    drive.exit()
    if (tourGuide.activeEvent === 'drive') { tourGuide.activeEvent = null; tourGuide.remainingSeconds = 0 }
    const baySide = carShareStation.bay && Math.hypot((drive.surface.azimuth-carShareStation.bay.azimuth)*habitatConfig.radius, drive.surface.axialPosition-carShareStation.bay.axial) < 4 ? carShareStation.bay.signSide : 1
    const exitAzimuth = pavement?.azimuth ?? drive.surface.azimuth - Math.cos(drive.heading) * baySide * 2.6 / habitatConfig.radius
    const exitAxial = pavement?.axial ?? drive.surface.axialPosition + Math.sin(drive.heading) * baySide * 2.6
    carExitPosition
      .set(Math.cos(exitAzimuth), 0, Math.sin(exitAzimuth))
      .multiplyScalar(
        habitatConfig.radius - drive.parkedElevation - PLAYER_DISMOUNT_HEIGHT
      )
      .setY(exitAxial)
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
    if (roomSeating.seat) roomSeating.leave(playerTraversal, seatFrame())
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

    if (!car.group.visible) return
    if (renderer.xr.isPresenting) {
      const head = renderer.xr.getCamera().getWorldPosition(new THREE.Vector3())
      viewRig.worldToLocal(head)
      xrDriverHeightOffset = Car.DRIVER_EYE.y - head.y
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
    reportTour('drive')
    audio.playClick()
  }

  const prepareTravel = () => {
    journey.cancel()
    // Travel leaves the old attachment before placing the new body. Otherwise
    // the next driving/seating update can pull the player back to the old spot.
    if (drive.driving) drive.exit()
    roomSeating.leave(playerTraversal, seatFrame())
    roomSeating.stepDeparture(1)
    coffeeService.reset()
    desktopLookControls.cancelHeldInput()
    desktopLookControls.cancelIntroReveal()
    desktopLookControls.setInertialLook(false)
    mobileControls?.cancelHeldInput()
    mobileControls?.resetLook()
    cancelDesktopIntent()
  }

  function refreshJourney() {
    if(!journey.action)return
    const plan=cityscape.getCityPlan(), radius=habitatConfig.radius
    const position=drive.driving?drive.surface:playerTraversal.surface
    routeOrigin={azimuth:position.azimuth,axial:position.axialPosition}
    const carPoint={azimuth:drive.surface.azimuth,axial:drive.surface.axialPosition}
    const destination=journey.action==='guide-car'
      ? {label:'Your car',entrance:carPoint,bay:null} : outingDestinations.get(journey.action)
    if(!plan||!destination){journey.setRoute(null,drive.driving,'Directions unavailable');return}
    const goal=drive.driving ? destination.bay : destination.entrance
    journey.setRoute(goal ? planNeighborhoodRoute(plan,radius,{azimuth:position.azimuth,axial:position.axialPosition},goal,drive.driving,cityscape.getPublicPark()) : null,
      drive.driving, destination.label)
    routeRetry=0
  }

  function handleWatchAction(action: WatchActionId) {
    if(action==='guide-car' && drive.driving)return false
    if(OUTING_DESTINATIONS.some(d=>d.id===action)) {
      desktopLookControls.cancelIntroReveal()
      if(tourGuide.activeEvent==='start'){tourGuide.activeEvent=null;tourGuide.remainingSeconds=0}
      journey.action=action as GuideAction;refreshJourney();audio.playClick();return true
    }
    if(action==='guide-cancel'){journey.cancel();return true}
    if(action==='drive-mode-toggle'){drive.mode=drive.mode==='street'?'experiment':'street';audio.playClick();return true}
    if(action==='park-car') {
      const bay=journey.action ? outingDestinations.get(journey.action)?.bay : null
      if(!bay || !drive.driving || !drive.lastGrounded || !canParkAt({azimuth:drive.surface.azimuth,axial:drive.surface.axialPosition},drive.heading,drive.lastSpeed,drive.lastElevation,bay,habitatConfig.radius))return false
      const plan=cityscape.getCityPlan()
      if(!plan || !pavementExit(plan,habitatConfig.radius,bay,drive.heading))return false
      // A deliberate parking action assists only the final two metres.
      drive.parkAt(bay.azimuth,bay.axial,drive.heading,.2)
      drive.lastRotatingVelocity.set(0,0,0);drive.lastSpeed=0
      exitDrive(true);refreshJourney();return true
    }
    if (applyWatchAction(settingsStore, action)) {
      audio.playClick()
      if (action.startsWith('rpm-')) {
        reportTour('spin-change')
      }
      return true
    }

    const runtimeAction = resolveRuntimeWatchAction(action)

    switch (runtimeAction?.kind) {
      case 'preset':
        prepareTravel()
        audio.playClick()
        frameAngle = 0
        lastAppliedPresetId = runtimeAction.presetId
        applyPresetToSettingsStore(settingsStore, runtimeAction.presetId)
        clearAllBalls()
        rebuildPlayerTraversal('inner-wall')
        drive.rebuild({ rapier, world: physicsWorld, units: getUnits() })
        carLayoutKey = ''
        syncHabitat()
        settingsDirty = false
        return true
      case 'rain-toggle':
        audio.playClick()
        setRaining(!weather.raining)
        return true
      case 'audio-toggle':
        audio.unlock()
        audio.toggleMuted()
        return true
      case 'depth-toggle':
        audio.playClick()
        toggleDepthModeAndReload(depthMode)
        return true
      case 'respawn':
        prepareTravel()
        audio.playClick()
        if (runtimeAction.mode === 'inner-wall') {
          reportTour('surface')
          return respawnPlayerInnerWall()
        }
        if (runtimeAction.mode === 'old-town') {
          const moved = respawnPlayerOldTown()
          if (moved) reportTour('old-town')
          return moved
        }
        if (runtimeAction.mode === 'overlook') {
          reportTour('overlook')
          return respawnPlayerOverlook()
        }
        if (runtimeAction.mode === 'exterior') {
          const moved = respawnPlayerExterior()
          if (moved) reportTour('exterior')
          return moved
        }
        reportTour('axis')
        return respawnPlayerAxisEnd()
      case 'visit': {
        const visit = resolvePlaceVisit(runtimeAction.action, kind => cityscape.getInteriorVisit(kind))
        if (!visit) return false
        prepareTravel()
        applySharedPose({ mode: 'grounded', azimuth: visit.azimuth, axialPosition: visit.axial, groundHeight: visit.groundHeight ?? 0 }, visit.orientation)
        reportTour(runtimeAction.action)
        audio.playClick()
        return true
      }
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
    parkCarNearPlaza()
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
    rain.setBounds(habitatConfig.radius, habitatConfig.length)
    // Far-field city shell bake (docs/far-field-lod.md slice ②): rebaked from
    // the fresh CityPlan on every habitat change. Small drums and the open
    // ring skip it (createCityShellTextureSet also gates on radius) — the
    // placeholders make the shell layer a no-op then.
    const cityPlan = cityscape.getCityPlan()
    intersectionFurniture.setPlan(
      cityPlan !== null && habitatConfig.type !== 'ring' ? cityPlan.intersections : [],
      habitatConfig.radius
    )
    parkedCars.setPlan(
      cityPlan !== null && habitatConfig.type !== 'ring' ? cityPlan.buildings : [],
      cityPlan?.roads ?? [],
      habitatConfig.radius,
      getSidewalkWidth(habitatConfig.radius, getHabitatSpanMeters())
    )
    {
      const span = getHabitatSpanMeters()
      const arrival = getArrivalSquare(habitatConfig.radius, span)
      const isOpenSquare = (azimuth: number, axial: number) =>
        isInsidePlaza(azimuth, axial, habitatConfig.radius) ||
        (arrival !== null && isInsideArrivalSquare(azimuth, axial, habitatConfig.radius, arrival.axial))
      streetLamps.setPlan(
        cityPlan !== null && habitatConfig.type !== 'ring' ? cityPlan.roads : [],
        cityPlan?.intersections ?? [],
        habitatConfig.radius,
        span,
        cityscape.getParkLamps()
      )
      const sidewalkSegments = cityPlan !== null && habitatConfig.type !== 'ring'
          ? planSidewalkSegments(
              cityPlan.roads,
              cityPlan.intersections,
              habitatConfig.radius,
              getSidewalkWidth(habitatConfig.radius, span),
              isOpenSquare,
              cityscape.getRiverDistrict()?.sidewalkCuts ?? []
            )
          : []
      sidewalks.setPlan(sidewalkSegments, habitatConfig.radius)
      playerBodyView.surfaces.setPlan(cityPlan, sidewalkSegments, habitatConfig.radius, cityscape.getPublicPark())
      playerBodyView.motion.reset()
      streetWalkers.setPlan(sidewalkSegments, habitatConfig.radius)
    }
    habitat.setCityShellTextures(
      cityPlan !== null && habitatConfig.type !== 'ring'
        ? createCityShellTextureSet(
            cityPlan,
            habitatConfig.radius,
            getHabitatSpanMeters(),
            quality.cityShellBakeWidth,
            // `?grid=<0..2>` scales the baked road-grid glow for on-device A/B.
            resolveShellRoadGlowScale(bootParams.get('grid')),
            getLandArcs(habitatConfig.topology)
          )
        : null
    )
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
    (projectile) => selectProjectile(projectile),
    (style) => { ballThrowStyle = style },
    { status: dock.status, equipment: dock.equipment }
  )
  const setRaining = (raining: boolean) => {
    weather.raining = raining
    if (raining) {
      reportTour('rain')
    }
  }
  const outingPanel=createOutingPanel(action=>handleWatchAction(action))
  dock.driving.append(outingPanel.modeChip)
  const beatBar = createBeatBar((action) => handleWatchAction(action), dock.right, () =>
    setRaining(!weather.raining), dock.primary
  )
  let placesPlan: ReturnType<typeof cityscape.getCityPlan> | undefined
  const availablePlaces = new Set<PlaceVisitAction>()

  // Fold the current view into a URL: opening it boots at this exact spot,
  // look, hour, spin and weather. The photo burns the wordmark + site in, so
  // a posted image and "see it yourself" travel together.
  const shareQuaternionScratch = new THREE.Quaternion()
  const shareFreeFlyScratch = new THREE.Vector3()
  const buildShareUrl = () => {
    camera.updateWorldMatrix(true, false)
    camera.getWorldQuaternion(shareQuaternionScratch)
    const grounded = drive.driving || playerTraversal.mode === 'grounded'
    const surface = drive.driving ? drive.surface : roomSeating.seat?.exit ?? playerTraversal.surface
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
    if (renderer.xr.isPresenting && pose.mode === 'grounded') {
      // Aim the arrival through the yaw rig, preserving the real head pose.
      vrLocomotion.faceGroundedDirection(new THREE.Vector3(0, 0, -1).applyQuaternion(shareQuaternionScratch))
      return
    }
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

  // Named so the keyboard (L / P — usable while the pointer is locked and the
  // dock cannot be clicked) can trigger the same actions as the buttons.
  const shareLinkAction = async () => {
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
  }
  const photoAction = () =>
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
  const shareBar = createShareBar(dock.system, {
    onShareLink: shareLinkAction,
    onPhoto: photoAction
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
        airFog,
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
    // debugging session teleport the car to a spot (e.g. a ramp mouth) and
    // enter it without a minutes-long manual drive at software-GL framerates.
    ;(window as unknown as Record<string, unknown>).__spinwardScene = scene
    ;(window as unknown as Record<string, unknown>).__spinwardCity = cityscape
    ;(window as unknown as Record<string, unknown>).__spinwardBody = playerBodyView
    ;(window as unknown as Record<string, unknown>).__spinwardCar = car
    ;(window as unknown as Record<string, unknown>).__spinwardTarget = throwTarget
    ;(window as unknown as Record<string, unknown>).__spinwardWatch = watchPanel
    ;(window as unknown as Record<string, unknown>).__spinwardWalkers = streetWalkers
    ;(window as unknown as Record<string, unknown>).__spinwardStreetLamps = streetLamps
    ;(window as unknown as Record<string, unknown>).__spinwardTraffic = () => cityscape.getTrafficPositions()
    ;(window as unknown as Record<string, unknown>).__spinwardIntersections = intersectionFurniture
    ;(window as unknown as Record<string, unknown>).__spinwardOuting = {journey,destinations:outingDestinations,action:handleWatchAction,
      face:(heading:number)=>{
        const a=playerTraversal.surface.azimuth
        const direction=new THREE.Vector3(-Math.sin(a)*Math.sin(heading),Math.cos(heading),Math.cos(a)*Math.sin(heading))
        cityscape.group.updateWorldMatrix(true,false)
        direction.transformDirection(cityscape.group.matrixWorld)
        const up=new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)).transformDirection(cityscape.group.matrixWorld)
        desktopLookControls.cancelIntroReveal();desktopLookControls.faceDirection(direction,up)
      },
      route:(start:{azimuth:number;axial:number},goal:{azimuth:number;axial:number},driving:boolean)=>planNeighborhoodRoute(cityscape.getCityPlan()!,habitatConfig.radius,start,goal,driving,cityscape.getPublicPark())}
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
        vrLocomotion?.faceForward()
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
      releasedByController
    }: {
      origin: THREE.Object3D
      // Visible-hand (grip) space used for the SPAWN POSITION while `origin`
      // (target-ray) stays the AIM. Optional: desktop falls back to `origin`.
      positionSource?: THREE.Object3D
      releasedByController?: THREE.XRTargetRaySpace
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
      // The flat-Earth ghost teaches the curve; only the thrown ball gets one
      // (bolts are instant, fireworks burst). `?ghost=0` hides it for A/B.
      earthGhost:
        earthGhostEnabled && spec.launchSpeed === 0 && !spec.explodeOnImpact && insideHabitat
          ? { floorRadius: habitatConfig.radius }
          : undefined,
      lifetimeSeconds:
        spec.lifetimeSeconds > 0 ? spec.lifetimeSeconds : habitatConfig.ballLifetimeSeconds,
      frameAngle,
      omega,
      onBounce: (bouncedBall, impactSpeed) => {
        throwTarget.bounced(bouncedBall)
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
        throwTarget.track(releasedBall, worldVelocity, rpmToOmega(habitatConfig.rpm))

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
      // Repeatable throws: aim is the only variable until the player selects
      // the slower throw. Fine speed scaling remains in the advanced settings.
      fillCarrierRotatingVelocity(controllerCarrierVelocity)
      const throwSpeed = BALL_THROW_SPEEDS[ballThrowStyle] * habitatConfig.ballSpeedScale
      worldVelocity
        .copy(worldForward)
        .multiplyScalar(throwSpeed)
        .add(controllerCarrierVelocity)
      ball.setVelocity(worldVelocity)
    }

    if (type === 'ball' && releasedByController === undefined) {
      throwTarget.track(ball, worldVelocity, omega)
    }

    nearLayer.add(ball.mesh)
    // The beam bolt is its own streak; everything else draws a motion trail.
    if (spec.trail !== false) {
      nearLayer.add(ball.trail)
      nearLayer.add(ball.inertialTrail)
      if (ball.earthGhost !== null) {
        nearLayer.add(ball.earthGhost)
      }
    }
    if (spec.grabbable) {
      grabSystem.registerTarget(ball.grabTarget)
    }
    balls.push(ball)
    reportTour('throw')

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

    spawnProjectile(selectedProjectile, { origin: camera })
    audio.playThrow()
    vibrate(8)
  }

  const requestDesktopThrow = () => {
    if (renderer.xr.isPresenting) {
      return
    }

    desktopThrowQueued = true
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
    if (!isGameplayKeyboardEvent(event)) return
    audio.unlock()

    if (event.code === 'KeyM' && !event.repeat) {
      audio.toggleMuted()
    }

    if (renderer.xr.isPresenting) {
      return
    }

    // Tab gives the pointer back and lets native focus reach the dock.
    if (event.code === 'Tab') {
      desktopLookControls.releasePointerLock()
      return
    }

    if (event.code === 'KeyX') {
      cycleSelectedProjectile()
      return
    }

    // Keyboard twins of the dock buttons (2026-09-03): with the pointer
    // locked for mouse look the dock cannot be clicked, so Spin, Rain, Photo
    // and Link get keys. Spin repeats while held.
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      handleWatchAction('rpm-coarse-decrement')
      return
    }
    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      handleWatchAction('rpm-coarse-increment')
      return
    }

    if (event.repeat) {
      return
    }

    if (event.code === 'KeyR') {
      setRaining(!weather.raining)
      return
    }
    if (event.code === 'KeyP') {
      photoAction()
      return
    }
    if (event.code === 'KeyL') {
      void shareLinkAction()
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

    if (event.code === 'KeyC') {
      activateCoffee()
      return
    }

    if (event.code === 'KeyE') {
      if (toggleRoomSeat()) return
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

  const cancelDesktopIntent = () => {
    driveKeys.forward = driveKeys.back = driveKeys.left = driveKeys.right = driveKeys.brake = false
    desktopJumpQueued = false
    desktopThrowQueued = false
  }
  const removeInputInterruption = onInputInterrupted(cancelDesktopIntent)
  renderer.xr.addEventListener('sessionstart', cancelDesktopIntent)

  renderer.domElement.addEventListener('pointerdown', (event) => {
    audio.unlock()

    if (event.button !== 0) {
      return
    }

    // Touch taps are handled by MobileControls (tap vs drag discrimination).
    if (event.pointerType === 'touch') {
      return
    }

    // The click that grabs the pointer for mouse look is not a throw.
    if (desktopLookControls.consumeLockClick()) {
      reportTour('look-lock')
      return
    }

    requestDesktopThrow()
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
    statsOverlay?.update(deltaSeconds, perfMeter.stats(), depthMode)

    if (resolutionGovernor !== null && !renderer.xr.isPresenting) {
      const loweredRatio = resolutionGovernor.frame(performance.now())
      if (loweredRatio !== null) {
        // Both setPixelRatio calls re-run setSize internally, so the canvas,
        // the bloom target and its passes all follow.
        renderer.setPixelRatio(loweredRatio)
        bloomComposer?.setPixelRatio(loweredRatio)
        console.info(
          `spinward: slow frames — render resolution lowered to ${loweredRatio}x (pin with ?dpr=<n>)`
        )
      }
    }

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

    if (desktopThrowQueued) {
      desktopThrowQueued = false
      throwDesktopBall()
    }

    grabSystem.update()

    // Update order: input -> grab state -> simulation -> render.
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + omega * deltaSeconds, Math.PI * 2)
    if (!renderer.xr.isPresenting) desktopLookControls.advanceReferenceFrame(omega * deltaSeconds)
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

    roomSeating.update(playerTraversal, { ...seatFrame(), frameAngle: frameAngleStart }, cityscape.getSeats())
    let jumpRequested = (desktopJumpQueued || xrWatchInput.jumpPressed) && !drive.driving
    if (roomSeating.seat && (renderer.xr.isPresenting || jumpRequested || locomotionIntent.detachRequested ||
        Math.hypot(locomotionIntent.groundedAxis, locomotionIntent.groundedTangent) > .1)) {
      roomSeating.leave(playerTraversal, { ...seatFrame(), frameAngle: frameAngleStart })
      jumpRequested = false
      locomotionIntent.detachRequested = false
      locomotionIntent.groundedAxis = 0; locomotionIntent.groundedTangent = 0
    }
    // Finish standing before walking: restore floor contacts at rest first.
    if (roomSeating.stepDeparture(deltaSeconds)) {
      jumpRequested = false; locomotionIntent.detachRequested = false
      locomotionIntent.groundedAxis = 0; locomotionIntent.groundedTangent = 0
    }
    // While driving, the VR jump button (right A) is the dismount, not a jump.
    if (drive.driving && xrWatchInput.jumpPressed) {
      exitDrive()
    }
    desktopJumpQueued = false

    const vehicleSteer = THREE.MathUtils.clamp(
      Number(driveKeys.right) - Number(driveKeys.left) + (touchMove?.right ?? 0) + xrWatchInput.driveSteer, -1, 1)
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
          steer: vehicleSteer,
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
          surfaceElevation: (a, ax) => Math.max(sampleExpresswayElevation(a, ax), cityscape.sampleRiverRoad(a, ax))
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
      reportTour('jump')
      audio.playJump()
      vibrate(12)
      justJumped = true
    }

    if (roomSeating.seat) {
      // Stay attached at the end-of-step angle; dismounts use the start angle
      // before normal walking advances the body through this frame.
      roomSeating.update(playerTraversal, seatFrame(), cityscape.getSeats())
    } else if (playerTraversal.mode === 'grounded' && locomotionIntent.detachRequested) {
      detachPlayerToFreeFly(playerTraversal, {
        launchVelocity: locomotionIntent.detachLaunchVelocity,
        radius: habitatConfig.radius,
        omega,
        frameAngle
      })
    } else if (playerTraversal.mode === 'grounded' && !drive.driving) {
      // Human walking pace makes nearby furniture and foot contact readable;
      // PC Shift keeps the previous fast traversal speed available.
      const walkSpeed = renderer.xr.isPresenting || desktopLookControls.fastWalkHeld ? 6 : 1.8
      stepGroundedPlayer(playerTraversal, {
        axisDistanceDelta: locomotionIntent.groundedAxis * walkSpeed * deltaSeconds,
        tangentDistanceDelta: locomotionIntent.groundedTangent * walkSpeed * deltaSeconds,
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
      drive.driving ? drive.surface.axialPosition : playerFixedColliderPosition.y,
      drive.driving ? drive.lastElevation + 1.8 : playerTraversal.mode === 'grounded'
        ? playerTraversal.groundHeight + 1.8
        : habitatConfig.radius - Math.hypot(playerFixedColliderPosition.x, playerFixedColliderPosition.z)
    )
    parkedCars.setPack(cityscape.getKenneyCarPack())
    car.setPack(cityscape.getKenneyCarPack())
    parkedCars.update(
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
    if (!roomSeating.seat) {
      syncPlayerTraversalFromPhysics(playerTraversal)
      syncGroundedSurfaceFromPhysics(playerTraversal, frameAngle)
    }

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
    if (!drive.driving && !roomSeating.seat) {
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
        reportTour(enteredFreeFly ? 'enter-freefly' : 'enter-grounded')
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
    viewRig.position.y = landDipOffset + landingSettle + (drive.driving ? (renderer.xr.isPresenting ? xrDriverHeightOffset : Car.DRIVER_EYE.y - camera.position.y) : 0) +
      (!renderer.xr.isPresenting ? (roomSeating.eyeHeight - camera.position.y) * (roomSeating.seat ? 1 : 1-roomSeating.standingProgress) : 0)

    viewRig.position.x = drive.driving ? -Car.DRIVER_EYE.x : 0
    viewRig.position.z = drive.driving ? -Car.DRIVER_EYE.z : 0
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
      viewRig.position.y = landDipOffset + landingSettle + (drive.driving ? (renderer.xr.isPresenting ? xrDriverHeightOffset : Car.DRIVER_EYE.y - camera.position.y) : 0) +
      (!renderer.xr.isPresenting ? (roomSeating.eyeHeight - camera.position.y) * (roomSeating.seat ? 1 : 1-roomSeating.standingProgress) : 0)
    }
    camera.getWorldPosition(eyeWorldPrev)
    hasEyePrev = true

    const practicePark = cityscape.getPublicPark()
    throwTarget.configure(habitatConfig.radius, renderer.xr.isPresenting, practicePark
      ? { azimuth: practicePark.azimuth, axial: practicePark.axial + 4 }
      : habitatConfig.radius < 800 ? { azimuth: 0, axial: 0 } : null)
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

    throwTarget.step(balls, deltaSeconds)
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

    const currentPlacePlan = cityscape.getCityPlan()
    if (currentPlacePlan !== placesPlan) {
      placesPlan = currentPlacePlan
      availablePlaces.clear()
      for (const place of PLACE_DESTINATIONS) {
        if (resolvePlaceVisit(place.id, kind => cityscape.getInteriorVisit(kind))) availablePlaces.add(place.id)
      }
    }
    const outingSurface=drive.driving?drive.surface:playerTraversal.surface
    if(journey.action==='guide-car' && drive.driving)journey.cancel()
    if(journey.action && journey.driving!==drive.driving)refreshJourney()
    journey.update({azimuth:outingSurface.azimuth,axial:outingSurface.axialPosition},habitatConfig.radius,deltaSeconds)
    routeRetry+=deltaSeconds
    if(journey.action && routeRetry>3 && (journey.offRoute>1.5 || journey.status==='unavailable' && Math.hypot(wrapAngle(outingSurface.azimuth-routeOrigin.azimuth)*habitatConfig.radius,outingSurface.axialPosition-routeOrigin.axial)>5))refreshJourney()
    const destinationBay=journey.action?outingDestinations.get(journey.action)?.bay:null
    outingCanPark=!!(drive.driving && drive.lastGrounded && destinationBay && canParkAt({azimuth:drive.surface.azimuth,axial:drive.surface.axialPosition},drive.heading,drive.lastSpeed,drive.lastElevation,destinationBay,habitatConfig.radius))
    outingAngle=wrapAngle(journey.bearing-bodyHeading)
    const turn=Math.abs(outingAngle)<.35?'Ahead':Math.abs(outingAngle)>2.6?'Behind':outingAngle>0?'Right':'Left'
    outingDetail=journey.status==='unavailable'?'No local route · move nearer a street'
      : journey.status==='arrived'?(drive.driving?'Brake in the bay, then Park':journey.action==='guide-car'?'Your car is here · E to enter':journey.action==='guide-cafe'?'Café entrance · step inside for coffee':journey.action==='guide-park'?'Park entrance · follow the path to a bench':'Central Square · welcome back')
      : `${turn} ${Math.ceil(journey.nextDistance)} m · ${Math.ceil(journey.remaining)} m ${drive.driving?'to parking':'on foot'}`
    if(journey.status==='arrived' && !drive.driving && journey.action==='guide-cafe' && cityscape.sampleRoomEnvironment(outingSurface.azimuth,outingSurface.axialPosition,playerTraversal.groundHeight).cafe>.5)outingDetail=coffeeService.phase==='holding'?'Enjoy your coffee · Your car in Places':'You are inside · coffee at the counter'
    if(journey.status==='arrived' && journey.action==='guide-park' && roomSeating.seat)outingDetail='Take a break · Your car in Places'
    if(outingCanPark)outingDetail='Bay reached · Park to step out'
    dock.driving.parentElement!.hidden = !drive.driving
    outingPanel.update({label:journey.label,detail:outingDetail,angle:journey.status==='active'?outingAngle:NaN,active:journey.status!=='idle',driving:drive.driving,mode:drive.mode,canPark:outingCanPark,hidden:renderer.xr.isPresenting})
    const watchSnapshot = createWatchRenderSnapshot(settingsStore, {
      outing:{text:journey.action?`${journey.label} · ${outingDetail}`:'Choose a place; travel there on foot or by car.',mode:drive.mode,canPark:outingCanPark,active:!!journey.action},
      playerMode: playerTraversal.mode,
      platform: currentControlPlatform(),
      region: playerRegion,
      observerMode: effectiveObserverMode,
      trailMode: debugVisuals.trailMode,
      ballCount: balls.length,
      feltGravity,
      feltSpeed,
      raining: weather.raining,
      muted: audio.isMuted,
      availablePlaces,
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
      ballThrowStyle,
      slowThrowUnlocked: throwTarget.hasHit,
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
      driving: drive.driving,
      rpm: habitatConfig.rpm,
      feltGravity,
      axisAvailable: canRespawnOnAxisEnd(habitatConfig.type),
      oldTownAvailable:
        getArrivalSquare(habitatConfig.radius, getHabitatSpanMeters()) !== null,
      raining: weather.raining,
      availablePlaces,
      muted: audio.isMuted
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
    // Only the distant sky follows the eye. The air glow stays attached to the
    // habitat. Work in skyLayer's frame for both rotating/inertial observers.
    const skyCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : desktopUiCamera
    skyCamera.getWorldPosition(skyObserverPosition)
    skyLayer.worldToLocal(skyObserverPosition)
    starfield.setObserverPosition(skyObserverPosition)
    sun.setObserverPosition(skyObserverPosition)
    const skyFar = Math.max(4000, starfield.getSuggestedCameraFar())
    // Retain a little headroom to avoid changing the projection every step.
    // Habitat changes reset the far plane through syncHabitatRuntime.
    if (skyFar > camera.far) {
      camera.far = skyFar * 1.1
      camera.updateProjectionMatrix()
      inertialObserverCamera.far = camera.far
      inertialObserverCamera.updateProjectionMatrix()
    }
    watchPanel.update(
      watchSnapshot,
      renderer.xr.isPresenting,
      xrWatchInput.leftGrip,
      xrWatchInput.leftController
    )
    laserPointer.setController(renderer.xr.isPresenting ? xrWatchInput.rightController : null)
    const watchHit = laserPointer.update(watchPanel.interactiveObject, renderer.xr.isPresenting)
    watchPanel.updateHover(watchHit?.uv ?? null)
    watchUiHot = renderer.xr.isPresenting && watchHit !== null
    // Give wrist interaction priority over transient teaching cards. Keep a
    // brief grace period while the pointer crosses gaps between buttons.
    watchUiFocusRemaining = watchUiHot ? 1.5 : Math.max(0, watchUiFocusRemaining - deltaSeconds)

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
    const roomEnvironment = carrierInAir
      ? cityscape.sampleRoomEnvironment(Math.atan2(carrierRotatingPosition.z, carrierRotatingPosition.x), carrierRotatingPosition.y, habitatConfig.radius - carrierRadial)
      : { cafe: 0, lobby: 0, shelter: 0 }
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
      intensity: rainStrength,
      roofs: cityscape.getRainRoofs(),
      arcs: cityscape.getRainArcs()
    })
    const rainShelter = carrierInAir && rainStrength > .002 ? cityscape.sampleRainShelter(carrierRotatingPosition) : 0
    const rainAudibility = 1 - Math.max(roomEnvironment.shelter * .85, rainShelter * .55)
    audio.setRainLevel(rainStrength * rainAudibility)

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
        daylight,
        shelter: roomEnvironment.shelter
      })
    )

    audio.setRoomEnvironment(roomEnvironment)

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
    // The single owner of fog.density. Haze is the tier's air extinction
    // (from airFog.visibilityMeters, live-tunable) scaled by how much of a
    // cross-interior sightline actually lies in air — a cylinder is air to the
    // axis (fraction 1), an open ring like Elysium is mostly vacuum bore, so
    // the far rim stays visible instead of socking in (representative-
    // sightline approximation). Rain murk thickens it while the shower is up.
    // With the boundary-layer profile the shader integrates the air along
    // each sightline itself (a vacuum bore simply has no air near it), so the
    // representative-sightline fraction only applies to the uniform fallback.
    // Rings keep the uniform model: their air is a roofed tube, not a
    // gravity-settled layer against a floor.
    const layeredHaze = habitatConfig.type === 'cylinder' && airFog.scaleHeightMeters > 0
    setHazeProfile(hazeProfile, habitatConfig.radius, layeredHaze ? airFog.scaleHeightMeters : null, getHabitatSpanMeters())
    fog.density =
      visibilityToFogDensity(airFog.visibilityMeters) *
      (layeredHaze ? 1 : getAirColumnFraction(habitatConfig)) *
      (1 + 2.5 * rainLevel)
    habitat.setAtmosphere(fog.color, fog.density, hazeProfile)
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
    habitat.setCityShellDaylight(daylight)
    starfield.setDaylight(daylight, carrierInAir, deltaSeconds)
    intersectionFurniture.setDaylight(daylight)
    streetLamps.setDaylight(daylight)
    car.update(drive.driving, daylight, vehicleSteer)
    streetLamps.update(
      Math.atan2(carrierRotatingPosition.z, carrierRotatingPosition.x), carrierRotatingPosition.y,
      habitatConfig.radius - carrierRadial,
      deltaSeconds, roomEnvironment.shelter > .5
    )
    neighborhoodLife.setRadius(habitatConfig.radius)
    neighborhoodLife.setPlayerSeat(roomSeating.seat?.id ?? null)
    neighborhoodLife.update(deltaSeconds, { azimuth: Math.atan2(rotatingCameraPosition.z,rotatingCameraPosition.x), axial: rotatingCameraPosition.y,
      altitude: habitatConfig.radius-Math.hypot(rotatingCameraPosition.x,rotatingCameraPosition.z) },
      { azimuth: drive.surface.azimuth, axial: drive.surface.axialPosition, speed: drive.driving ? drive.lastSpeed : 0 })
    streetWalkers.update(deltaSeconds, { azimuth: Math.atan2(rotatingCameraPosition.z,rotatingCameraPosition.x), axial: rotatingCameraPosition.y,
      altitude: habitatConfig.radius-Math.hypot(rotatingCameraPosition.x,rotatingCameraPosition.z) },
      drive.driving ? { azimuth: drive.surface.azimuth, axial: drive.surface.axialPosition } : null)
    cityscape.update(deltaSeconds)
    intersectionFurniture.update(
      drive.driving ? drive.surface.azimuth : playerAzimuth,
      drive.driving ? drive.surface.axialPosition : playerFixedColliderPosition.y,
      deltaSeconds,
      cityscape.getTrafficClock()
    )
    // Aviation beacons: keep them at least ~1.3 CSS px in radius however far
    // they are (the far-side towers are 6 km up). In XR the drawing buffer is
    // the per-eye framebuffer, so its height is the right denominator there.
    {
      const heightPx = renderer.xr.isPresenting
        ? renderer.getDrawingBufferSize(beaconViewportScratch).y
        : window.innerHeight
      const drawingHeight=renderer.getDrawingBufferSize(beaconViewportScratch).y
      const eyes=renderer.xr.isPresenting?renderer.xr.getCamera().cameras:[]
      cityscape.setBuildingProjection(eyes.length?Math.max(...eyes.map(eye=>Math.abs(eye.projectionMatrix.elements[5])*(eye.viewport?.w??drawingHeight)/2)):drawingHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))))
      cityscape.setBeaconScreenScale(
        (beaconMinScreenRadiusPx * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) /
          Math.max(1, heightPx)
      )
    }
    spaceport.update(deltaSeconds)

    // Lightweight state probe for headless debugging.
    inertialPositionToRotating(playerTraversal.inertialPosition, frameAngle, rotatingCameraPosition)
    ;(window as unknown as { __spinward?: unknown }).__spinward = {
      tour: tourGuide.activeEvent,
      mode: playerTraversal.mode,
      room: { ...roomEnvironment, coffee: { phase: coffeeService.phase, servings: coffeeService.servings, sipRemaining: coffeeService.sipRemaining }, audio: audio.roomAudioState, seat: roomSeating.seat?.id ?? null,
        seats: cityscape.getSeats(), bodyEnabled: playerTraversal.physics?.freeFlyBody.isEnabled(),
        sensor: playerTraversal.physics?.freeFlyBody.collider(0).isSensor() },
      neighborhood: neighborhoodLife.group.userData,
      pixelRatio: renderer.getPixelRatio(),
      raining: weather.raining,
      parking: parkedCars.debugStats(),
      rain: { strength: rainStrength, shelter: rainShelter, audibility: rainAudibility },
      radial: Math.hypot(rotatingCameraPosition.x, rotatingCameraPosition.z),
      radius: habitatConfig.radius,
      axial: rotatingCameraPosition.y,
      azimuth: Math.atan2(rotatingCameraPosition.z, rotatingCameraPosition.x),
      speed: playerTraversal.inertialVelocity.length(),
      frameAngle,
      groundHeight: playerTraversal.groundHeight,
      dip: landDipOffset,
      outing: {action:journey.action,status:journey.status,label:journey.label,remaining:journey.remaining,nextDistance:journey.nextDistance,index:journey.index,detail:outingDetail,canPark:outingCanPark},
      drive: {
        mode: drive.mode,
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

    const nearSeat = !drive.driving ? nearestRoomSeat(cityscape.getSeats().filter(s => !neighborhoodLife.isSeatOccupied(s.id)), playerTraversal, habitatConfig.radius) : null
    const nearCar = car.group.visible && !nearSeat && !roomSeating.seat && playerTraversal.mode === 'grounded' &&
      drive.isPlayerNear(playerTraversal.surface.azimuth, playerTraversal.surface.axialPosition, habitatConfig.radius)
    roomAction.update(nearSeat?.label ?? null, !!roomSeating.seat, renderer.xr.isPresenting, isTouchDevice(),
      drive.driving ? (drive.mode==='street' && drive.lastSpeed>.8 ? 'Brake before leaving' : driveExitHint || 'Leave car') : nearCar ? 'Use car share' : null)
    const coffeeCtx = coffeeContext()
    coffeeService.update(deltaSeconds, coffeeCtx)
    coffeeAction.update(coffeeService.prompt(coffeeCtx), isTouchDevice())
    coffeeView.update(coffeeService, coffeeCtx.station, !coffeeCtx.blocked && playerTraversal.mode === 'grounded', roomEnvironment.cafe > 0, coffeeAction.getReservedBottomHeight())

    camera.updateWorldMatrix(true, false)
    cityscape.group.updateWorldMatrix(true, false)
    bodyFrameInverse.copy(cityscape.group.matrixWorld).invert()
    camera.getWorldDirection(bodyDirection).transformDirection(bodyFrameInverse)
    const trackedBody = renderer.xr.isPresenting
      ? sampleTrackedBodyPose(renderer, viewRig, cityscape.group, habitatConfig.radius, bodyHeading) : null
    const bodyAzimuth = trackedBody?.azimuth ?? playerTraversal.surface.azimuth
    const facingAzimuth=drive.driving?drive.surface.azimuth:bodyAzimuth
    const facingTangent = -Math.sin(facingAzimuth) * bodyDirection.x + Math.cos(facingAzimuth) * bodyDirection.z
    if (Math.hypot(facingTangent, bodyDirection.y) > .02) bodyHeading = Math.atan2(facingTangent, bodyDirection.y)
    if (trackedBody) bodyHeading = trackedBody.heading
    const stepped = playerBodyView.update({
      radius: habitatConfig.radius, azimuth: bodyAzimuth, axial: trackedBody?.axial ?? playerTraversal.surface.axialPosition,
      groundHeight: playerTraversal.groundHeight, heading: bodyHeading, grounded: playerTraversal.mode === 'grounded',
      enabled: !drive.driving && (!renderer.xr.isPresenting || !!trackedBody), visible: bootParams.get('body') !== '0', deltaSeconds,
      seat: roomSeating.seat, holding: coffeeService.phase === 'holding' && playerTraversal.mode === 'grounded',
      indoors: roomEnvironment.shelter > .5, tracked: trackedBody,
      airborneView: playerTraversal.mode === 'free-fly' && !renderer.xr.isPresenting
        ? airborneBodyView.multiplyMatrices(bodyFrameInverse, camera.matrixWorld) : undefined
    })
    if (stepped) audio.playFootstep(roomEnvironment, playerBodyView.motion.speed)
    if (playerBodyView.hand.parent !== coffeeView.held) coffeeView.held.add(playerBodyView.hand)

    if (mobileControls !== null) {
      mobileControls.update(renderer.xr.isPresenting)
      mobileControls.setDriving(drive.driving)
    }
    const activeTourCard = stepTourGuide(tourGuide, deltaSeconds)
    // Let the current room action teach itself. The large generic welcome
    // card otherwise covers the held cup and the seated body on portrait screens.
    const roomInteraction = !!roomSeating.seat || coffeeService.phase !== 'idle'
    const practiceCard = !drive.driving && !roomInteraction ? throwTarget.getCard(rotatingCameraPosition, selectedProjectile === 'ball') : null
    const visibleTourCard = practiceCard ?? (roomInteraction && tourGuide.activeEvent === 'start' ? null : activeTourCard)
    const resolvedTourCard = resolveTourCard(visibleTourCard, currentControlPlatform())
    const flatTourCard = tourGuide.activeEvent === 'start' && visibleTourCard === activeTourCard && resolvedTourCard
      ? { ...resolvedTourCard, title: 'Welcome to Spinward', body: [
        'Look up — the city wraps overhead. The floor’s push is your gravity.',
        'Choose Places for a destination. Movement controls and settings are in Menu.'
      ] } : resolvedTourCard
    tourNotice.update(flatTourCard, renderer.xr.isPresenting || journey.status !== 'idle' || drive.driving)
    tourCardPanel.update(renderer.xr.isPresenting && watchUiFocusRemaining === 0 ? resolvedTourCard : null, {
      camera: desktopUiCamera,
      deltaSeconds,
      xrActive: renderer.xr.isPresenting,
      bottomClearancePx: Math.max(mobileControls?.getReservedBottomHeight() ?? 0, roomAction.getReservedBottomHeight(), coffeeAction.getReservedBottomHeight())
    })
    if (bloomComposer !== null && bloomRenderPass !== null && !renderer.xr.isPresenting) {
      // Instructions are an overlay: keep their letters out of the world's
      // bloom and exposure pass. Phone and XR retain their direct scene path.
      if (tourCardPanel.mesh.parent !== tourOverlayScene) tourOverlayScene.add(tourCardPanel.mesh)
      bloomRenderPass.camera = desktopUiCamera
      if (bloomPass !== null) {
        // Subtle by day (sun glow), full at night (city lights).
        bloomPass.strength = BLOOM_BASE_STRENGTH * (0.25 + (1 - daylight) * 0.75)
      }
      bloomComposer.render()
      if (tourCardPanel.mesh.visible) {
        const autoClear = renderer.autoClear
        renderer.autoClear = false
        try { renderer.render(tourOverlayScene, desktopUiCamera) }
        finally { renderer.autoClear = autoClear }
      }
    } else {
      if (tourCardPanel.mesh.parent !== scene) scene.add(tourCardPanel.mesh)
      renderer.render(scene, desktopUiCamera)
    }
  })

  reportTour('start')
  // A shared link spawns where it points; otherwise the first-boot "look up"
  // reveal shows the far side of the colony overhead before the player
  // settles. Desktop/mobile only; XR is head-tracked.
  const interiorVisit = cityscape.getInteriorVisit(new URLSearchParams(window.location.search).get('visit'))
  if (shareState.pose !== null) {
    applySharedPose(shareState.pose, shareState.orientation)
  } else if (interiorVisit !== null) {
    applySharedPose({ mode: 'grounded', azimuth: interiorVisit.azimuth, axialPosition: interiorVisit.axial, groundHeight: interiorVisit.groundHeight ?? 0 }, interiorVisit.orientation)
  } else if (!renderer.xr.isPresenting) {
    desktopLookControls.startIntroReveal()
  }
  // Avoid paying native audio-device startup on the first walking input.
  audio.prepare()
  gameLoop.start()

  const splash = document.getElementById('splash')

  if (splash !== null) {
    splash.classList.add('splash--done')
    window.setTimeout(() => splash.remove(), 700)
  }
  resolutionGovernor?.start(performance.now())
  if (resolutionGovernor !== null) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        resolutionGovernor.resume()
      }
    })
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    inertialObserverCamera.aspect = window.innerWidth / window.innerHeight
    inertialObserverCamera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    bloomComposer?.setSize(window.innerWidth, window.innerHeight)
  })

  let appDisposed = false
  window.addEventListener('pagehide', (event) => {
    // A cached history entry resumes this same JS heap and WebGL scene.
    // Retain it while frozen; beforeunload also fires on those navigations.
    if (event.persisted || appDisposed) return
    appDisposed = true
    // Stop ticking before freeing physics, or a final frame races the
    // disposed Rapier world.
    renderer.setAnimationLoop(null)
    removeInputInterruption()
    document.removeEventListener('visibilitychange', syncAudioActivity)
    window.removeEventListener('pagehide', hideAudio)
    window.removeEventListener('pageshow', syncAudioActivity)
    audioSession?.removeEventListener('visibilitychange', syncAudioActivity)
    audio.dispose()
    bloomComposer?.dispose()
    drive.dispose()
    car.dispose()
    carShareStation.dispose()
    throwTarget.dispose()
    intersectionFurniture.dispose()
    parkedCars.dispose()
    sidewalks.dispose()
    streetLamps.dispose()
    rain.dispose()
    cityscape.dispose()
    spaceport.dispose()
    sun.dispose()
    starfield.dispose()
    atmosphereGlow.dispose()
    tourCardPanel.dispose()
    tourNotice.destroy()
    mobileControls?.dispose()
    fullscreenToggle?.dispose()
    roomAction.dispose()
    coffeeAction.dispose()
    playerBodyView.dispose()
    streetWalkers.dispose()
    neighborhoodLife.dispose()
    coffeeView.dispose()
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
