import type {InteriorKind} from './buildingInteriors'
import {colonyBuildingUse,colonyBuildingSeed} from './colonyBuildingUse'
import {colonyWindowAppearance} from './colonyWindowAppearance'
import type {CityBuilding} from './cityLayout'
export type ColonyFacade={bay:number;storey:number;paneWidth:number;paneHeight:number;paneBottom:number}
export const COLONY_FACADES:readonly ColonyFacade[]=[
 {bay:2.8,storey:3.2,paneWidth:.64,paneHeight:.6,paneBottom:.2},
 {bay:1.8,storey:3.6,paneWidth:.78,paneHeight:.78,paneBottom:.11},
 {bay:4.5,storey:4.2,paneWidth:.76,paneHeight:.28,paneBottom:.55},
 {bay:2.6,storey:3.1,paneWidth:.44,paneHeight:.68,paneBottom:.16},
 {bay:4.2,storey:4.2,paneWidth:.84,paneHeight:.72,paneBottom:.14},
]
const PALETTES=[
 ['ded8c9','a4b1ae','c9b098','9fa9b0','b6a697','c6c9bd'],
 ['b8c7cc','889ea9','d0cfbf','a3b9b4','b5a49a','d7dbd9'],
 ['9ba9a5','b9ab97','7f999f','b9beab','a7aeb7','b99c87'],
 ['c4a98c','ad8672','d9c6a1','abb8b2','c4beb0','a4abb6'],
 ['c6baac','8b9da0','d1c6b1','a8b5a9','b49c8b','bfc3c4'],
]
const TRIMS=['e0dfd6','5c686a','81786a','455b61']
/** Stable per-building grammar: coherent within a facade, varied between neighbouring lots. */
export function colonyBuildingDesign(b:CityBuilding,interior?:InteriorKind){
 const seed=colonyBuildingSeed(b),use=colonyBuildingUse(b)
 // Existing enterable rooms are authoritative about their ground-floor use.
 if(interior){
  use.ground=interior==='cafe'?'retail':interior==='apartment'?'residential':'lobby'
  use.groundHeight=interior==='apartment'?0:4.2
  if(interior==='apartment')use.primary='apartments'
  use.mixed=use.ground==='retail'&&use.primary!=='commercial'
 }
 const style=use.primary==='industrial'?2:use.primary==='office'?1:use.primary==='commercial'?4:(b.oldTown??0)>.5?3:0
 const base=COLONY_FACADES[style]
 const residential=use.primary==='apartments'||use.primary==='house',office=use.primary==='office',officeFull=office&&(seed>>>14)%2===0
 const paneHeight=residential?[.38,.42,.46,.48][(seed>>>8)%4]:office?(officeFull?[.76,.80,.84,.86]:[.42,.46,.5,.54])[(seed>>>8)%4]:Math.min(.86,Math.max(.22,base.paneHeight+[-.1,-.03,.04,.08][(seed>>>8)%4]))
 const paneBottom=residential?[.30,.32,.34][(seed>>>10)%3]:office?(officeFull?.04:.28):style===2?Math.min(.55,1-paneHeight-.08):(1-paneHeight)/2
 const profile={bay:base.bay*[.82,1,1.18,1.34][seed%4],storey:base.storey*[.94,1,1.08][(seed>>>3)%3],paneWidth:Math.min(.86,Math.max(.36,base.paneWidth+[-.14,-.04,.04,.1][(seed>>>6)%4])),paneHeight,paneBottom}
 return {use,style,profile,windows:colonyWindowAppearance(use.primary,seed),wall:PALETTES[style][(seed>>>12)%6],trim:TRIMS[(seed>>>16)%4],seed:(seed%65536)/65536,band:style===1?.94:[.78,.86,.94][(seed>>>20)%3]}
}
