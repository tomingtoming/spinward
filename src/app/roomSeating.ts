import * as THREE from 'three'
import { CAFE_PILOT, LOBBY_PILOT, matchesAuthoredPilot, cafePilotPoint } from '../objects/cafePilot'
import type { BuildingInterior } from '../objects/buildingInteriors'
import { resetPlayerToGrounded, type PlayerTraversalState } from './playerTraversal'

export type RoomSeat = {
  id: string; label: string; radius: number
  azimuth: number; axialPosition: number
  // Absolute cushion height above the cylinder floor; room benches use 0.6m.
  seatHeight?: number
  // Physical surface at the seat/exit, separate from the cushion's absolute height.
  groundHeight?: number
  exit: { azimuth: number; axialPosition: number }
}
type SeatFrame = { radius: number; frameAngle: number; omega: number }
const distance = (a: { azimuth: number; axialPosition: number }, b: { azimuth: number; axialPosition: number }, radius: number) =>
  Math.hypot(Math.atan2(Math.sin(a.azimuth-b.azimuth),Math.cos(a.azimuth-b.azimuth))*radius,a.axialPosition-b.axialPosition)

// Only certified benches in the two authored pilot rooms. Their aisle anchors
// remain outside every solid furnishing; neither asset loading nor LOD owns them.
export function planRoomSeats(interiors: Iterable<BuildingInterior>, radius: number): RoomSeat[] {
  const result: RoomSeat[]=[]
  for(const i of interiors)for(const spec of [CAFE_PILOT,LOBBY_PILOT]) {
    if(!matchesAuthoredPilot(i,radius,spec))continue
    const point=(x:number,z:number)=>{
      const p=cafePilotPoint(i,radius,new THREE.Vector3(x,0,z))
      return {azimuth:Math.atan2(p.z,p.x),axialPosition:p.y}
    }
    for(const side of [-1,1]) {
      const x=side*(i.frontage/2-1.4)
      result.push({id:`${spec.id}-${side}`,label:spec.id==='cafe'?'Cafe bench':'Lobby bench',radius,
        ...point(x-side*.38,-.1),exit:point(x-side*1.45,-.1)})
    }
  }
  return result
}
export function nearestRoomSeat(seats: readonly RoomSeat[], state: PlayerTraversalState, radius: number) {
  if(state.mode!=='grounded')return null
  let best:RoomSeat|null=null,bestDistance=1.25
  for(const seat of seats) {
    if(seat.radius!==radius||Math.abs(state.groundHeight-(seat.groundHeight??0))>.2)continue
    const d=distance(state.surface,seat.exit,radius)
    if(d<bestDistance){best=seat;bestDistance=d}
  }
  return best
}

export class RoomSeating {
  private departure = 0
  private supportHeight = .6
  get eyeHeight() { return this.supportHeight + .7 }
  get standingProgress(){return 1-this.departure/.3}
  stepDeparture(dt:number){this.departure=Math.max(0,this.departure-dt);return this.departure>0}
  private active: {seat:RoomSeat;state:PlayerTraversalState}|null=null
  get seat(){return this.active?.seat??null}
  enter(seat:RoomSeat,state:PlayerTraversalState,frame:SeatFrame){
    if(this.active||nearestRoomSeat([seat],state,frame.radius)!==seat)return false
    this.supportHeight=(seat.seatHeight??.6)-(seat.groundHeight??0)
    this.departure=0;this.active={seat,state};this.setSensor(state,true);this.pin(state,frame);return true
  }
  // Keep the anchor in the rotating habitat, not in inertial world space.
  // The standing sphere becomes a sensor while attached to avoid impulses
  // against the bench. It stays in the broad phase throughout the attachment;
  // leaving restores contact response before normal walking resumes.
  private setSensor(state:PlayerTraversalState,sensor:boolean){
    const body=state.physics?.freeFlyBody
    if(body)for(let i=0;i<body.numColliders();i++)body.collider(i).setSensor(sensor)
  }
  private pin(state:PlayerTraversalState,frame:SeatFrame){
    resetPlayerToGrounded(state,{...this.active!.seat,...frame,groundHeight:this.active!.seat.groundHeight??0})
  }
  update(state:PlayerTraversalState,frame:SeatFrame,seats:readonly RoomSeat[]){
    if(!this.active)return
    const a=this.active
    if(state!==a.state){this.active=null;return} // Previous body was disposed by a rebuild.
    if(frame.radius!==a.seat.radius||Math.abs(state.groundHeight-(a.seat.groundHeight??0))>.2||state.mode!=='grounded'||distance(state.surface,a.seat,frame.radius)>.03){
      this.setSensor(state,false);this.active=null;return
    }
    if(!seats.includes(a.seat)){this.leave(state,frame);return}
    this.pin(state,frame)
  }
  leave(state:PlayerTraversalState,frame:SeatFrame){
    if(!this.active)return false
    const a=this.active;this.active=null;this.departure=.3
    if(a.state===state){this.setSensor(state,false);resetPlayerToGrounded(state,{...a.seat.exit,...frame,groundHeight:a.seat.groundHeight??0})}
    return true
  }
}
