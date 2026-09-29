import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { poseAirborneBody, PlayerBodyMotion } from './playerBodyMotion'
import { poseResident } from './residentModel'

test('airborne arms stay out of the flat-screen view through pitch, roll and colony coordinates', async () => {
  const bytes = readFileSync(new URL('../../public/assets/people/resident.glb', import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const original = gltf.scene.getObjectByName('resident')!
  for (const angles of [[0,0,0],[.8,-1,2],[-1.5,2,-3]]) for (const aspect of [390/844, 1440/1000, 16/9, 21/9]) {
    const camera = new THREE.PerspectiveCamera(70, aspect, .1, 1e6)
    camera.position.set(3012, -19720, 501)
    camera.quaternion.setFromEuler(new THREE.Euler(...angles as [number,number,number]))
    camera.updateMatrixWorld(true)
    const root = original.clone(true)
    poseResident(root, 0, false, false)
    poseAirborneBody(root, camera.matrixWorld)
    root.updateMatrixWorld(true)
    for (const side of ['left', 'right']) {
      const hand = root.getObjectByName(side+'_hand')!, elbow = root.getObjectByName(side+'_elbow')!, shoulder = root.getObjectByName(side+'_shoulder')!
      const p = hand.getWorldPosition(new THREE.Vector3())
      // Behind the eye, or outside the frustum with margin for the hand's size.
      for (const joint of [p, elbow.getWorldPosition(new THREE.Vector3())]) {
        const view = joint.clone().applyMatrix4(camera.matrixWorldInverse), screen = joint.clone().project(camera)
        expect(view.z > -camera.near || Math.abs(screen.x) > 1.15 || Math.abs(screen.y) > 1.15).toBe(true)
      }
      expect(elbow.getWorldPosition(new THREE.Vector3()).distanceTo(shoulder.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(.282, 5)
      expect(p.distanceTo(elbow.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(Math.hypot(.249,.008), 5)
    }
  }
})

test('airborne arrival never reports planted feet or a phantom footstep', () => {
  const motion = new PlayerBodyMotion()
  const frame = { radius: 3200, azimuth: 0, axial: 0, heading: 0, grounded: false, deltaSeconds: 1/60 }
  expect(motion.update(frame)).toBe(false)
  expect(motion.feet.every(f => !f.planted)).toBe(true)
  for (let i=0;i<60;i++) expect(motion.update({...frame,axial:i*.1})).toBe(false)
  expect(motion.update({...frame,axial:6,grounded:true})).toBe(false)
  expect(motion.feet.every(f=>f.planted)).toBe(true)
})
