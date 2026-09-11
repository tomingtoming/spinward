import {expect,test} from 'bun:test'
import * as THREE from 'three'
import {StableInstanceBatch,type InstanceSlot} from './stableInstanceBatch'

const make=()=>{
 const geometry=new THREE.BoxGeometry(1,1,1)
 geometry.setAttribute('facade',new THREE.InstancedBufferAttribute(new Float32Array(512*4),4))
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),512)
 return {mesh,batch:new StableInstanceBatch(mesh)}
}
test('visibility churn preserves each surviving transform, colour and facade without duplicates',()=>{
 const {mesh,batch}=make(),slots:InstanceSlot[]=Array.from({length:400},()=>({index:-1})),active=new Set<number>()
 const write=(id:number,index:number)=>{
  mesh.setMatrixAt(index,new THREE.Matrix4().makeTranslation(id,id*2,-id))
  mesh.setColorAt(index,new THREE.Color(id/400,.25,.5))
  ;(mesh.geometry.getAttribute('facade') as THREE.InstancedBufferAttribute).setXYZW(index,id,id+1,id+2,id+3)
 }
 for(let step=0;step<12;step++){
  const wanted=new Set(slots.flatMap((_,id)=>(id+step*13)%17<9?[id]:[]))
  for(const id of active)if(!wanted.has(id))batch.remove(slots[id])
  for(const id of wanted)if(!active.has(id))batch.add(slots[id],index=>write(id,index))
  active.clear();wanted.forEach(id=>active.add(id));batch.flush()
  expect(mesh.count).toBe(wanted.size)
  const seen=new Set<number>()
  for(let i=0;i<mesh.count;i++){
   const id=mesh.instanceMatrix.array[i*16+12];seen.add(id)
   expect(mesh.instanceMatrix.array[i*16+13]).toBe(id*2);expect(mesh.instanceMatrix.array[i*16+14]).toBe(-id)
   expect(mesh.instanceColor!.getX(i)).toBeCloseTo(id/400,5)
   expect(mesh.geometry.getAttribute('facade').getX(i)).toBe(id)
   expect(mesh.geometry.getAttribute('facade').getW(i)).toBe(id+3)
   expect(slots[id].index).toBe(i)
  }
  expect(seen).toEqual(wanted)
  mesh.instanceMatrix.clearUpdateRanges()
 }
})
test('stationary membership does not upload buffers; multiple updates before render retain all ranges',()=>{
 const {mesh,batch}=make(),slots=Array.from({length:10},()=>({index:-1}))
 slots.forEach((slot,i)=>batch.add(slot,index=>mesh.setMatrixAt(index,new THREE.Matrix4().makeTranslation(i,0,0))))
 expect(batch.flush()).toBe(10);mesh.instanceMatrix.clearUpdateRanges()
 const version=mesh.instanceMatrix.version
 slots.forEach(slot=>batch.add(slot,()=>{throw Error('Existing instance rewritten')}))
 expect(batch.flush()).toBe(0);expect(mesh.instanceMatrix.version).toBe(version)
 batch.remove(slots[1]);expect(batch.flush()).toBe(1)
 batch.remove(slots[7]);expect(batch.flush()).toBe(1)
 for(const index of [1,7])expect(mesh.instanceMatrix.updateRanges.some(r=>r.start<=index*16&&r.start+r.count>=(index+1)*16)).toBe(true)
})
