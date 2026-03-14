import * as THREE from 'three'

export type SurfaceRigState = {
  axialPosition: number
  azimuth: number
}

type SurfaceRigMoveOptions = {
  capEnds?: boolean
  endCapMargin?: number
}

const outward = new THREE.Vector3()
const inward = new THREE.Vector3()
const tangent = new THREE.Vector3()
const axis = new THREE.Vector3(0, 1, 0)
const basis = new THREE.Matrix4()

export const getSurfacePosition = (
  state: SurfaceRigState,
  radius: number,
  target = new THREE.Vector3()
) => {
  outward.set(Math.cos(state.azimuth), 0, Math.sin(state.azimuth))
  return target.copy(outward).multiplyScalar(radius).setY(state.axialPosition)
}

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
  playerRig.position.copy(getSurfacePosition(state, radius))
}

export const moveSurfaceRigState = (
  state: SurfaceRigState,
  localAxisDelta: number,
  localTangentDelta: number,
  radius: number,
  length: number,
  options: SurfaceRigMoveOptions = {}
) => {
  state.axialPosition += localAxisDelta
  state.azimuth += localTangentDelta / Math.max(radius, 0.001)

  if (options.capEnds ?? true) {
    const halfLength = Math.max(0, length * 0.5 - (options.endCapMargin ?? 1.5))
    state.axialPosition = THREE.MathUtils.clamp(state.axialPosition, -halfLength, halfLength)
  }
}

export const getSurfaceRigRegion = (
  state: SurfaceRigState,
  length: number,
  endCapMargin = 1.5
) => {
  const halfLength = Math.max(0, length * 0.5 - endCapMargin)
  return Math.abs(state.axialPosition) <= halfLength ? 'inside' : 'outside'
}
