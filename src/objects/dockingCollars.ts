import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

export const DOCKING_REACH=2.4
export type DockingBerth={x:number; y:number; z:number; endSign:number; shipY:number; occupied:boolean; portWidth:number}

function fallbackCollar(){
 const parts=[
  new THREE.CylinderGeometry(1.65,1.65,.18,10).rotateX(Math.PI/2).translate(0,0,.09),
  new THREE.CylinderGeometry(1.15,.96,2.02,10).rotateX(Math.PI/2).translate(0,0,1.19),
  new THREE.CylinderGeometry(.98,.98,.2,10).rotateX(Math.PI/2).translate(0,0,2.3)
 ]
 const geometry=mergeGeometries(parts)!
 for(const p of parts)p.dispose()
 const colors=new Float32Array(geometry.getAttribute('position').count*3).fill(.5)
 geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
 return geometry
}

/** Four small fittings use shared metric meshes. Their empty far LOD avoids
 * carrying subpixel mechanisms into whole-colony views. No physical airlock. */
export class DockingCollars {
 readonly group=new THREE.Group()
 private modules=[fallbackCollar(),fallbackCollar()]
 private readonly material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.72,metalness:.4,emissive:0x111b27,emissiveIntensity:.5})
 private berths:readonly DockingBerth[]=[]
 private disposed=false
 constructor(private parent:THREE.Group){
  this.group.name='spaceport-collars';parent.add(this.group);parent.userData.collarAsset='fallback'
  if(typeof document==='undefined')return
  new GLTFLoader().loadAsync('/assets/docking-collar.glb').then(g=>{
   const next:THREE.BufferGeometry[]=[]
   try{
    if(this.disposed)return
    for(const lod of [0,1]){
     const node=g.scene.getObjectByName(`docking_collar_lod${lod}`)
     if(!(node instanceof THREE.Mesh))throw Error('Missing docking collar LOD '+lod)
     node.updateWorldMatrix(true,false)
     const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld);next.push(geometry);geometry.computeBoundingBox()
     const box=geometry.boundingBox!
     if(!geometry.hasAttribute('color')||Math.abs(box.min.z)>.001||Math.abs(box.max.z-DOCKING_REACH)>.001||box.max.x>1.651)throw Error('Invalid docking collar dimensions')
    }
    for(const old of this.modules)old.dispose()
    this.modules=next.splice(0);parent.userData.collarAsset='blender';this.rebuild(this.berths)
   }finally{
    for(const geometry of next)geometry.dispose()
    g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})
   }
  }).catch(e=>console.warn('Docking collar unavailable; retaining metric fallback.',e))
 }
 rebuild(berths:readonly DockingBerth[]){
  this.group.clear();this.berths=berths
  for(const [i,b]of berths.entries()){
   const lod=new THREE.LOD();lod.name=`docking-collar-${i}`
   lod.addLevel(new THREE.Mesh(this.modules[0],this.material),0)
   lod.addLevel(new THREE.Mesh(this.modules[1],this.material),70,.15)
   lod.addLevel(new THREE.Object3D(),320,.15)
   lod.rotation.x=-b.endSign*Math.PI/2;lod.position.set(b.x,b.y,b.z);this.group.add(lod)
  }
 }
 dispose(){this.disposed=true;this.group.clear();for(const g of this.modules)g.dispose();this.material.dispose();this.parent.remove(this.group)}
}
