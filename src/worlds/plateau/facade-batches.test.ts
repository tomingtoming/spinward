import {test,expect} from 'bun:test'
import * as T from 'three'
import {FacadeBatches} from './facade-batches.js'
import {FacadeInstances} from './facade-instances.js'

function fixture(){
  const group=new T.LOD(),batcher=new FacadeBatches(group),material=new T.MeshStandardMaterial()
  const source=(x:number,owner:number,prototype=1)=>{
    const g=new T.PlaneGeometry(1,1)
    for(const [name,size] of [['instanceSize',2],['instanceFrame',3],['instanceDetail',4],['instanceLight',3]] as const){
      g.setAttribute(name,new T.InstancedBufferAttribute(new Float32Array(Array.from({length:size*2},(_,i)=>owner*4+i/10)),size))
    }
    const m=new T.InstancedMesh(g,material,2)
    m.setMatrixAt(0,new T.Matrix4().makeTranslation(x,0,0));m.setMatrixAt(1,new T.Matrix4().makeTranslation(x,1,0))
    m.setColorAt(0,new T.Color('#845a43'));m.setColorAt(1,new T.Color('#557c98'))
    m.boundingSphere=new T.Sphere(new T.Vector3(x,0,0),1);m.userData.facadePrototype=prototype
    return m
  }
  const camera=(x:number)=>{const c=new T.PerspectiveCamera(35,1,.1,100);c.position.set(x,0,10);c.lookAt(x,0,0);c.updateMatrixWorld();return c}
  return{group,batcher,material,source,camera}
}

test('batching preserves every selected attribute, prototype and owner; idle frames do not upload',()=>{
  const {group,batcher,material,source,camera}=fixture(),a=source(0,1),b=source(1,17),c=source(1,34,2)
  batcher.select([a,b,c]);group.updateMatrixWorld();batcher.update(camera(0))
  expect(batcher.batches.size).toBe(2)
  const combined=[...batcher.batches.values()].find(b=>b.mesh.count===4)!
  for(const k of ['instanceMatrix','instanceColor'] as const)expect(Array.from(combined.mesh[k].array.slice(0,4*a[k].itemSize))).toEqual([...a[k].array,...b[k].array])
  for(const k of ['instanceSize','instanceFrame','instanceDetail','instanceLight']){
    const attr=combined.mesh.geometry.attributes[k]
    expect(Array.from(attr.array.slice(0,4*attr.itemSize))).toEqual([...a.geometry.attributes[k].array,...b.geometry.attributes[k].array])
  }
  const uploads=batcher.uploads;batcher.update(camera(0));expect(batcher.uploads).toBe(uploads)
  expect(combined.mesh.instanceMatrix.version).toBe(1)
  batcher.select([b]);batcher.update(camera(0));expect(combined.mesh.count).toBe(2)
  expect(combined.mesh.geometry.attributes.instanceDetail.array[0]).toBe(68)
  batcher.clear();expect(group.children.length).toBe(0)
  for(const s of [a,b,c]){s.dispose();s.geometry.dispose()}material.dispose()
})

test('both eye frusta select original chunks, without including hidden neighbours',()=>{
  const {group,batcher,material,source,camera}=fixture(),a=source(-12,1),b=source(12,2),c=source(35,3)
  batcher.select([a,b,c]);group.updateMatrixWorld()
  batcher.update(camera(-12));expect([...batcher.batches.values()][0].mesh.count).toBe(2)
  batcher.update(new T.ArrayCamera([camera(-12),camera(12)]))
  const batch=[...batcher.batches.values()][0]
  expect(batch.mesh.count).toBe(4);expect(batch.sources).toEqual([a,b])
  // Transform the whole facade group: source spheres and packed geometry still agree.
  group.position.x=100;group.updateMatrixWorld();batcher.update(camera(88))
  expect(batch.sources).toEqual([a]);expect(batch.mesh.count).toBe(2)
  batcher.select([]);batcher.update(camera(88));expect(batch.mesh.visible).toBe(false)
  batcher.clear();for(const s of [a,b,c]){s.dispose();s.geometry.dispose()}material.dispose()
})

test('stream preparation, LOD replacement and eviction never retain stale packed instances',async()=>{
  const box=new T.BoxGeometry(1,1,1),prototype={positions:Array.from({length:box.attributes.position.count},(_,i)=>Array.from(box.attributes.position.array.slice(i*3,i*3+3))),normals:Array.from({length:box.attributes.normal.count},(_,i)=>Array.from(box.attributes.normal.array.slice(i*3,i*3+3))),stretch:Array(box.attributes.position.count*2).fill(0),roles:Array(box.attributes.position.count).fill(0),indices:Array.from(box.index!.array)}
  const kit={version:3,parts:Object.fromEntries(['window','glazing','entry','balcony','guard','trim','vent'].map(k=>[k,prototype]))}
  const rows=[{id:'office',usage:'業務施設',seed:1,walls:[{a:[-6,0],b:[6,0],length:12,normal:[0,-1],base:0,top:12,ground:[0,0,0],floors:4,roadDistance:3,projectionClearance:1.2}]}]
  const f=new FacadeInstances(kit,[{id:'0-0',buildings:rows}],{radius:3200},{band:0,anchor:{local:[0,0]}},{flatOpenings:true,batchFacades:true})
  const camera=new T.PerspectiveCamera(90,1,.1,100);camera.position.set(0,6,20);camera.lookAt(0,6,0);camera.updateMatrixWorld()
  const draw=(level:string)=>{f.updateLOD(camera.position,level);f.group.updateMatrixWorld();f.batcher!.update(camera)}
  const packed=()=>[...f.batcher!.batches.values()].filter(b=>b.mesh.visible).flatMap(b=>b.sources)
  try{
    draw('near');expect(packed().length).toBeGreaterThan(0)
    const near=new Set(packed());draw('mid');expect(packed().some(s=>!near.has(s))).toBe(true)
    let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),preparing=f.prepareSite('1-0',rows,()=>gate)
    draw('near');expect(packed().every(s=>s.name.startsWith('0-0:'))).toBe(true)
    release();await preparing;draw('near');expect(packed().some(s=>s.name.startsWith('1-0:'))).toBe(true)
    const designParts=f.design.parts.length
    f.removeSite('0-0');f.batcher!.update(camera)
    expect(packed().length).toBeGreaterThan(0);expect(packed().every(s=>s.name.startsWith('1-0:'))).toBe(true)
    expect(f.design.parts.length).toBe(designParts/2)
    draw('far');expect(packed().length).toBe(0)
    draw('near');expect(packed().length).toBeGreaterThan(0)
    f.removeSite('1-0');expect(f.group.children.length).toBe(0)
  }finally{f.dispose();box.dispose()}
})
