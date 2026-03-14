import * as THREE from 'three'

export const copyRapierVector = (
  source: { x: number; y: number; z: number },
  target = new THREE.Vector3()
) => target.set(source.x, source.y, source.z)

export const toRapierVector = (source: THREE.Vector3) => ({
  x: source.x,
  y: source.y,
  z: source.z
})

export const scaleVector = (
  source: THREE.Vector3,
  scale: number,
  target = new THREE.Vector3()
) => target.copy(source).multiplyScalar(scale)

export const copyRapierVectorScaled = (
  source: { x: number; y: number; z: number },
  simScale: number,
  target = new THREE.Vector3()
) => target.set(source.x / simScale, source.y / simScale, source.z / simScale)

export const toRapierVectorScaled = (source: THREE.Vector3, simScale: number) => ({
  x: source.x * simScale,
  y: source.y * simScale,
  z: source.z * simScale
})
