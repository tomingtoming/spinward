import {colonyBuildingDesign,COLONY_FACADES,type ColonyFacade} from './colonyBuildingDesign'
import type { CityBuilding } from './cityLayout'
import { fitSuburbanHouse } from './buildingAssets'
import type { BuildingInterior } from './buildingInteriors'
import type { BlockSpec, BlockVolume } from './authoredCityBlockPlan'

export function fitColonyHouse(b:CityBuilding){
  const candidate=fitSuburbanHouse(b),parcel=b.parcel
  return candidate&&parcel&&Math.abs(candidate.tangentOffset-parcel.tangentOffset)+candidate.tangentExtent/2<=parcel.tangentExtent/2+1e-6&&Math.abs(candidate.axialOffset-parcel.axialOffset)+candidate.axialExtent/2<=parcel.axialExtent/2+1e-6?candidate:null
}

/** Metric structural recipe shared by rendering, collision and the distant bake. */
export function colonyBuildingSpec(b: CityBuilding, interior?: BuildingInterior): BlockSpec {
  const building=b
  const fit=interior?null:fitColonyHouse(b)
  // Preserve the previously certified garden and entrance, not the retired house mesh.
  const tangent=b.front?.axis==='tangent',side=b.front?.side??-1
  const w=fit?(tangent?fit.axialExtent:fit.tangentExtent):(tangent?b.depth:b.width)
  const d=fit?(tangent?fit.tangentExtent:fit.axialExtent):(tangent?b.width:b.depth)
  const h=fit?Math.min(fit.height,b.height):b.height
  const ox=fit?side*(tangent?fit.axialOffset:-fit.tangentOffset):0
  const oz=fit?side*(tangent?fit.tangentOffset:fit.axialOffset):0
  const volumes:BlockVolume[]=[]
  const box=(x:number,y:number,z:number,width:number,height:number,depth:number)=>volumes.push({x:x+ox,y,z:z+oz,w:width,h:height,d:depth})
  let id:string=b.industrial?'industrial':(b.oldTown??0)>.5?'old-town':b.kind
  if(interior){
    id='public-'+interior.kind
    for(const p of interior.parts)if(p.solid&&p.detail===3)box(p.x,p.y,p.z,p.width,p.height,p.depth)
  }else if(b.industrial){
    box(0,h*.38,0,w,h*.76,d)
    box(0,h*.88,-d*.08,w*.72,h*.24,d*.65)
  }else if(b.kind==='tower'||b.kind==='setback'){
    box(0,h*.12,0,w,h*.24,d)
    box(0,h*.52,-d*.09,w*.72,h*.56,d*.76)
    box(0,h*.9,-d*.12,w*.52,h*.2,d*.58)
  }else if(b.kind==='lshape'&&w>8&&d>8){
    box(0,h*.5,-d*.3,w,h,d*.4)
    box(-w*.3,h*.5,d*.2,w*.4,h,d*.6)
  }else if(b.kind==='slab'&&w>12&&d>12){
    box(0,h*.5,-d*.3,w,h,d*.4)
    box(-w*.35,h*.5,d*.2,w*.3,h,d*.6)
    box(w*.35,h*.5,d*.2,w*.3,h,d*.6)
  }else{
    box(0,h*.45,0,w,h*.9,d)
    box(0,h*.95,-d*.04,w*.84,h*.1,d*.84)
  }
  const wall=colonyBuildingDesign(b).wall
  return {id,building,volumes,wall,roof:b.industrial?'596768':'727b70'}
}

export function colonyWindowGrid(v:BlockVolume,profile:ColonyFacade=COLONY_FACADES[0]){return {columnsX:Math.max(1,Math.round(v.w/profile.bay)),columnsZ:Math.max(1,Math.round(v.d/profile.bay)),floors:Math.max(1,Math.round(v.h/profile.storey))}}
