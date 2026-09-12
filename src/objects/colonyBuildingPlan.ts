import {colonyBuildingDesign,COLONY_FACADES,type ColonyFacade} from './colonyBuildingDesign'
import {colonyBuildingSeed} from './colonyBuildingUse'
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
  const building=b,design=colonyBuildingDesign(b,interior?.kind)
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
  }else if((b.kind==='slab'||b.kind==='setback')&&(b.oldTown??0)<.5&&h>=24&&Math.min(w,d)>=16){
    // A shared three-volume recipe for Blender instances, roof anchors,
    // collisions and the far shell bake. Lot bounds and maximum height stay
    // authoritative; no new plan randomness or extra structural instances.
    const seed=colonyBuildingSeed(b),variant=(seed>>>22)%3,side=(seed>>>27)%2?1:-1
    const storey=design.profile.storey
    const base=Math.min(h*.45,Math.max(storey*2,Math.ceil((design.use.groundHeight+2)/storey)*storey))
    const lower=(ratio:number)=>base+Math.max(storey,Math.floor((h-base)*ratio/storey)*storey)
    box(0,base/2,0,w,base,d)
    if(variant===0){
      // Offset terraces: the top is supported by the middle floor plate.
      const middleTop=lower(.62+((seed>>>18)%3)*.06)
      const mw=w*.84,md=d*.82,tw=w*(.56+((seed>>>12)%3)*.05),td=d*.62
      box(side*w*.035,(base+middleTop)/2,-d*.06,mw,middleTop-base,md)
      box(side*w*.075,(middleTop+h)/2,-d*.10,tw,h-middleTop,td)
    }else if(design.use.primary==='apartments'){
      // Two connected residential wings form a long bar, with a lower end
      // instead of a full-height U on every broad parcel. Keep habitable depth.
      const alongX=w>=d,long=Math.max(w,d)*.9,short=Math.min(w,d)
      const depth=Math.max(7,Math.min(18,short*(.48+variant*.06)))
      const tallLength=long*(.58+((seed>>>15)%3)*.06),shortLength=long-tallLength
      const low=lower(.60+((seed>>>19)%3)*.07)
      const wing=(u:number,y:number,length:number,height:number)=>
        box(alongX?u:-short*.09,y,alongX?-short*.09:u,alongX?length:depth,height,alongX?depth:length)
      wing(-side*shortLength/2,(base+h)/2,tallLength,h-base)
      wing(side*tallLength/2,(base+low)/2,shortLength,low-base)
    }else{
      // A compact office/commercial shaft and a lower connected wing. The
      // broad podium still owns the certified entrance and any retail floors.
      const tw=Math.min(w*.64,Math.max(10,Math.min(32,w*.56),h*.2))
      const td=Math.min(d*.78,Math.max(9,Math.min(26,d*.7),h*.18))
      const lw=w*.84-tw,low=lower(.44+((seed>>>17)%3)*.08)
      box(-side*(w*.42-tw/2),(base+h)/2,-d*.06,tw,h-base,td)
      box(side*(w*.42-lw/2),(base+low)/2,-d*.06,lw,low-base,d*.82)
    }
  }else if(b.kind==='tower'||b.kind==='setback'){
    const base=Math.max(h*.24,Math.min(h*.6,design.use.groundHeight>0?design.use.groundHeight+2:0))
    const middle=h*.8-base
    box(0,base/2,0,w,base,d)
    box(0,base+middle/2,-d*.09,w*.72,middle,d*.76)
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
  const wall=design.wall
  return {id,building,volumes,wall,roof:b.industrial?'596768':'727b70'}
}

export function colonyWindowGrid(v:BlockVolume,profile:ColonyFacade=COLONY_FACADES[0]){return {columnsX:Math.max(1,Math.round(v.w/profile.bay)),columnsZ:Math.max(1,Math.round(v.d/profile.bay)),floors:Math.max(1,Math.round(v.h/profile.storey))}}
