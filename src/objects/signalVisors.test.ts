import {expect,test} from 'bun:test'
import * as THREE from 'three'
import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {SignalVisors,signalVisorLevel,SIGNAL_VISOR_CAPACITY} from './signalVisors'
import {IntersectionFurniture} from './intersectionFurniture'

test('both Blender visor LODs attach to the backing plate while leaving each lens readable from the front',async()=>{
 const bytes=readFileSync(new URL('../../public/assets/signal-visors.glb',import.meta.url))
 expect(bytes.length).toBeLessThan(65000)
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 try{
  for(const level of [0,1]){
   const node=gltf.scene.getObjectByName(`signal_visors_lod${level}`) as THREE.Mesh
   expect(node).toBeDefined();node.updateWorldMatrix(true,false);node.geometry.computeBoundingBox()
   expect((node.geometry.index?.count??node.geometry.getAttribute('position').count)/3).toBeLessThanOrEqual(level===0?400:150)
   expect(node.geometry.boundingBox!.min.z).toBeCloseTo(level===0?.14:.145,5);expect(node.geometry.boundingBox!.max.z).toBeCloseTo(.32,5)
   // Direct views of the full illuminated disk are unobstructed. Above that
   // disk, an actual opaque hood exists; it is not a detached front ring.
   for(const y of [-.28,0,.28]){
    for(const [dx,dy] of [[0,0],[.1,0],[-.1,0],[0,.1],[0,-.1]]){
     const ray=new THREE.Raycaster(new THREE.Vector3(dx,y+dy,1),new THREE.Vector3(0,0,-1))
     expect(ray.intersectObject(node)).toHaveLength(0)
    }
    const ray=new THREE.Raycaster(new THREE.Vector3(0,y+(level===0?.124:.114),1),new THREE.Vector3(0,0,-1))
    expect(ray.intersectObject(node).length).toBeGreaterThan(0)
   }
  }
 }finally{gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})}
})

test('visor streaming retains hysteresis, chooses nearby heads, and clears on habitat replacement',()=>{
 expect(signalVisorLevel(68,2)).toBe(0);expect(signalVisorLevel(82,0)).toBe(0)
 expect(signalVisorLevel(92,0)).toBe(1);expect(signalVisorLevel(180,1)).toBe(1);expect(signalVisorLevel(192,1)).toBe(2)
 const parent=new THREE.Group(),visors=new SignalVisors(parent),source=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),100)
 try{
  // Wrapped focus, deliberately reverse source order to test nearest priority.
  for(let i=0;i<100;i++)source.setMatrixAt(i,new THREE.Matrix4().makeTranslation(-3200,100-i,0))
  visors.setHeads(source);visors.update(-Math.PI,0,3200)
  const meshes=visors.group.children as THREE.InstancedMesh[]
  expect(meshes.reduce((n,m)=>n+m.count,0)).toBe(SIGNAL_VISOR_CAPACITY)
  for(const m of meshes)for(let i=0;i<m.count;i++){
   const matrix=new THREE.Matrix4();m.getMatrixAt(i,matrix)
   expect(matrix.elements[13]).toBeLessThanOrEqual(SIGNAL_VISOR_CAPACITY)
  }
  visors.update(-Math.PI,-120,3200);expect(meshes[0].count).toBe(0);expect(meshes[1].count).toBeGreaterThan(0)
  visors.update(-Math.PI,-250,3200);expect(meshes[0].count+meshes[1].count).toBe(0)
  source.count=1;source.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-3200,0,0))
  visors.setHeads(source);visors.update(-Math.PI,65,3200);expect(meshes[0].count).toBe(1)
  visors.setHeads(source);visors.update(-Math.PI,80,3200);expect(meshes[0].count).toBe(1)
  visors.setHeads(null);expect(visors.group.userData.triangles).toBe(0)
 }finally{visors.dispose();source.geometry.dispose();(source.material as THREE.Material).dispose();source.dispose()}
 expect(parent.children).toHaveLength(0)
})

test('round lenses face outward and each head has a solid connection to its supporting arm',()=>{
 for(const azimuth of [0,.7,Math.PI-.001]){
  const furniture=new IntersectionFurniture()
  try{
   furniture.setPlan([{azimuth,axial:500,avenueKind:'arterial',streetKind:'local',avenueWidth:19.5,streetWidth:6}],3200)
   furniture.update(azimuth,500,0,0);furniture.group.updateMatrixWorld(true)
   const heads=furniture.group.getObjectByName('intersection-signal-heads') as THREE.InstancedMesh
   const arms=furniture.group.getObjectByName('intersection-signal-arms') as THREE.InstancedMesh
   const lamps=furniture.group.getObjectByName('intersection-signal-lamps') as THREE.InstancedMesh
   const geometry=lamps.geometry.getAttribute('position')
   for(let i=0;i<geometry.count;i++)expect(Math.hypot(geometry.getX(i),geometry.getY(i))).toBeLessThanOrEqual(.105001)
   for(let i=0;i<heads.count;i++){
    const matrix=new THREE.Matrix4();heads.getMatrixAt(i,matrix)
    const start=new THREE.Vector3(0,.6,0).applyMatrix4(matrix),direction=new THREE.Vector3(0,-1,0).transformDirection(matrix)
    const hit=new THREE.Raycaster(start,direction,0,.2).intersectObject(heads)[0]
    expect(hit).toBeDefined();expect(hit.distance).toBeLessThan(.04)
    const below=new THREE.Vector3(0,.4,0).applyMatrix4(matrix)
    const armHit=new THREE.Raycaster(below,direction.clone().negate(),0,.3).intersectObject(arms)[0]
    expect(armHit).toBeDefined()
    // Head top 0.575 and arm underside overlap in the shared frame.
    expect(armHit.distance).toBeLessThan(.175)
   }
  }finally{furniture.dispose()}
 }
})
