import * as THREE from 'three'

type Sole = { mesh: THREE.Mesh; chain: THREE.Object3D[] }
const rigs = new WeakMap<THREE.Object3D, { pelvis: THREE.Object3D; soles: Sole[] }>()
const matrix = new THREE.Matrix4(), point = new THREE.Vector3()

/** Keep the lowest authored shoe vertex on the local support plane after the
 * ordinary gait. Only the pelvis moves; this is not a planted-foot IK solver.
 * Cached leg chains avoid a second whole-body world-matrix traversal. */
export function fitResidentFeet(root: THREE.Object3D, slopeX = 0, slopeZ = 0) {
  let rig = rigs.get(root)
  if (!rig) {
    const pelvis = root.getObjectByName('pelvis')
    if (!pelvis) return
    const soles: Sole[] = []
    for (const side of ['left', 'right']) {
      const mesh = root.getObjectByName(`${side}_shoe`) as THREE.Mesh | undefined
      if (!mesh?.isMesh) continue
      const chain: THREE.Object3D[] = []
      for (let node: THREE.Object3D | null = mesh; node && node !== root; node = node.parent) chain.unshift(node)
      soles.push({ mesh, chain })
    }
    rig = { pelvis, soles }; rigs.set(root, rig)
  }
  let lowest = Infinity
  for (const { mesh, chain } of rig.soles) {
    matrix.identity()
    for (const node of chain) { node.updateMatrix(); matrix.multiply(node.matrix) }
    const vertices = mesh.geometry.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(matrix)
      lowest = Math.min(lowest, point.y - slopeX * point.x - slopeZ * point.z)
    }
  }
  if (Number.isFinite(lowest)) rig.pelvis.position.y -= lowest
}
