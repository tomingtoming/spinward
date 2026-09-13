import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
let loading: Promise<THREE.Group> | null = null
// One shared original Blender asset, also used by the first-person hands/legs.
export function loadResidentModel() {
  return loading ??= new GLTFLoader().loadAsync('/assets/people/resident.glb').then(g=>g.scene)
}
export function poseResident(root:THREE.Object3D,time:number,walking:boolean,seated:boolean|number,phase=0,drinking=false) {
  const set=(name:string,x:number)=>{const node=root.getObjectByName(name);if(node)node.rotation.x=x}
  const sit=Number(seated),sip=drinking?Math.pow(Math.max(0,Math.sin((time%10)/10*Math.PI*2)),4):0
  const gait=Math.sin(time*7.5+phase), pelvis=root.getObjectByName('pelvis')
  if(pelvis)pelvis.position.y=.96-.20*sit+(walking?Math.abs(gait)*.012:0)
  for(const [side,sign] of [['left',1],['right',-1]] as const){
    set(`${side}_hip`,-Math.PI/2*sit+gait*.5*sign*(walking?1:0)*(1-sit))
    set(`${side}_knee`,Math.PI/2*sit+Math.max(0,-gait*sign)*.65*(walking?1:0)*(1-sit))
    set(`${side}_shoulder`,-.15*sit-gait*.24*sign*(walking?1:0)*(1-sit)-(side==='right'?sip*1.2:0))
    set(`${side}_elbow`,-.12-.88*sit-(side==='right'?sip*1.05:0))
  }
  const shoulder=root.getObjectByName('right_shoulder');if(shoulder)shoulder.rotation.z=-sip
  const head=root.getObjectByName('head');if(head)head.rotation.y=Math.sin(time*.32+phase)*.09
  const torso=root.getObjectByName('torso');if(torso)torso.rotation.x=.04*sit+Math.sin(time*1.6+phase)*.008*(1-sit)
}
/** Metric Y-up character anchored to the rotating surface, +Z along its heading. */
export function placeResident(root:THREE.Object3D,azimuth:number,axial:number,radius:number,heading:number,height=.25) {
  const up=new THREE.Vector3(-Math.cos(azimuth),0,-Math.sin(azimuth))
  const forward=new THREE.Vector3(-Math.sin(azimuth)*Math.sin(heading),Math.cos(heading),Math.cos(azimuth)*Math.sin(heading))
  root.position.set(Math.cos(azimuth)*(radius-height),axial,Math.sin(azimuth)*(radius-height))
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up,forward),up,forward))
}
export type ResidentAppearance = { cloth: THREE.Color; trousers: THREE.Color }
const untinted = new THREE.Color(1, 1, 1)
// All authored parts share the same UV-sphere topology. Preserve their named
// transform hierarchy for animation, but render all people in five material batches.
export class ResidentBatches {
  readonly group=new THREE.Group()
  private batches=new Map<string,THREE.InstancedMesh>()
  private matrix=new THREE.Matrix4()
  private shadows:THREE.InstancedMesh|null=null
  private shadowTexture:THREE.CanvasTexture|null=null
  constructor(source:THREE.Object3D,capacity:number,contactShadows=true){
    if(contactShadows && typeof document !== 'undefined'){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64
      const ctx=canvas.getContext('2d')!
      const gradient=ctx.createRadialGradient(32,32,3,32,32,32)
      gradient.addColorStop(0,'rgba(0,0,0,.3)');gradient.addColorStop(1,'rgba(0,0,0,0)')
      ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64)
      this.shadowTexture=new THREE.CanvasTexture(canvas)
      this.shadows=new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2,1.2).rotateX(-Math.PI/2),
        new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),capacity)
      this.shadows.name='people-contact-shadows';this.shadows.frustumCulled=false;this.shadows.count=0;this.group.add(this.shadows)
    }
    source.traverse(o=>{if(!(o instanceof THREE.Mesh))return
      const m=o.material as THREE.MeshStandardMaterial
      if(this.batches.has(m.name))return
      const material=m.clone();material.emissive.copy(material.color);material.emissiveIntensity=.04
      const mesh=new THREE.InstancedMesh(o.geometry,material,capacity*32);mesh.frustumCulled=false;mesh.name=m.name+'-people';mesh.count=0
      this.batches.set(m.name,mesh);this.group.add(mesh)
    })
  }
  update(people:THREE.Object3D[], appearances?: ReadonlyMap<THREE.Object3D, ResidentAppearance>){
    for(const mesh of this.batches.values())mesh.count=0
    if(this.shadows)this.shadows.count=0
    for(const person of people){
      if(!person.visible)continue
      const appearance = appearances?.get(person)
      person.updateMatrixWorld(true)
      if(this.shadows){
        const seated=person.userData.seated ?? (person.getObjectByName('pelvis')?.position.y??1)<.9
        this.matrix.copy(person.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(0,seated?.252:-.016,seated?.43:0))
        this.shadows.setMatrixAt(this.shadows.count++,this.matrix)
      }
      person.traverse(o=>{if(!(o instanceof THREE.Mesh)||!o.visible)return
        const mesh=this.batches.get((o.material as THREE.Material).name)!
        const name=(o.material as THREE.Material).name
        const tint=name==='resident_cloth'?appearance?.cloth:name==='resident_trousers'?appearance?.trousers:undefined
        if(tint||mesh.instanceColor)mesh.setColorAt(mesh.count,tint??untinted)
        this.matrix.copy(o.matrixWorld);mesh.setMatrixAt(mesh.count++,this.matrix)
      })
    }
    for(const mesh of this.batches.values()){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true}
    if(this.shadows)this.shadows.instanceMatrix.needsUpdate=true
  }
  dispose(){for(const m of this.batches.values()){m.dispose();(m.material as THREE.Material).dispose()}this.shadows?.geometry.dispose();if(this.shadows){this.shadows.dispose();(this.shadows.material as THREE.Material).dispose()}this.shadowTexture?.dispose();this.group.removeFromParent()}
}
