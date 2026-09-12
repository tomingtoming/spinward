import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
export type BalconyLifeAssets = Record<'chair0' | 'chair1' | 'table0' | 'table1', THREE.BufferGeometry>
let pending: Promise<BalconyLifeAssets> | undefined
export function loadBalconyLifeAssets() {
  return pending ??= new GLTFLoader().loadAsync('/assets/buildings/balcony-life.glb').then(g => {
    const result = {} as BalconyLifeAssets
    try {
      for (const kind of ['chair', 'table'] as const) for (const lod of [0, 1] as const) {
        const node = g.scene.getObjectByName(`balcony_${kind}_lod${lod}`)
        if (!(node instanceof THREE.Mesh)) throw Error('Missing balcony furniture mesh')
        node.updateWorldMatrix(true, false)
        result[`${kind}${lod}`] = node.geometry.clone().applyMatrix4(node.matrixWorld)
      }
      return result
    } catch (error) { Object.values(result).forEach(geometry => geometry.dispose()); throw error }
    finally {
      g.scene.traverse(o => { if (o instanceof THREE.Mesh) {
        o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose())
      } })
    }
  })
}
