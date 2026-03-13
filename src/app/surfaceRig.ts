import * as THREE from 'three'

export type SurfaceRigState = {
  axialPosition: number
  azimuth: number
}

const outward = new THREE.Vector3()
const inward = new THREE.Vector3()
const tangent = new THREE.Vector3()
const axis = new THREE.Vector3(0, 1, 0)
const basis = new THREE.Matrix4()

export const applySurfaceRigState = (
  playerRig: THREE.Group,
  state: SurfaceRigState,
  radius: number
) => {
  outward.set(Math.cos(state.azimuth), 0, Math.sin(state.azimuth))
  inward.copy(outward).multiplyScalar(-1)
  tangent.set(-Math.sin(state.azimuth), 0, Math.cos(state.azimuth))
  basis.makeBasis(axis, inward, tangent)

  playerRig.quaternion.setFromRotationMatrix(basis)
  playerRig.position.copy(outward.multiplyScalar(radius))
  playerRig.position.y = state.axialPosition
}

export const moveSurfaceRigState = (
  state: SurfaceRigState,
  localAxisDelta: number,
  localTangentDelta: number,
  radius: number,
  length: number,
  endCapMargin = 1.5
) => {
  state.axialPosition += localAxisDelta
  state.azimuth += localTangentDelta / Math.max(radius, 0.001)

  const halfLength = Math.max(0, length * 0.5 - endCapMargin)
  state.axialPosition = THREE.MathUtils.clamp(state.axialPosition, -halfLength, halfLength)
}
