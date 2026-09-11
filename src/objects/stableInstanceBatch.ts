import * as THREE from 'three'

export type InstanceSlot = {index:number}
/** Dense GPU slots with swap removal. Unchanged instances never rewrite their buffers. */
export class StableInstanceBatch {
  private slots:InstanceSlot[]=[]
  private firstDirty=Infinity
  private lastDirty=-1
  writes=0
  constructor(readonly mesh:THREE.InstancedMesh){mesh.count=0}
  add(slot:InstanceSlot,write:(index:number)=>void){
    if(slot.index>=0)return
    const index=this.slots.length
    if(index>=this.mesh.instanceMatrix.count)throw Error('Structural instance capacity exceeded')
    slot.index=index;this.slots.push(slot);this.mesh.count=this.slots.length
    write(index);this.mark(index)
  }
  remove(slot:InstanceSlot){
    const index=slot.index
    if(index<0)return
    const last=this.slots.pop()!,lastIndex=this.slots.length
    if(index!==lastIndex){
      this.slots[index]=last;last.index=index
      for(const attribute of this.attributes()){
        const a=attribute.array,n=attribute.itemSize
        a.copyWithin(index*n,lastIndex*n,(lastIndex+1)*n)
      }
      this.mark(index)
    }
    slot.index=-1;this.mesh.count=this.slots.length
  }
  private attributes(){
    return [this.mesh.instanceMatrix,...(this.mesh.instanceColor?[this.mesh.instanceColor]:[]),
      ...Object.values(this.mesh.geometry.attributes).filter((a):a is THREE.InstancedBufferAttribute=>a instanceof THREE.InstancedBufferAttribute)]
  }
  private mark(index:number){this.firstDirty=Math.min(this.firstDirty,index);this.lastDirty=Math.max(this.lastDirty,index);this.writes++}
  flush(){
    if(this.lastDirty>=0)for(const a of this.attributes()){
      // Three clears ranges after upload; retain earlier updates until that render.
      a.addUpdateRange(this.firstDirty*a.itemSize,(this.lastDirty-this.firstDirty+1)*a.itemSize);a.needsUpdate=true
    }
    const writes=this.writes
    this.firstDirty=Infinity;this.lastDirty=-1;this.writes=0
    return writes
  }
}
