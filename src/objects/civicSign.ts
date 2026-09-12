import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** A painted, supported street sign. World lighting and depth apply to its
 * lettering exactly as to its frame; it never turns to follow the viewer. */
export function civicSign(title: string, lines: string[], width = 1.5) {
  const group = new THREE.Group()
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  let map: THREE.CanvasTexture | null = null
  if (canvas) {
    canvas.width = 768; canvas.height = 384
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#dedccb'; ctx.fillRect(0, 0, 768, 384)
    ctx.fillStyle = '#344d48'; ctx.fillRect(28, 28, 712, 8)
    ctx.font = '600 53px sans-serif'; ctx.fillText(title, 42, 112, 684)
    ctx.font = '34px sans-serif'
    lines.forEach((line, i) => ctx.fillText(line, 42, 190 + i * 56, 684))
    map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 2),
    new THREE.MeshStandardMaterial({ map, roughness: .9 }))
  face.position.set(0, 1.5, .041)
  group.add(face)
  const frame = new THREE.MeshStandardMaterial({ color: 0x35444a, roughness: .7, metalness: .3 })
  const pieces = [new THREE.BoxGeometry(width + .05, width / 2 + .05, .08).translate(0, 1.5, 0),
    ...[-width * .35, width * .35].map(x => new THREE.BoxGeometry(.065, 1.5, .065).translate(x, .75, 0))]
  const geometry = mergeGeometries(pieces)!
  pieces.forEach(piece => piece.dispose())
  group.add(new THREE.Mesh(geometry, frame))
  group.userData.dispose = () => {
    group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    face.material.dispose(); frame.dispose(); map?.dispose(); group.removeFromParent()
  }
  return group
}
