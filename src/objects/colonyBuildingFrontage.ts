import type {BlockVolume} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'

/** Only a tall ground-bearing mass gets the lower-floor frontage. Upper masses retain their rhythm. */
export function colonyGroundHeight(v:BlockVolume,design:ReturnType<typeof colonyBuildingDesign>){
  return v.y-v.h/2<.01&&v.h>=design.use.groundHeight+2?design.use.groundHeight:0
}

/** Keep the central certified approach for the upstairs entrance; shops have separate doors. */
export function colonyShopBays(v:BlockVolume){
  const count=Math.max(1,Math.round(v.w/4.5)),pitch=v.w/count
  return Array.from({length:count},(_,i)=>({x:v.x+(i+.5)*pitch-v.w/2,width:pitch*.82,index:i}))
    .filter(b=>Math.abs(b.x-v.x)>1.1+b.width/2)
}
