import './style.css'

import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x808080 })
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const box = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({ color: 0x66ccff })
)
box.position.set(0, 1.5, -2)
scene.add(box)

renderer.setAnimationLoop(() => {
  box.rotation.y += 0.01
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
