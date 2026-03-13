import * as THREE from 'three'

export const integrateSemiImplicitEuler = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3,
  deltaSeconds: number
) => {
  velocity.addScaledVector(acceleration, deltaSeconds)
  position.addScaledVector(velocity, deltaSeconds)
}
