import {cityBlockCollision,type BlockSpec,type BlockVolume} from './authoredCityBlockPlan'
import type {BalconySection,ColonyBalconyPlan} from './colonyBalconies'

// Four boxes per selected bay. Pickets are one guard envelope: balls do not
// pass through the visual gaps. Furniture/dividers are deliberately excluded.
export function balconySectionColliders(spec:BlockSpec,section:BalconySection,style:ColonyBalconyPlan['style'],radius:number){
 const {x,y,z,width:w,depth:d}=section,rail=style==='rail'
 const volumes:BlockVolume[]=[
  {x,y:y-.06,z:z+.48*d,w,h:.12,d:.96*d},
  {x,y:y+(rail?.535:.48),z:z+.94*d,w,h:rail?1.07:.96,d:.055*d},
  ...[-1,1].map(side=>({x:x+side*(rail?.49:.4975)*w,y:y+(rail?.51:.48),z:z+.48*d,w:(rail?.02:.005)*w,h:rail?1.02:.96,d:.92*d}))
 ]
 return cityBlockCollision(spec.building,{...spec,volumes},radius).map(b=>({...b,groundMargin:0}))
}
