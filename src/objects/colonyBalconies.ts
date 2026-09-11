import type {BlockSpec,BlockVolume} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBuildingSeed} from './colonyBuildingUse'
import {colonyGroundHeight} from './colonyBuildingFrontage'
import {colonyWindowGrid} from './colonyBuildingPlan'

export const BALCONY_BUILDING_LIMIT=8
export const BALCONY_SECTION_LIMIT=144
type Section={volume:BlockVolume;row:number;first:number;last:number;pitch:number;x:number;y:number;z:number;width:number;depth:number}
export type ColonyBalconyPlan={style:'solid'|'rail';sections:Section[];dividers:BlockVolume[]}

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
