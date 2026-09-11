import * as THREE from 'three'
import { loadResidentModel, poseResident, placeResident, ResidentBatches } from './residentModel'
import type { RoomSeat } from '../app/roomSeating'
/** Body lives in the room's frame, so head pitch does not swing the knees. */
export class PlayerBodyView {
 readonly group=new THREE.Group()
 readonly hand=new THREE.Group()
 private root:THREE.Object3D|null=null
 private batches:ResidentBatches|null=null
 private requested=false
 private disposed=false
 constructor(parent:THREE.Group){this.group.name='seated-player-body';parent.add(this.group);this.hand.name='coffee-grip'}
 dispose(){this.disposed=true;this.batches?.dispose();this.group.removeFromParent();this.hand.removeFromParent()}
 update(seat:RoomSeat|null,enabled:boolean,holding:boolean){
  if(enabled&&(seat||holding)&&!this.requested){
   this.requested=true
   loadResidentModel().then(asset=>{
    if(this.disposed)return
    this.root=asset.getObjectByName('resident')!.clone(true)
    this.root.traverse(o=>{if(o instanceof THREE.Mesh&&!/thigh|calf|shoe/.test(o.name))o.visible=false})
    this.batches=new ResidentBatches(this.root,1);this.group.add(this.batches.group)
    const source=asset.getObjectByName('cup_hand');if(source)this.hand.add(source.clone(true))
   }).catch(()=>console.warn('Body detail unavailable.'))
  }
  this.group.visible=enabled&&!!seat;this.hand.visible=enabled&&holding
  if(this.root&&seat&&this.group.visible){
   const heading=Math.atan2(Math.atan2(Math.sin(seat.exit.azimuth-seat.azimuth),Math.cos(seat.exit.azimuth-seat.azimuth))*seat.radius,seat.exit.axialPosition-seat.axialPosition)
   placeResident(this.root,seat.azimuth,seat.axialPosition,seat.radius,heading,0)
   poseResident(this.root,0,false,true);this.batches?.update([this.root])
  }
 }
}
