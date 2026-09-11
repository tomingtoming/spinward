import type {CityBuilding} from './cityLayout'
export type ColonyFacade={bay:number;storey:number;paneWidth:number;paneHeight:number;paneBottom:number}
export const COLONY_FACADES:readonly ColonyFacade[]=[
 {bay:2.8,storey:3.2,paneWidth:.64,paneHeight:.6,paneBottom:.2},
 {bay:1.8,storey:3.6,paneWidth:.78,paneHeight:.78,paneBottom:.11},
 {bay:4.5,storey:4.2,paneWidth:.76,paneHeight:.28,paneBottom:.55},
 {bay:2.6,storey:3.1,paneWidth:.44,paneHeight:.68,paneBottom:.16},
]
const PALETTES=[
 ['ded8c9','a4b1ae','c9b098','9fa9b0','b6a697','c6c9bd'],
 ['b8c7cc','889ea9','d0cfbf','a3b9b4','b5a49a','d7dbd9'],
 ['9ba9a5','b9ab97','7f999f','b9beab','a7aeb7','b99c87'],
 ['c4a98c','ad8672','d9c6a1','abb8b2','c4beb0','a4abb6'],
]
const TRIMS=['e0dfd6','5c686a','81786a','455b61']
/** Stable per-building grammar: coherent within a facade, varied between neighbouring lots. */
export function colonyBuildingDesign(b:CityBuilding){
 let seed=(Math.round(b.azimuth*1e6)^Math.imul(Math.round(b.axial*100),0x45d9f3b))>>>0
 seed=Math.imul(seed^(seed>>>16),0x45d9f3b)>>>0;seed=(seed^(seed>>>16))>>>0
 const style=b.industrial?2:(b.oldTown??0)>.5?3:b.kind==='tower'||((b.urban??0)>.7&&b.kind==='setback')?1:0
 const base=COLONY_FACADES[style]
 const paneHeight=Math.min(.86,Math.max(.22,base.paneHeight+[-.1,-.03,.04,.08][(seed>>>8)%4]))
 const profile={bay:base.bay*[.82,1,1.18,1.34][seed%4],storey:base.storey*[.94,1,1.08][(seed>>>3)%3],paneWidth:Math.min(.86,Math.max(.36,base.paneWidth+[-.14,-.04,.04,.1][(seed>>>6)%4])),paneHeight,paneBottom:style===2?Math.min(.55,1-paneHeight-.08):(1-paneHeight)/2}
 return {style,profile,wall:PALETTES[style][(seed>>>12)%6],trim:TRIMS[(seed>>>16)%4],seed:(seed%65536)/65536,band:style===1?.94:[.78,.86,.94][(seed>>>20)%3]}
}
