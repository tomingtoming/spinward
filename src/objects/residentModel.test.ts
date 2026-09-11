import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {poseResident,placeResident,ResidentBatches} from './residentModel'
const load=async()=>{
 const d=readFileSync(new URL('../../public/assets/people/resident.glb',import.meta.url))
 return (await new GLTFLoader().parseAsync(d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength),'')).scene
}
test('Blender resident has metric adult proportions and batch-compatible shared topology',async()=>{
 const scene=await load(),root=scene.getObjectByName('resident')!
 const bounds=new THREE.Box3().setFromObject(root)
 expect(bounds.max.y).toBeGreaterThan(1.7);expect(bounds.max.y).toBeLessThan(1.8)
 expect(Math.abs(bounds.min.y)).toBeLessThan(.02)
 let first:number[]|null=null,triangles=0
 root.traverse(o=>{if(!(o instanceof THREE.Mesh))return
  const positions=Array.from(o.geometry.getAttribute('position').array)
  if(first)expect(positions).toEqual(first);else first=positions
  triangles+=(o.geometry.index?.count??positions.length/3)/3
 })
 expect(triangles).toBeLessThan(5000)
 const batches=new ResidentBatches(root,3);batches.update([root]);expect(batches.group.children.length).toBeLessThanOrEqual(5)
})
test('sitting bends knees toward the aisle and keeps soles at floor level',async()=>{
 const root=(await load()).getObjectByName('resident')!
 poseResident(root,0,false,true)
 root.updateMatrixWorld(true)
 const foot=root.getObjectByName('left_shoe')!,hip=root.getObjectByName('left_hip')!
 const footCentre=foot.getWorldPosition(new THREE.Vector3()),hipCentre=hip.getWorldPosition(new THREE.Vector3())
 expect(footCentre.z-hipCentre.z).toBeGreaterThan(.4)
 expect(new THREE.Box3().setFromObject(foot).min.y).toBeCloseTo(.25,2)
 for(const a of [0,1,Math.PI-.01]){
  placeResident(root,a,10,3200,Math.PI/2,0)
  const up=new THREE.Vector3(0,1,0).applyQuaternion(root.quaternion)
  expect(up.dot(new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)))).toBeCloseTo(1)
 }
})
