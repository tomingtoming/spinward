import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

import { DesktopLookControls } from './desktopLookControls'
import { getForwardDirection } from './forwardDirection'
import { GameLoop } from './gameLoop'
import { applySurfaceRigState, type SurfaceRigState } from './surfaceRig'
import { Ball } from '../objects/ball'
import { CylinderHabitat } from '../objects/cylinder'
import { ForceVectorArrows } from '../objects/forceVectors'
import {
  DEFAULT_HABITAT_CONFIG,
  rpmToOmega,
  surfaceGravityFromConfig
} from '../sim/habitatConfig'
import { createDebugGui } from '../ui/debugGui'
import { createHud } from '../ui/hud'
import { ControllerVelocityTracker } from '../xr/controllerVelocity'
import { GrabSystem } from '../xr/grabSystem'
import { VRLocomotion } from '../xr/vrLocomotion'

export const bootstrapApp = () => {
  const habitatConfig = { ...DEFAULT_HABITAT_CONFIG }
  const surfaceRigState: SurfaceRigState = {
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
  scene.add(habitat.group)

  const playerRig = new THREE.Group()
  scene.add(playerRig)

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
    1000
  )
  camera.position.set(0, 1.6, 0)
  playerRig.add(camera)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  document.body.appendChild(renderer.domElement)
  document.body.appendChild(VRButton.createButton(renderer))

  const desktopLookControls = new DesktopLookControls(
    surfaceRigState,
    playerRig,
    camera,
    renderer.domElement
  )

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2)
  scene.add(light)

  const sun = new THREE.DirectionalLight(0xcde8ff, 0.7)
  sun.position.set(-10, 8, 6)
  scene.add(sun)

  const restitution = 0.55
  const balls: Ball[] = []
  const forceVectorArrows = new ForceVectorArrows()
  const controllerVelocity = new ControllerVelocityTracker()
  const worldForward = new THREE.Vector3()
  const worldPosition = new THREE.Vector3()
  const worldVelocity = new THREE.Vector3()
  const spawnOffset = new THREE.Vector3()
  let desktopThrowQueued = false

  scene.add(forceVectorArrows.group)

  const grabSystem = new GrabSystem({
    scene,
    camera,
    renderer,
    controllerRoot: playerRig,
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

  const vrLocomotion = new VRLocomotion(
    grabSystem.getControllers().map(({ controller }) => controller),
    playerRig,
    camera,
    surfaceRigState
  )

  const syncHabitat = () => {
    habitat.setDimensions({
      radius: habitatConfig.radius,
      length: habitatConfig.length
    })
    applySurfaceRigState(playerRig, surfaceRigState, habitatConfig.radius)
    desktopLookControls.syncToRig(habitatConfig.radius)
  }

  syncHabitat()

  const hud = createHud()

  const debugGui = createDebugGui({
    config: habitatConfig,
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
    // Balls spawn slightly in front of the hand/camera so they do not self-intersect on release.
    origin.getWorldPosition(worldPosition)
    getForwardDirection(origin, worldForward)
    spawnOffset.copy(worldForward).multiplyScalar(0.35)

    const ball = new Ball({
      initialPosition: worldPosition.clone().add(spawnOffset),
      maxTrailPoints: habitatConfig.maxTrailPoints,
      lifetimeSeconds: habitatConfig.ballLifetimeSeconds,
      onReleased: (controller, releasedBall) => {
        // Controller velocity is noisy at low speed, so fall back to forward throw when needed.
        worldVelocity
          .copy(controllerVelocity.getVelocity(controller))
          .multiplyScalar(habitatConfig.ballSpeedScale)

        if (worldVelocity.lengthSq() < 4) {
          getForwardDirection(controller, worldForward)
          worldVelocity.copy(worldForward).multiplyScalar(6 * habitatConfig.ballSpeedScale)
        }

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
    controllerVelocity.update(deltaSeconds)
    desktopLookControls.update(
      deltaSeconds,
      renderer.xr.isPresenting,
      habitatConfig.radius,
      habitatConfig.length
    )
    vrLocomotion.update(deltaSeconds, renderer.xr.isPresenting, habitatConfig.radius, habitatConfig.length)

    if (desktopThrowQueued) {
      desktopThrowQueued = false
      throwDesktopBall()
    }

    grabSystem.update()

    // Update order: input -> grab state -> simulation -> render.
    const omega = rpmToOmega(habitatConfig.rpm)

    for (const ball of balls) {
      ball.step({
        deltaSeconds,
        radius: habitatConfig.radius,
        length: habitatConfig.length,
        omega,
        restitution
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
      forceVectors: debugVisuals.showForceVectors
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
  })

  console.info(
    `Cylinder axis: Y, Omega: (0, ${rpmToOmega(habitatConfig.rpm).toFixed(3)}, 0), g=${surfaceGravityFromConfig(habitatConfig).toFixed(2)}`
  )
}
