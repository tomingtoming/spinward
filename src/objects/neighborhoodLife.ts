import * as THREE from 'three'
import type { Cityscape } from './cityscape'
import { type CityPlan, type CityRoad } from './cityLayout'
import { planBuildingInteriors } from './buildingInteriors'
import { loadResidentModel, poseResident, placeResident, ResidentBatches } from './residentModel'
import type { CrossingGate } from './trafficMotion'
import { getStreetProfile } from './streetProfile'
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
 private phase:'rest'|'waiting'|'crossing'='rest'
 private across=-1
 private startSide=-1
 private walker:THREE.Object3D|null=null
 private visible=false
 private failed=false
 private disposed=false
 private readonly enabled=new URLSearchParams(window.location.search).get('people')!=='0'
 constructor(parent:THREE.Group,private city:Cityscape){this.group.name='neighborhood-life';parent.add(this.group);this.group.add(this.paint)}
 private rebuild(plan:CityPlan,radius:number){
  this.plan=plan;this.radius=radius;this.actors=[];this.clock=0;this.waiting=0;this.rest=0;this.phase='rest';this.across=-1;this.startSide=-1
  this.paint.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}});this.paint.clear()
  this.crossing=planLifeCrossing(plan,radius)
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
   if(seat.id.endsWith('--1'))continue
   const dx=wrap(seat.exit.azimuth-seat.azimuth)*this.radius,dy=seat.exit.axialPosition-seat.axialPosition
   const heading=Math.atan2(dx,dy),azimuth=seat.azimuth,axial=seat.axialPosition
   const root=this.source!.clone(true);root.name='neighbour-'+seat.id
   this.actors.push({seatId:seat.id,root,azimuth,axial,heading,seated:true,phase:this.actors.length*2.3})
  }
  this.walker=this.crossing?this.source!.clone(true):null
  if(this.walker)this.walker.name='crossing-neighbour'
  this.batches?.dispose();this.batches=new ResidentBatches(this.source!,4);this.group.add(this.batches.group)
 }
 isSeatOccupied(id:string){return !!this.source&&this.actors.some(a=>a.seatId===id)&&id!==this.playerSeat}
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
   loadResidentModel().then(asset=>{if(this.disposed)return;this.source=asset.getObjectByName('resident')!;this.mount()}).catch(()=>console.warn('Neighbour models unavailable; streets remain passable.'))
  }
  if(!this.visible&&this.crossing){
   this.phase='rest';this.rest=0;this.across=Math.sign(this.across)||1;this.crossing.closed=false
  }
  if(!this.group.visible||!this.source){this.city.setCrossingGate(null);return}
  this.clock+=Math.min(.1,dt)
  const roots:THREE.Object3D[]=[]
  for(const a of this.actors){
   a.root.visible=a.seatId!==this.playerSeat&&focus.altitude<7&&Math.hypot(wrap(a.azimuth-focus.azimuth)*this.radius,a.axial-focus.axial)<65
   placeResident(a.root,a.azimuth,a.axial,this.radius,a.heading,0)
   poseResident(a.root,this.clock,false,true,a.phase);roots.push(a.root)
  }
  if(c&&this.walker&&this.visible){
   const reach=c.halfWidth+Math.min(.75,getStreetProfile(c.road.kind,this.radius).sidewalk/2)
   if(this.phase==='rest')this.rest+=dt
   if(this.phase==='rest'&&this.rest>7){this.phase='waiting';this.waiting=0}
   c.closed=this.phase!=='rest'
   if(this.phase==='waiting'){
    this.waiting+=dt
    const traffic=this.city.getTrafficPositions().filter(v=>v.height<1)
    if(car)traffic.push({...car,height:0})
    const clear=traffic.every(v=>{
     const t=wrap(v.azimuth-c.azimuth)*this.radius,a=v.axial-c.axial
     const along=c.axis==='axial'?a:t,across=c.axis==='axial'?t:a
     return Math.abs(across)>c.halfWidth+2||Math.abs(along)>4+Math.abs(v.speed)*2.2
    })
    if(this.waiting>1.5&&clear){this.phase='crossing';this.startSide=this.across}
   }
   let walking=this.phase==='crossing'
   // A player-driven car is physical: pause instead of making the resident
   // walk through it. Traffic remains held until the pedestrian clears.
   if(walking&&car&&Math.hypot(wrap(car.azimuth-c.azimuth)*this.radius,car.axial-c.axial)<7)walking=false
   if(walking){
    this.across-=this.startSide*Math.min(.1,dt)*1.1/reach
    if(Math.abs(this.across)>=1&&Math.sign(this.across)!==this.startSide){this.across=-this.startSide;this.phase='rest';this.rest=0;c.closed=false}
   }
   const heading=c.axis==='axial'?-this.startSide*Math.PI/2:(this.startSide===1?Math.PI:0)
   placeResident(this.walker,c.azimuth+(c.axis==='axial'?this.across*reach/this.radius:0),c.axial+(c.axis==='tangent'?this.across*reach:0),this.radius,heading,.22+.12*THREE.MathUtils.smoothstep(Math.abs(this.across)*reach,c.halfWidth-.15,c.halfWidth+.25))
   poseResident(this.walker,this.clock,walking,false);this.walker.visible=true;roots.push(this.walker)
  }else if(c)c.closed=false
  this.paint.visible=this.visible
  this.city.setCrossingGate(c)
  this.batches?.update(roots)
  this.group.userData={people:roots.filter(r=>r.visible).length,phase:this.phase,across:this.across,crossing:c,asset:!!this.source}
 }
 dispose(){
  this.disposed=true;this.city.setCrossingGate(null);this.batches?.dispose()
  this.paint.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}})
  this.group.removeFromParent()
 }
 private configuredRadius=3200
 setRadius(radius:number){this.configuredRadius=radius}
}
