import { MathUtils } from 'three'
import type { BuildingInterior } from './buildingInteriors'
import { interiorDistance } from './buildingInteriors'
import { wrapBuildingAngleToPi } from './buildingLod'

export type RoomEnvironment = { cafe: number; lobby: number; shelter: number }

// Audio follows the physical room, not whether its optional GLB has loaded.
// Only actual doorways leak the room tone a short distance onto the street.
export function roomPresence(interior: BuildingInterior, radius: number, azimuth: number, axial: number, altitude: number) {
  const b=interior.building,front=b.front!
  const tangent=wrapBuildingAngleToPi(azimuth-b.azimuth)*radius,along=axial-b.axial
  const x=front.axis==='tangent'?front.side*along:-front.side*tangent
  const z=front.axis==='tangent'?front.side*tangent:front.side*along
  const w=interior.frontage,d=interior.depth
  if(altitude<-.1 || altitude>=4.2 || Math.abs(x)>=w/2-.15) return 0
  if(z>d/2 && Math.abs(x)>1.6) return 0
  if(z<-d/2 && (interior.kind!=='passage'||Math.abs(x)>1.6)) return 0
  const frontFade=1-MathUtils.smoothstep(z,d/2-1.5,d/2+1)
  const backFade=interior.kind==='passage'
    ? MathUtils.smoothstep(z,-d/2-1,-d/2+1.5)
    : MathUtils.smoothstep(z,-d/2+.15,-d/2+.5)
  const sides=1-MathUtils.smoothstep(Math.abs(x),w/2-.65,w/2-.15)
  return frontFade*backFade*sides*(1-MathUtils.smoothstep(altitude,3.4,4.2))
}

export function roomDressingOpacity(interior: BuildingInterior,radius:number,azimuth:number,axial:number,altitude:number) {
  if(altitude<-.1)return 0
  return (1-MathUtils.smoothstep(interiorDistance(interior,radius,azimuth,axial,altitude),12,22)) *
    (1-MathUtils.smoothstep(altitude,4.5,6.5))
}
