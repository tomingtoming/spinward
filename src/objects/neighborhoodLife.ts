import * as THREE from 'three'
import type { Cityscape } from './cityscape'
import { type CityPlan, type CityRoad } from './cityLayout'
import { planBuildingInteriors } from './buildingInteriors'
import { loadResidentModel, poseResident, placeResident, ResidentBatches } from './residentModel'
import type { CrossingGate } from './trafficMotion'
import { planResidentJourney, stepJourney, type ResidentJourney, type JourneyPoint } from './residentJourney'
import { planNeighborhoodTurn } from './neighborhoodTurn'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { cafePilotPoint } from './cafePilot'
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v))
export type LifeCrossing=CrossingGate & { road:CityRoad }
/** Select a real street at a public doorway, away from an intersection. */
export function planLifeCrossing(plan:CityPlan,radius:number):LifeCrossing|null {
 const interiors=[...planBuildingInteriors(plan.buildings,radius).values()].filter(i=>i.kind==='cafe')
 interiors.sort((a,b)=>Math.hypot(a.building.azimuth*radius,a.building.axial)-Math.hypot(b.building.azimuth*radius,b.building.axial))
 for(const i of interiors.slice(0,20)){
  const b=i.building,road=plan.roads[b.access!.roadIndex]
  if(!road||road.kind==='alley')continue
  const axis=road.axialLength>road.tangentWidth?'axial':'tangent'
  const azimuth=axis==='axial'?road.azimuth:b.azimuth,axial=axis==='axial'?b.axial:road.axial
  const width=axis==='axial'?road.tangentWidth:road.axialLength
  if(width>20)continue
  const intersects=plan.roads.some(r=>r!==road && (r.axialLength>r.tangentWidth)!==(axis==='axial') &&
    Math.abs(wrap(r.azimuth-azimuth)*radius)<r.tangentWidth/2+5 && Math.abs(r.axial-axial)<r.axialLength/2+5)
  if(!intersects)return {azimuth,axial,axis,halfWidth:width/2,closed:false,road}
 }
 return null
}
type Actor={seatId:string;root:THREE.Object3D;azimuth:number;axial:number;heading:number;seated:boolean;phase:number}
export class NeighborhoodLife {
 readonly group=new THREE.Group()
 private plan:CityPlan|null=null
 private radius=1
 private actors:Actor[]=[]
 private source:THREE.Object3D|null=null
 private batches:ResidentBatches|null=null
 private crossing:LifeCrossing|null=null
 private paint=new THREE.Group()
 private clock=0
 private waiting=0
 private rest=0
 private phase:'rest'|'walking'|'waiting'|'crossing'|'settling'|'seated'|'rising'='rest'
 private journey:ResidentJourney|null=null
 private position:JourneyPoint|null=null
 private destination=1
 private returning=false
 private heading=0
 private lights:THREE.PointLight[]=[]
 private mug=new THREE.Group()
 private mugAsset:THREE.Object3D|null=null
 private across=-1
  private walker:THREE.Object3D|null=null
 private visible=false
 private failed=false
 private disposed=false
 private readonly enabled=new URLSearchParams(window.location.search).get('people')!=='0'
 constructor(parent:THREE.Group,private city:Cityscape){this.group.name='neighborhood-life';parent.add(this.group);this.group.add(this.paint,this.mug);this.mug.name="resident-coffee";this.mug.visible=false}
 private rebuild(plan:CityPlan,radius:number){
  this.plan=plan;this.radius=radius;this.actors=[];this.clock=0;this.waiting=0;this.rest=0;this.phase='rest';this.across=-1
  this.paint.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}});this.paint.clear()
  this.crossing=planLifeCrossing(plan,radius)
  this.city.setNeighborhoodTurn(this.crossing?planNeighborhoodTurn(plan,radius,this.crossing):null)
  this.journey=this.crossing?planResidentJourney(plan,radius,this.crossing):null
  this.position=this.journey?{...this.journey.points[0]}:null;this.destination=1;this.returning=false
  for(const light of this.lights){light.removeFromParent();light.dispose()}this.lights=[]
  if(this.journey){
   for(const x of [-6,6]){
    const light=new THREE.PointLight(0xffd9ac,28,13,2)
    light.name='cafe-warm-bounce';light.position.copy(cafePilotPoint(this.journey.room,radius,new THREE.Vector3(x,3.1,0)))
    this.group.add(light);this.lights.push(light)
   }
  }
  if(this.crossing){
   const c=this.crossing
   // Paint has its own curved metre coordinates and sits just above the road.
   for(let offset=-c.halfWidth+.45;offset<c.halfWidth;offset+=.85){
    const geom=new THREE.PlaneGeometry(c.axis==='axial'?.45:3,c.axis==='axial'?3:.45)
    const points=geom.getAttribute('position')
    for(let j=0;j<points.count;j++){
      const tx=points.getX(j)+(c.axis==='axial'?offset:0),ax=points.getY(j)+(c.axis==='tangent'?offset:0),a=c.azimuth+tx/radius
      points.setXYZ(j,Math.cos(a)*(radius-.225),c.axial+ax,Math.sin(a)*(radius-.225))
    }
    geom.computeVertexNormals()
    const m=new THREE.MeshStandardMaterial({color:0xd8d6c4,roughness:1,side:THREE.DoubleSide})
    this.paint.add(new THREE.Mesh(geom,m))
   }
  }
  if(this.source)this.mount()
 }
 private mount(){
  this.actors=[]
  // One occupied bench per room. Its seat is excluded from player prompts;
  // the opposite bench remains available. Never squeeze two bodies into the
  // cushion's clearance between its backrest and plant.
  for(const seat of this.city.getRoomSeats()){
   if(seat.id.endsWith('--1')||(this.journey&&seat.id===this.journey.seat.id))continue
   const dx=wrap(seat.exit.azimuth-seat.azimuth)*this.radius,dy=seat.exit.axialPosition-seat.axialPosition
   const heading=Math.atan2(dx,dy),azimuth=seat.azimuth,axial=seat.axialPosition
   const root=this.source!.clone(true);root.name='neighbour-'+seat.id
   this.actors.push({seatId:seat.id,root,azimuth,axial,heading,seated:true,phase:this.actors.length*2.3})
  }
  this.walker=this.crossing?this.source!.clone(true):null
  if(this.walker)this.walker.name='crossing-neighbour'
  this.batches?.dispose();this.batches=new ResidentBatches(this.source!,4);this.group.add(this.batches.group)
 }
 isSeatOccupied(id:string){return !!this.source&&(this.actors.some(a=>a.seatId===id)||this.journey?.seat.id===id)&&id!==this.playerSeat}
 private playerSeat:string|null=null
 setPlayerSeat(id:string|null){this.playerSeat=id}
 update(dt:number,focus:{azimuth:number;axial:number;altitude:number},car:{azimuth:number;axial:number;speed:number}|null){
  if(!this.enabled){this.city.setCrossingGate(null);return}
  const plan=this.city.getCityPlan();if(!plan)return
  // Caller sets radius explicitly because smaller habitat plans may have no seats.
  if(plan!==this.plan)this.rebuild(plan,this.configuredRadius)
  const c=this.crossing
  this.visible=focus.altitude<12 && (c?Math.hypot(wrap(c.azimuth-focus.azimuth)*this.radius,c.axial-focus.axial)<170:false)
  const nearActor=focus.altitude<7 && this.city.getRoomSeats().some(a=>Math.hypot(wrap(a.azimuth-focus.azimuth)*this.radius,a.axialPosition-focus.axial)<65)
  this.group.visible=this.visible||nearActor
  if(this.group.visible&&!this.source&&!this.failed){
   this.failed=true
   loadResidentModel().then(asset=>{if(this.disposed)return;this.source=asset.getObjectByName('resident')!;this.mount();this.loadMug()}).catch(()=>console.warn('Neighbour models unavailable; streets remain passable.'))
  }
  if(!this.visible&&this.crossing){
   this.crossing.closed=false
   if(this.phase==='crossing'){this.phase='waiting';this.waiting=0}
  }
  if(!this.group.visible||!this.source){this.city.setCrossingGate(null);return}
  this.clock+=Math.min(.1,dt)
  const roots:THREE.Object3D[]=[]
  for(const a of this.actors){
   a.root.visible=a.seatId!==this.playerSeat&&focus.altitude<7&&Math.hypot(wrap(a.azimuth-focus.azimuth)*this.radius,a.axial-focus.axial)<65
   placeResident(a.root,a.azimuth,a.axial,this.radius,a.heading,0)
   poseResident(a.root,this.clock,false,true,a.phase);roots.push(a.root)
  }
  if(c&&this.walker&&this.journey&&this.position&&this.visible){
   const j=this.journey,step=Math.min(.1,Math.max(0,dt))
   let walking=false,seated=0
   const seatHeading=Math.atan2(wrap(j.seat.exit.azimuth-j.seat.azimuth)*this.radius,j.seat.exit.axialPosition-j.seat.axialPosition)
   if(this.phase==='rest'){
    this.rest+=step
    if(this.rest>5){this.phase='walking';this.destination=1;this.returning=false}
   }
   if(this.phase==='walking'||this.phase==='crossing'){
    const blocked=car&&Math.hypot(wrap(car.azimuth-this.position.azimuth)*this.radius,car.axial-this.position.axial)<3
    if(!blocked){
     const next=stepJourney(this.position,j.points[this.destination],this.radius,step*1.1)
     this.position=next.point;this.heading=next.heading;walking=!next.arrived
     if(this.phase==='crossing'){
      const distance=c.axis==='tangent'?this.position.axial-c.axial:wrap(this.position.azimuth-c.azimuth)*this.radius
      this.across=distance/(c.halfWidth+.75)
      this.position.height=.22+.12*THREE.MathUtils.smoothstep(Math.abs(distance),c.halfWidth-.15,c.halfWidth+.25)
     }
     if(next.arrived){
      const at=this.destination
      if((!this.returning&&at===1)||(this.returning&&at===2)){this.phase='waiting';this.waiting=0}
      else if(!this.returning&&at===j.points.length-1){this.phase='settling';this.rest=0}
      else if(this.returning&&at===0){this.phase='rest';this.rest=0}
      else {this.phase='walking';this.destination+=this.returning?-1:1}
     }
    }
   }
   if(this.phase==='waiting'){
    this.waiting+=step
    const traffic=this.city.getTrafficPositions().filter(v=>v.height<1)
    if(car)traffic.push({...car,height:0})
    const clear=traffic.every(v=>{
     const t=wrap(v.azimuth-c.azimuth)*this.radius,a=v.axial-c.axial
     return Math.abs(c.axis==='axial'?t:a)>c.halfWidth+2||Math.abs(c.axis==='axial'?a:t)>4+Math.abs(v.speed)*2.2
    })
    if(this.waiting>1.5&&clear){this.phase='crossing';this.destination=this.returning?1:2}
   }
   if(this.phase==='settling'||this.phase==='rising'||this.phase==='seated'){
    this.rest+=step
    seated=this.phase==='seated'?1:THREE.MathUtils.smoothstep(this.rest,0,1.2)
    if(this.phase==='rising')seated=1-seated
    const aisle=j.points[j.points.length-1]
    this.position={azimuth:THREE.MathUtils.lerp(aisle.azimuth,j.seat.azimuth,seated),axial:THREE.MathUtils.lerp(aisle.axial,j.seat.axialPosition,seated),height:.27*(1-seated)}
    this.heading=seatHeading
    if(this.phase==='settling'&&this.rest>=1.2){this.phase='seated';this.rest=0}
    else if(this.phase==='seated'&&this.rest>24){this.phase='rising';this.rest=0}
    else if(this.phase==='rising'&&this.rest>=1.2){this.phase='walking';this.returning=true;this.destination=j.points.length-2}
   }
   c.closed=this.visible&&(this.phase==='waiting'||this.phase==='crossing')
   // When the scene is distant, freeze the resident rather than teleport it.
   placeResident(this.walker,this.position.azimuth,this.position.axial,this.radius,this.heading,this.position.height)
   poseResident(this.walker,this.clock,walking,seated,0,this.phase==='seated');this.walker.visible=true;roots.push(this.walker)
  }else if(c)c.closed=false
  this.mug.visible=!!this.walker&&this.phase==='seated'&&this.visible
  if(this.mug.visible&&this.walker){
   this.walker.updateMatrixWorld(true)
   const hand=this.walker.getObjectByName('right_hand')!
   const p=hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-.035,-.045,.015).applyQuaternion(this.walker.quaternion))
   this.mug.position.copy(p);this.mug.quaternion.copy(this.walker.quaternion)
   this.mug.rotateX(-.18*Math.pow(Math.max(0,Math.sin((this.clock%10)/10*Math.PI*2)),4))
  }
  this.paint.visible=this.visible
  this.city.setCrossingGate(c)
  this.batches?.update(roots)
  this.group.userData={people:roots.filter(r=>r.visible).length,phase:this.phase,across:this.across,position:this.position,destination:this.destination,returning:this.returning,crossing:c,asset:!!this.source}
 }
 private loadMug(){
  if(this.mugAsset)return
  new GLTFLoader().load('/assets/buildings/coffee-service.glb',g=>{
   if(this.disposed){this.releaseMug(g.scene);return}this.mugAsset=g.scene
   for(const name of ['coffee_mug','coffee_liquid']){const o=g.scene.getObjectByName(name);if(o)this.mug.add(o.clone(true))}
  })
 }
 private releaseMug(root:THREE.Object3D){root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})}
 dispose(){
  if(this.mugAsset)this.releaseMug(this.mugAsset)
  this.city.setNeighborhoodTurn(null)
  this.disposed=true;for(const light of this.lights)light.dispose();this.city.setCrossingGate(null);this.batches?.dispose()
  this.paint.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}})
  this.group.removeFromParent()
 }
 private configuredRadius=3200
 setRadius(radius:number){this.configuredRadius=radius}
}
