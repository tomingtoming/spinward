import type {BlockSpec,BlockVolume} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBuildingSeed} from './colonyBuildingUse'
import {colonyGroundHeight} from './colonyBuildingFrontage'
import {colonyWindowGrid} from './colonyBuildingPlan'

export const BALCONY_BUILDING_LIMIT=8
export const BALCONY_SECTION_LIMIT=144
type Section={volume:BlockVolume;row:number;first:number;last:number;pitch:number;x:number;y:number;z:number;width:number;depth:number}
export type ColonyBalconyPlan={style:'solid'|'rail';sections:Section[];dividers:BlockVolume[]}
export type BalconyWindowRange=readonly [number,number,number,number]
export const NO_BALCONY_WINDOWS:BalconyWindowRange=[-1,-1,-1,-1]

/** Compact per-volume window mask. Current massing creates rectangular runs;
 * a future disconnected plan retains waist windows rather than inventing doors. */
export function colonyBalconyWindowRange(plan:ColonyBalconyPlan,volume:BlockVolume):BalconyWindowRange{
 const parts=plan.sections.filter(s=>s.volume===volume);if(!parts.length)return NO_BALCONY_WINDOWS
 const first=Math.min(...parts.map(s=>s.first)),last=Math.max(...parts.map(s=>s.last)),bottom=Math.min(...parts.map(s=>s.row)),top=Math.max(...parts.map(s=>s.row))
 return parts.reduce((n,s)=>n+s.last-s.first+1,0)===(last-first+1)*(top-bottom+1)?[first,last,bottom,top]:NO_BALCONY_WINDOWS
}
export function colonyWindowPane(profile:{paneBottom:number;paneHeight:number},range:BalconyWindowRange,front:boolean,row:number,column:number){
 const balcony=front&&column>=range[0]&&column<=range[1]&&row>=range[2]&&row<=range[3]
 return {bottom:balcony?.04:profile.paneBottom,height:profile.paneHeight+(balcony?profile.paneBottom-.04:0)}
}

/** Dwelling bays follow the same grid as the upper glazing, including retail podiums. */
export function colonyBalconies(spec:BlockSpec,design:ReturnType<typeof colonyBuildingDesign>):ColonyBalconyPlan{
 const empty:ColonyBalconyPlan={style:'solid',sections:[],dividers:[]}
 if(design.use.primary!=='apartments'||spec.id.startsWith('public-'))return empty
 const seed=colonyBuildingSeed(spec.building),depth=[.95,1.05,1.15][(seed>>>4)%3],rows:Section[][]=[]
 for(const volume of spec.volumes){
  const ground=colonyGroundHeight(volume,design),upper=volume.h-ground
  if(volume.w<2||upper<2.5)continue
  const grid=colonyWindowGrid({...volume,h:upper},design.profile),pitch=volume.w/grid.columnsX
  for(let row=0;row<grid.floors;row++){
   const y=volume.y-volume.h/2+ground+row*upper/grid.floors,z=volume.z+volume.d/2-.04
   if(y<3.4)continue // Keep the lobby portal and its canopy below the first deck.
   const bays:Section[]=[]
   for(let col=0;col<grid.columnsX;col++){
    const x=volume.x+(col+.5)*pitch-volume.w/2,width=pitch-.16
    // Check the whole projecting section, including the slab below floor level.
    if(spec.volumes.some(o=>o!==volume&&x+width/2>o.x-o.w/2+.001&&x-width/2<o.x+o.w/2-.001&&z+depth>o.z-o.d/2+.001&&z<o.z+o.d/2-.001&&y+1.08>o.y-o.h/2+.001&&y-.12<o.y+o.h/2-.001))continue
    bays.push({volume,row,first:col,last:col,pitch,x,y,z,width,depth})
   }
   if(bays.length)rows.push(bays)
  }
 }
 // Tall/wide slabs keep a continuous parapet; never cut off half a floor to fit a cap.
 const rail=(seed>>>10)%2===1&&rows.reduce((n,r)=>n+r.length,0)<=BALCONY_SECTION_LIMIT
 const sections:Section[]=[],dividers:BlockVolume[]=[]
 for(const bays of rows){
  const runs:Section[]=[]
  for(const bay of bays){
   const run=runs.at(-1)
   if(!rail&&run&&run.last===bay.first-1){run.last=bay.last;run.width+=bay.pitch;run.x=(run.x*(run.last-run.first)+bay.x)/(run.last-run.first+1)}
   else runs.push({...bay})
  }
  if(sections.length+runs.length>BALCONY_SECTION_LIMIT)break
  sections.push(...runs)
  if(!rail)for(const run of runs)for(let col=run.first+2;col<=run.last;col+=2){
   if(dividers.length>=BALCONY_SECTION_LIMIT)break
   const x=run.volume.x+col*run.pitch-run.volume.w/2
   dividers.push({x,y:run.y+.65,z:run.z+depth*.48,w:.055,h:1.3,d:depth*.91})
  }
 }
 return {style:rail?'rail':'solid',sections,dividers}
}
