import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { COFFEE_SERVICE, type CoffeeStation, type CoffeeService } from '../app/coffeeService'
import { cafePilotPoint } from './cafePilot'

export function coffeeLiquidPose(fraction:number) {
  const height=.023+.07*THREE.MathUtils.clamp(fraction,0,1)
  // The inner ceramic wall narrows toward the base; keep every fill inside it.
  return {height,scale:Math.min(1,(.033+(height-.013)/.09*.008-.001)/.039)}
}

// Two instances share the small Blender asset. The station lives in the rotating
// city frame; the carried cup lives in camera space, with no physics attachment.
export class CoffeeServiceView {
  readonly counter = new THREE.Group()
  readonly held = new THREE.Group()
  private counterCup = new THREE.Group()
  private asset: THREE.Group | null = null
  private liquids: THREE.Object3D[] = []
  private requested=false
  private disposed=false
  private station:CoffeeStation|null=null
  constructor(parent:THREE.Group,private camera:THREE.PerspectiveCamera){
    this.counter.name='coffee-counter';this.held.name='coffee-held';this.counterCup.name='coffee-counter-cup'
    parent.add(this.counter);camera.add(this.held);this.counter.add(this.counterCup)
    this.counter.visible=false;this.held.visible=false
    // A load failure still gives the player a visible cup rather than invisible inventory.
    const ceramic=new THREE.MeshStandardMaterial({color:0xe3d9c3,roughness:.5})
    const fallback=new THREE.Mesh(new THREE.CylinderGeometry(.045,.036,.11,20),ceramic);fallback.position.y=.055
    this.held.add(fallback);this.counterCup.add(fallback.clone())
  }
  private load(){
    if(this.requested)return;this.requested=true
    new GLTFLoader().load('/assets/buildings/coffee-service.glb',gltf=>{
      if(this.disposed){this.release(gltf.scene);return}
      const grip=this.held.getObjectByName('coffee-grip');grip?.removeFromParent()
      this.release(this.held);this.held.clear();this.counterCup.clear();this.asset=gltf.scene
      for(const target of [this.counterCup,this.held]){
        for(const name of ['coffee_mug','coffee_liquid']){
          const source=gltf.scene.getObjectByName(name)
          if(!source)continue
          const o=source.clone(true);o.name=name;target.add(o)
          if(name==='coffee_liquid')this.liquids.push(o)
        }
      }
      if(grip)this.held.add(grip)
      const sign=gltf.scene.getObjectByName('coffee_station_sign');if(sign)this.counter.add(sign.clone(true))
    },undefined,error=>console.warn('Coffee detail unavailable; using simple cup.',error))
  }
  update(service:CoffeeService,station:CoffeeStation|null,visible:boolean,nearRoom:boolean,bottomClearancePx=0){
    if(station!==this.station){
      this.station=station
      if(station){
        const i=station.interior,R=station.radius,p=new THREE.Vector3(COFFEE_SERVICE.counterX,COFFEE_SERVICE.counterHeight,-i.depth/2+COFFEE_SERVICE.cupFromBack)
        const origin=cafePilotPoint(i,R,p.clone())
        const right=cafePilotPoint(i,R,p.clone().add(new THREE.Vector3(.01,0,0))).sub(origin).normalize()
        const up=origin.clone().setY(0).negate().normalize(),front=new THREE.Vector3().crossVectors(right,up).normalize()
        right.crossVectors(up,front).normalize()
        this.counter.position.copy(origin);this.counter.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,front))
      }
    }
    if(station&&nearRoom)this.load()
    this.counter.visible=!!station&&nearRoom
    this.counterCup.visible=service.phase==='brewing'||service.phase==='ready'
    this.held.visible=visible&&service.phase==='holding'
    const sip=Math.sin(service.sipProgress*Math.PI)
    const x=Math.max(.005,Math.min(.23,.48*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*this.camera.aspect-.12))
    const restY=this.camera.aspect<.85
      ? Math.max(-.265,(-1+2*(bottomClearancePx+12)/Math.max(1,window.innerHeight))*.48*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))+.025)
      : -.265
    this.held.position.set(x*(1-sip*.8),restY+sip*.16,-.48+sip*.09)
    this.held.rotation.set(.18+sip*.57,0,-.12*(1-sip))
    this.liquids.forEach((o,index)=>{
      const servings=index===0?COFFEE_SERVICE.servings:service.servings
      o.visible=servings>0
      const fraction=service.phase==='brewing'&&index===0 ? service.elapsed/COFFEE_SERVICE.brewSeconds : servings/COFFEE_SERVICE.servings
      const pose=coffeeLiquidPose(fraction)
      o.scale.set(pose.scale,1,pose.scale);o.position.y=pose.height-.093
    })
    this.held.userData={phase:service.phase,servings:service.servings,sipProgress:service.sipProgress,asset:!!this.asset}
  }
  private release(root:THREE.Object3D){
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>()
    root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())
  }
  dispose(){this.disposed=true;this.release(this.asset??this.held);this.counter.removeFromParent();this.held.removeFromParent()}
}
