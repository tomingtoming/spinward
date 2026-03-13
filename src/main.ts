import './style.css'

import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'

type ControllerState = {
  controller: THREE.XRTargetRaySpace
  grip: THREE.XRGripSpace
  ray: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
}

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x202030)

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  100
)
camera.position.set(0, 1.6, 3)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.xr.enabled = true
renderer.xr.setReferenceSpaceType('local-floor')
document.body.appendChild(renderer.domElement)
document.body.appendChild(VRButton.createButton(renderer))

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2)
scene.add(light)

const raycaster = new THREE.Raycaster()
raycaster.far = 5

const defaultBoxPosition = new THREE.Vector3(0, 1.5, -2)
const viewerPosition = new THREE.Vector3()
const viewerDirection = new THREE.Vector3()
const defaultRayLength = 5

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x808080 })
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const boxMaterial = new THREE.MeshStandardMaterial({
  color: 0x66ccff,
  emissive: 0x000000
})

const box = new THREE.Mesh(
  new THREE.BoxGeometry(),
  boxMaterial
)
box.position.copy(defaultBoxPosition)
scene.add(box)

const controllerModelFactory = new XRControllerModelFactory()
let grabbedBy: THREE.XRTargetRaySpace | null = null

const makeControllerRay = () => {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ])
  const material = new THREE.LineBasicMaterial({ color: 0xffffff })
  const ray = new THREE.Line(geometry, material)
  ray.name = 'ray'
  ray.scale.z = defaultRayLength
  return ray
}

const getIntersection = (controller: THREE.XRTargetRaySpace) => {
  raycaster.setFromXRController(controller)
  const [intersection] = raycaster.intersectObject(box, false)
  return intersection ?? null
}

const placeBoxInFrontOfViewer = () => {
  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera

  viewer.getWorldPosition(viewerPosition)
  viewerDirection.set(0, 0, -1).applyQuaternion(viewer.quaternion)
  viewerDirection.y = 0

  if (viewerDirection.lengthSq() === 0) {
    viewerDirection.set(0, 0, -1)
  } else {
    viewerDirection.normalize()
  }

  box.position.copy(viewerPosition).addScaledVector(viewerDirection, 1.5)
  box.position.y = Math.max(1.2, viewerPosition.y - 0.1)
  box.rotation.set(0, 0, 0)
}

const releaseBox = () => {
  if (grabbedBy === null) {
    return
  }

  scene.attach(box)
  box.position.y = Math.max(0.5, box.position.y)
  grabbedBy = null
}

const grabBox = (controller: THREE.XRTargetRaySpace) => {
  if (grabbedBy !== null || getIntersection(controller) === null) {
    return
  }

  controller.attach(box)
  box.position.set(0, -0.05, -0.7)
  box.rotation.set(0, 0, 0)
  grabbedBy = controller
}

const buildController = (index: number): ControllerState => {
  const controller = renderer.xr.getController(index)
  const grip = renderer.xr.getControllerGrip(index)
  const ray = makeControllerRay()

  controller.add(ray)
  controller.addEventListener('selectstart', (event) => {
    grabBox(event.target)
  })
  controller.addEventListener('selectend', (event) => {
    if (grabbedBy === event.target) {
      releaseBox()
    }
  })
  controller.addEventListener('squeezestart', () => {
    releaseBox()
    placeBoxInFrontOfViewer()
  })

  grip.add(controllerModelFactory.createControllerModel(grip))

  scene.add(controller)
  scene.add(grip)

  return { controller, grip, ray }
}

const controllers = [buildController(0), buildController(1)]

const updateControllerRays = () => {
  let hovering = false

  for (const { controller, ray } of controllers) {
    const isHolding = grabbedBy === controller
    const intersection = grabbedBy === null ? getIntersection(controller) : null

    if (intersection !== null) {
      ray.scale.z = intersection.distance
      ray.material.color.set(0x7dd3fc)
      hovering = true
      continue
    }

    ray.scale.z = defaultRayLength
    ray.material.color.set(isHolding ? 0x34d399 : 0xffffff)
  }

  boxMaterial.emissive.setHex(grabbedBy !== null ? 0x113322 : hovering ? 0x0f3a52 : 0x000000)
}

renderer.setAnimationLoop(() => {
  if (grabbedBy === null) {
    box.rotation.y += 0.01
  }

  updateControllerRays()
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
