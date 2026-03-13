import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

import { GameLoop } from './gameLoop'
import { Ball } from '../objects/ball'
import { CylinderHabitat } from '../objects/cylinder'
import {
  DEFAULT_HABITAT_CONFIG,
  rpmToOmega,
  surfaceGravityFromConfig
} from '../sim/habitatConfig'
import { createDebugGui } from '../ui/debugGui'
import { ControllerVelocityTracker } from '../xr/controllerVelocity'
import { GrabSystem, type GrabTarget } from '../xr/grabSystem'

export const bootstrapApp = () => {
  const habitatConfig = { ...DEFAULT_HABITAT_CONFIG }
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

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2)
  scene.add(light)

  const sun = new THREE.DirectionalLight(0xcde8ff, 0.7)
  sun.position.set(-10, 8, 6)
  scene.add(sun)

  const restitution = 0.55
  const balls: Ball[] = []
  const controllerVelocity = new ControllerVelocityTracker()
  const worldForward = new THREE.Vector3()
  const worldPosition = new THREE.Vector3()
  const worldVelocity = new THREE.Vector3()
  const spawnOffset = new THREE.Vector3()
  let desktopThrowQueued = false

  const boxState = {
    grabbed: false,
    hovered: false
  }

  const boxMaterial = new THREE.MeshStandardMaterial({
    color: 0x66ccff,
    emissive: 0x000000
  })

  const box = new THREE.Mesh(new THREE.BoxGeometry(), boxMaterial)
  scene.add(box)

  const placeFromRigLocal = (object: THREE.Object3D, localPosition: THREE.Vector3) => {
    object.position.copy(playerRig.localToWorld(localPosition.clone()))
  }

  const updateBoxAppearance = () => {
    boxMaterial.emissive.setHex(
      boxState.grabbed ? 0x113322 : boxState.hovered ? 0x0f3a52 : 0x000000
    )
  }

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
    },
    onSqueezeStart: () => {
      grabSystem.placeObjectInFrontOfViewer(box)
      box.position.addScaledVector(new THREE.Vector3(-1, 0, 0), 0.2)
      box.rotation.set(0, 0, 0)
    }
  })

  for (const { controller } of grabSystem.getControllers()) {
    controllerVelocity.registerController(controller)
  }

  const boxTarget: GrabTarget = {
    object: box,
    holdRotation: new THREE.Euler(0, 0, 0),
    onGrabStart: () => {
      boxState.grabbed = true
      updateBoxAppearance()
    },
    onGrabEnd: () => {
      boxState.grabbed = false
      updateBoxAppearance()
    },
    onHoverChange: (hovered) => {
      boxState.hovered = hovered
      updateBoxAppearance()
    }
  }

  grabSystem.registerTarget(boxTarget)
  updateBoxAppearance()

  const syncHabitat = (resetBox = false) => {
    habitat.setDimensions({
      radius: habitatConfig.radius,
      length: habitatConfig.length
    })
    playerRig.position.set(habitatConfig.radius, 0, 0)

    if (resetBox && grabSystem.getGrabbedTarget() !== boxTarget) {
      placeFromRigLocal(box, new THREE.Vector3(0, 1.1, -2.2))
      box.rotation.set(0, 0, 0)
    }
  }

  syncHabitat(true)

  const debugGui = createDebugGui({
    config: habitatConfig,
    onHabitatChange: () => {
      syncHabitat(true)
    }
  })

  const spawnBall = ({
    origin,
    releasedByController
  }: {
    origin: THREE.Object3D
    releasedByController?: THREE.XRTargetRaySpace
  }) => {
    origin.getWorldPosition(worldPosition)
    origin.getWorldDirection(worldForward)
    spawnOffset.copy(worldForward).multiplyScalar(0.35)

    const ball = new Ball({
      initialPosition: worldPosition.clone().add(spawnOffset),
      maxTrailPoints: habitatConfig.maxTrailPoints,
      lifetimeSeconds: habitatConfig.ballLifetimeSeconds,
      onReleased: (controller, releasedBall) => {
        worldVelocity
          .copy(controllerVelocity.getVelocity(controller))
          .multiplyScalar(habitatConfig.ballSpeedScale)

        if (worldVelocity.lengthSq() < 4) {
          controller.getWorldDirection(worldForward)
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

  renderer.domElement.addEventListener('pointerdown', () => {
    requestDesktopThrow()
  })

  const gameLoop = new GameLoop(renderer, ({ deltaSeconds }) => {
    controllerVelocity.update(deltaSeconds)

    if (desktopThrowQueued) {
      desktopThrowQueued = false
      throwDesktopBall()
    }

    if (grabSystem.getGrabbedTarget() !== boxTarget) {
      box.rotation.y += 0.01
    }

    grabSystem.update()

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
    debugGui.update()
    renderer.render(scene, camera)
  })

  gameLoop.start()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  console.info(
    `Cylinder axis: Y, Omega: (0, ${rpmToOmega(habitatConfig.rpm).toFixed(3)}, 0), g=${surfaceGravityFromConfig(habitatConfig).toFixed(2)}`
  )
}
