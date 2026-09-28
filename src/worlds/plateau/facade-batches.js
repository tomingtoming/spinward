import * as T from 'three'

// Source chunks retain LOD, collision and streaming ownership. At draw time,
// concatenate only their visible instances by prototype/material. Keeping the
// original culling spheres avoids submitting an entire neighbourhood when a
// large combined bound merely touches an eye's frustum.
export class FacadeBatches{
  constructor(group){
    this.group=group;this.sources=[];this.batches=new Map();this.frusta=[]
    this.matrix=new T.Matrix4();this.sphere=new T.Sphere();this.uploads=0
    group.update=camera=>this.update(camera)
  }
  select(sources){this.sources=sources}
  clear(){
    for(const {mesh} of this.batches.values()){
      this.group.remove(mesh);mesh.dispose();mesh.geometry.dispose()
    }
    this.batches.clear()
  }
  update(camera){
    const eyes=camera.isArrayCamera?camera.cameras:[camera]
    for(let i=0;i<eyes.length;i++){
      const eye=eyes[i];this.frusta[i]??=new T.Frustum()
      this.frusta[i].setFromProjectionMatrix(this.matrix.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse))
    }
    const buckets=new Map()
    for(const source of this.sources){
      this.sphere.copy(source.boundingSphere).applyMatrix4(this.group.matrixWorld)
      if(!eyes.some((_,i)=>this.frusta[i].intersectsSphere(this.sphere)))continue
      const key=`${source.userData.facadePrototype}:${source.material.id}`
      if(!buckets.has(key))buckets.set(key,[])
      buckets.get(key).push(source)
    }
    for(const [key,batch] of this.batches)batch.mesh.visible=buckets.has(key)
    for(const [key,sources] of buckets){
      let batch=this.batches.get(key)
      const count=sources.reduce((n,s)=>n+s.count,0)
      if(!batch||batch.capacity<count){
        if(batch){this.group.remove(batch.mesh);batch.mesh.dispose();batch.mesh.geometry.dispose()}
        const first=sources[0],g=new T.BufferGeometry(),capacity=Math.ceil(count/256)*256
        for(const [name,a] of Object.entries(first.geometry.attributes))g.setAttribute(name,a.isInstancedBufferAttribute
          ?new T.InstancedBufferAttribute(new a.array.constructor(capacity*a.itemSize),a.itemSize,a.normalized).setUsage(T.DynamicDrawUsage)
          :new T.BufferAttribute(a.array,a.itemSize,a.normalized))
        g.setIndex(new T.BufferAttribute(first.geometry.index.array,1))
        const mesh=new T.InstancedMesh(g,first.material,capacity)
        mesh.name='facade-batch';mesh.userData.sharedFacade=true
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage)
        mesh.instanceColor=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage)
        mesh.customDepthMaterial=first.customDepthMaterial;mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow
        // The custom LOD update runs during render traversal, after matrixWorld
        // propagation; new identity children need their world matrix immediately.
        mesh.matrixWorld.copy(this.group.matrixWorld);this.group.add(mesh)
        batch={mesh,capacity,sources:[]};this.batches.set(key,batch)
      }
      const mesh=batch.mesh;mesh.visible=true
      if(sources.length===batch.sources.length&&sources.every((s,i)=>s===batch.sources[i]))continue
      const attributes=['instanceMatrix','instanceColor'],perPart=Object.keys(mesh.geometry.attributes).filter(k=>mesh.geometry.attributes[k].isInstancedBufferAttribute)
      let offset=0;const bounds=new T.Sphere().makeEmpty()
      for(const source of sources){
        for(const k of attributes)mesh[k].array.set(source[k].array.subarray(0,source.count*source[k].itemSize),offset*source[k].itemSize)
        for(const k of perPart){const a=source.geometry.attributes[k];mesh.geometry.attributes[k].array.set(a.array.subarray(0,source.count*a.itemSize),offset*a.itemSize)}
        bounds.union(source.boundingSphere);offset+=source.count
      }
      for(const a of [...attributes.map(k=>mesh[k]),...perPart.map(k=>mesh.geometry.attributes[k])]){
        a.clearUpdateRanges();a.addUpdateRange(0,count*a.itemSize);a.needsUpdate=true
      }
      mesh.count=count;mesh.boundingSphere=bounds;batch.sources=sources;this.uploads++
    }
  }
}
