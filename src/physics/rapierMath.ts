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
