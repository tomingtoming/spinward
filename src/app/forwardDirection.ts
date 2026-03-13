import * as THREE from 'three'

const forwardAxis = new THREE.Vector3(0, 0, -1)
const worldQuaternion = new THREE.Quaternion()

export const getForwardDirection = (object: THREE.Object3D, target = new THREE.Vector3()) =>
  target.copy(forwardAxis).applyQuaternion(object.getWorldQuaternion(worldQuaternion)).normalize()
