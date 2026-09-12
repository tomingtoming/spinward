import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

export const SIGNAL_VISOR_CAPACITY=48
export function signalVisorLevel(distance:number,previous=2) {
  if(distance<(previous===0?90:70))return 0
  return distance<(previous===2?160:190)?1:2
}

function fallbackVisors(){
  const parts:THREE.BufferGeometry[]=[]
  for(const y of [-.28,0,.28]){
    parts.push(new THREE.BoxGeometry(.264,.016,.175).translate(0,y+.124,.2325))
    for(const side of [-1,1])parts.push(new THREE.BoxGeometry(.016,.18,.175).translate(side*.124,y+.026,.2325))
  }
  const geometry=mergeGeometries(parts)!;for(const p of parts)p.dispose();return geometry
}

/** Small, shared fittings; no new light or shadow. Head bodies and circular
 * lenses remain at distance, with a hard cap on the extra near geometry. */
export class SignalVisors {
  readonly group=new THREE.Group()
  private readonly material=new THREE.MeshStandardMaterial({color:0x3b444a,roughness:.72,metalness:.3})
  private readonly batches=[0,1].map(()=>new THREE.InstancedMesh(fallbackVisors(),this.material,SIGNAL_VISOR_CAPACITY))
  private heads:{matrix:THREE.Matrix4;azimuth:number;axial:number;level:number}[]=[]
  private focusAzimuth=NaN
  private focusAxial=NaN
  private disposed=false
  constructor(parent:THREE.Group){
    this.group.name='intersection-signal-visors';this.group.userData.asset='fallback';parent.add(this.group)
    this.batches.forEach((mesh,i)=>{mesh.name=`signal-visors-lod${i}`;mesh.count=0;mesh.frustumCulled=false;this.group.add(mesh)})
    if(typeof document==='undefined')return
    new GLTFLoader().loadAsync('/assets/signal-visors.glb').then(g=>{
      const geometries:THREE.BufferGeometry[]=[]
      try{
        if(this.disposed)return
        for(const i of [0,1]){
          const node=g.scene.getObjectByName(`signal_visors_lod${i}`)
          if(!(node instanceof THREE.Mesh))throw Error('Missing signal visor LOD '+i)
          node.updateWorldMatrix(true,false)
          const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld);geometries.push(geometry);geometry.computeBoundingBox()
          const box=geometry.boundingBox!,triangles=(geometry.index?.count??geometry.getAttribute('position').count)/3
          if(box.min.z<.139||box.max.z>.321||box.min.x<-.17||box.max.x>.17||box.min.y<-.42||box.max.y>.42||triangles<100||triangles>(i===0?400:150))throw Error('Invalid signal visor bounds/budget')
        }
        this.batches.forEach((mesh,i)=>{mesh.geometry.dispose();mesh.geometry=geometries[i]})
        geometries.length=0;this.group.userData.asset='blender';this.focusAzimuth=NaN
      }finally{
        for(const geometry of geometries)geometry.dispose()
        g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})
      }
    }).catch(e=>console.warn('Signal visors unavailable; retaining supported fallback.',e))
  }
  setHeads(mesh:THREE.InstancedMesh|null){
    const key=(m:THREE.Matrix4)=>m.elements.slice(12,15).join(',')
    const previous=new Map(this.heads.map(h=>[key(h.matrix),h.level]))
    this.heads=[];this.focusAzimuth=NaN
    for(let i=0;i<(mesh?.count??0);i++){
      const matrix=new THREE.Matrix4();mesh!.getMatrixAt(i,matrix)
      const p=new THREE.Vector3().setFromMatrixPosition(matrix)
      this.heads.push({matrix,azimuth:Math.atan2(p.z,p.x),axial:p.y,level:previous.get(key(matrix))??2})
    }
    for(const batch of this.batches)batch.count=0
    this.group.userData.counts=[0,0];this.group.userData.triangles=0
  }
  update(azimuth:number,axial:number,radius:number){
    const distance=(a:number,b:number)=>Math.hypot(Math.atan2(Math.sin(a-azimuth),Math.cos(a-azimuth))*radius,b-axial)
    if(Number.isFinite(this.focusAzimuth)&&distance(this.focusAzimuth,this.focusAxial)<2)return
    this.focusAzimuth=azimuth;this.focusAxial=axial
    const ordered=this.heads.map(h=>({h,d:distance(h.azimuth,h.axial)})).sort((a,b)=>a.d-b.d)
    const counts=[0,0]
    for(const {h,d} of ordered)h.level=signalVisorLevel(d,h.level)
    for(const {h} of ordered.filter(({h})=>h.level<2).slice(0,SIGNAL_VISOR_CAPACITY))this.batches[h.level].setMatrixAt(counts[h.level]++,h.matrix)
    this.batches.forEach((b,i)=>{b.count=counts[i];b.instanceMatrix.needsUpdate=true})
    this.group.userData.counts=counts;this.group.userData.triangles=counts.reduce((n,c,i)=>n+c*(this.batches[i].geometry.index?.count??this.batches[i].geometry.getAttribute('position').count)/3,0)
  }
  dispose(){this.disposed=true;for(const b of this.batches){b.geometry.dispose();b.dispose()}this.material.dispose();this.group.removeFromParent()}
}
