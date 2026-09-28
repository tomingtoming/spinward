import {test,expect} from 'bun:test'
import * as T from 'three'
import {overviewHierarchy} from './overview-chunks.js'

function fixture(){
  const position=new Float32Array([0,30,60,90].flatMap(x=>[x-1,-70,-20,x+1,-70,-20,x+1,70,-20,x-1,70,-20]))
  const index=new Uint32Array([0,1,2,3].flatMap(i=>[i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3]))
  const segments=[0,1,2,3].map(i=>({tile:`${i*10}-0`,first:i*6,count:6}))
  const data={attributes:{position,index},segments}
  const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(position,3)).setIndex(new T.BufferAttribute(index,1))
  geometry.computeBoundingSphere()
  const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial())
  const {object,refs}=overviewHierarchy(data,mesh,10),lod=object as T.LOD
  const camera=(x:number)=>{const c=new T.PerspectiveCamera(30,1,.1,500);c.position.x=x;c.updateMatrixWorld();return c}
  const dispose=()=>{for(const r of refs)r.mesh.geometry.dispose();mesh.material.dispose()}
  lod.updateMatrixWorld(true)
  return{lod,refs,camera,dispose}
}

test('tight indexed bounds skip offscreen slender blocks while preserving the visible source indices',()=>{
  const {lod,refs,camera,dispose}=fixture()
  try{
    const eye=camera(0),frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse))
    // Regression: old spheres admit three blocks; only the first box intersects.
    expect(refs.slice(1).filter(r=>frustum.intersectsSphere(r.mesh.geometry.boundingSphere!)).length).toBeGreaterThan(2)
    lod.update(eye)
    expect(lod.children[0].visible).toBe(false)
    expect(lod.children[1].visible).toBe(true)
    expect(refs.slice(1).map(r=>r.mesh.visible)).toEqual([true,false,false,false])
    expect(Array.from(refs[1].mesh.geometry.index!.array)).toEqual([0,1,2,0,2,3])
  }finally{dispose()}
})

test('either eye can retain a chunk, including a transformed colony district and camera turns',()=>{
  const {lod,refs,camera,dispose}=fixture()
  try{
    lod.position.set(100,12,-40);lod.rotation.y=.73;lod.updateMatrixWorld(true)
    const transform=(c:T.PerspectiveCamera)=>{c.applyMatrix4(lod.matrixWorld);c.updateMatrixWorld();return c}
    const stereo=new T.ArrayCamera([transform(camera(0)),transform(camera(30))])
    lod.update(stereo)
    expect(refs.slice(1).map(r=>r.mesh.visible)).toEqual([true,true,false,false])
    lod.update(transform(camera(90)))
    expect(refs.slice(1).map(r=>r.mesh.visible)).toEqual([false,false,false,true])
    const all=camera(45);all.position.z=400;all.fov=80;all.updateProjectionMatrix();all.updateMatrixWorld()
    lod.update(transform(all))
    expect(lod.children[0].visible).toBe(true)
    expect(lod.children[1].visible).toBe(false)
  }finally{dispose()}
})
