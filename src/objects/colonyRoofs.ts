import type {BlockSpec,BlockVolume} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBuildingSeed} from './colonyBuildingUse'

export const ROOF_BUILDING_LIMIT=24
export const ROOF_DETAIL_LIMIT=8
export const ROOF_UNIT_LIMIT=6
export type RoofUnit=BlockVolume&{kind:'roof_hvac'|'roof_vent';yaw:number;tint:number}
type Design=ReturnType<typeof colonyBuildingDesign>

/** Pick the same highest/largest roof used by the beacon anchor. Public rooms
 * and the authored pilot retain their own roofs. No equipment spans a courtyard. */
export function colonyRoofSurface(spec:BlockSpec):BlockVolume|null{
 if(spec.id.startsWith('public-')||spec.building.kind==='house'||spec.building.height<8)return null
 const roof=spec.volumes.reduce((a,b)=>b.y+b.h/2>a.y+a.h/2+1e-5||(Math.abs(b.y+b.h/2-a.y-a.h/2)<1e-5&&b.w*b.d>a.w*a.d)?b:a)
 return roof.w>=6&&roof.d>=5?roof:null
}

/** Physical-size services, ordered into banks with a clear central maintenance
 * aisle. The beacon centre and roof perimeter stay clear at every detail level. */
export function colonyRoofUnits(spec:BlockSpec,design:Design):RoofUnit[]{
 const roof=colonyRoofSurface(spec);if(!roof)return []
 const seed=colonyBuildingSeed(spec.building),use=design.use.primary,units:RoofUnit[]=[]
 const industrial=use==='industrial',residential=use==='apartments'
 const count=industrial?4+seed%3:residential?1+seed%2:3+seed%3
 const scale=(residential?.75:industrial?1.1:1)*[.9,1,1.1][(seed>>>4)%3]
 const yaw=(seed>>>9)%2?Math.PI/2:0,swap=yaw!==0,top=roof.y+roof.h/2
 const candidates=[[-1,-1],[1,-1],[-1,1],[1,1],[-1,0],[1,0]]
 for(let i=0;i<candidates.length&&units.length<count;i++){
  const kind=industrial&&i%2===0?'roof_vent':'roof_hvac'
  const w=(kind==='roof_hvac'?2.4:.8)*scale,h=(kind==='roof_hvac'?1.2:1.4)*scale,d=(kind==='roof_hvac'?1.5:.8)*scale
  const width=swap?d:w,depth=swap?w:d,[sx,sz]=candidates[(i+(seed>>>12)%4)%candidates.length]
  const x=roof.x+sx*(roof.w/2-1.1-width/2),z=roof.z+sz*(roof.d/2-1.1-depth/2)
  if(Math.abs(x-roof.x)+width/2>roof.w/2-1||Math.abs(z-roof.z)+depth/2>roof.d/2-1)continue
  // Always preserve the centre for the existing roof-mounted light, including
  // buildings below today's beacon selection cutoff.
  if(Math.abs(x-roof.x)<width/2+1.1&&Math.abs(z-roof.z)<depth/2+1.1)continue
  if(units.some(u=>Math.abs(x-u.x)<(width+(u.yaw?u.d:u.w))/2+.8&&Math.abs(z-u.z)<(depth+(u.yaw?u.w:u.d))/2+.8))continue
  units.push({kind,x,y:top,z,w,h,d,yaw,tint:(seed>>>16)%4})
 }
 return units
}

/** Camera distances are to the roof, not the ground footprint of a tower. */
export function colonyRoofLod(distance:number,previous:0|1|2):0|1|2{
 if(distance>(previous<2?260:240))return 2
 return distance<(previous===0?84:70)?0:1
}
