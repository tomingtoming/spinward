import { riverPose } from './river-views.mjs'
const centre = y => 9 * Math.sin(y / 62)
export const riverWalkerViews = [
  { name: 'bank', at: [centre(12)+13.5,12,3], aim:[13.5,0,2.3], ground:true,h:1.2,actor:'river:1',yield:true },
  { name: 'ramp', at:[centre(76)-13.5,76,5.196],aim:[centre(58)-13.5,58,2.95],ground:true,h:3.396,actor:'river:-1' },
  { name: 'night', at:[centre(12)+13.5,12,3],aim:[13.5,0,2.3],ground:true,h:1.2,phase:.02,actor:'river:1' },
  { name: 'far',at:[-250,-200,120],aim:[0,0,2],actor:null },
]
export { riverPose }
