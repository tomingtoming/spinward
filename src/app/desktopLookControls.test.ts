import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { composeCameraParentTwist, DesktopLookControls } from './desktopLookControls'

// The regression behind "the view snaps somewhere else the moment I jump":
// the free-fly handoff wrote `rig := cameraWorld`, silently assuming the
// camera hung directly under the rig. Since f40190f the viewRig between them
// carries a constant snap-yaw (the boot 90-degree facing), so every handoff
// gained an extra yaw. The fix conjugates by the parent-chain twist; these
// tests pin that algebra to the real hierarchy shape (rig > viewRig > camera).
describe('composeCameraParentTwist', () => {
  const buildHierarchy = (viewYaw: number) => {
    const rig = new THREE.Group()
    const viewRig = new THREE.Group()
    const camera = new THREE.PerspectiveCamera()
    rig.add(viewRig)
    viewRig.add(camera)
    viewRig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw)
    return { rig, viewRig, camera }
  }

  test('collects the rotation between the camera and the rig', () => {
    const { rig, viewRig, camera } = buildHierarchy(Math.PI / 2)
    const twist = composeCameraParentTwist(camera, rig, new THREE.Quaternion())
    expect(twist.angleTo(viewRig.quaternion)).toBeCloseTo(0, 6)
  })

  test('rig = worldAttitude * twist^-1 keeps the camera world orientation across the handoff', () => {
    const { rig, camera } = buildHierarchy(Math.PI / 2)
    // A grounded pose: surface-basis rig, freely aimed camera.
    rig.quaternion.setFromEuler(new THREE.Euler(0.3, -1.1, 0.2))
    camera.rotation.set(-0.5, 0.8, 0)
    rig.updateMatrixWorld(true)

    const before = camera.getWorldQuaternion(new THREE.Quaternion())

    // The handoff: seed attitude from the world view, neutralise the camera,
    // hand the attitude to the rig conjugated by the parent twist.
    const twist = composeCameraParentTwist(camera, rig, new THREE.Quaternion())
    camera.rotation.set(0, 0, 0)
    rig.quaternion.copy(before).multiply(twist.clone().invert())
    rig.updateMatrixWorld(true)

    const after = camera.getWorldQuaternion(new THREE.Quaternion())
    expect(after.angleTo(before)).toBeCloseTo(0, 6)
  })

  test('the OLD handoff (rig := world) is off by exactly the view yaw — the jump snap', () => {
    const { rig, camera } = buildHierarchy(Math.PI / 2)
    camera.rotation.set(-0.4, 0.6, 0)
    rig.updateMatrixWorld(true)
    const before = camera.getWorldQuaternion(new THREE.Quaternion())

    camera.rotation.set(0, 0, 0)
    rig.quaternion.copy(before)
    rig.updateMatrixWorld(true)
    const after = camera.getWorldQuaternion(new THREE.Quaternion())

    expect(after.angleTo(before)).toBeCloseTo(Math.PI / 2, 6)
  })
})

test('travel look changes cancel the boot reveal and survive subsequent frames',()=>{
  const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window')
  const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
  Object.defineProperty(globalThis,'document',{value:new EventTarget(),configurable:true})
  const rig=new THREE.Group(),view=new THREE.Group(),camera=new THREE.PerspectiveCamera()
  rig.add(view);view.add(camera);view.rotation.y=Math.PI/2
  const controls=new DesktopLookControls(rig,camera,new EventTarget() as unknown as HTMLElement)
  try{
    controls.startIntroReveal();controls.update(.5,false)
    expect(Math.abs(camera.rotation.x)).toBeGreaterThan(.05)
    const direction=new THREE.Vector3(-1,.7,-.32).normalize()
    controls.faceDirection(direction)
    for(let i=0;i<30;i++)controls.update(1/60,false,undefined,true)
    rig.updateMatrixWorld(true)
    expect(camera.getWorldDirection(new THREE.Vector3()).dot(direction)).toBeCloseTo(1,6)
    const groundRig=new THREE.Group(),groundCamera=new THREE.PerspectiveCamera()
    groundRig.add(groundCamera)
    const grounded=new DesktopLookControls(groundRig,groundCamera,new EventTarget() as unknown as HTMLElement)
    try{
      grounded.startIntroReveal();grounded.update(.5,false)
      grounded.resetLook();grounded.update(.1,false)
      expect(groundCamera.rotation.x).toBeCloseTo(0,6)
    }finally{grounded.dispose()}
  }finally{
    controls.dispose()
    if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else Reflect.deleteProperty(globalThis,'window')
    if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else Reflect.deleteProperty(globalThis,'document')
  }
})
