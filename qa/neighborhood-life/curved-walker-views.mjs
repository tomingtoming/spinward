import { Matrix4, Quaternion, Vector3 } from 'three'
// Public grounded fixtures, sampled from the deterministic curve footway.
// The resident approaches the player under ordinary elapsed simulation time.
export const curvedWalkerViews = [
 {name:'street',a:.24305026798921237,ax:484.4851079007505,h:.34,actor:'curve:-1',yield:true},
 {name:'night',a:.24305026798921237,ax:484.4851079007505,h:.34,actor:'curve:-1',phase:.02},
 {name:'far',a:.24305026798921237,ax:484.4851079007505,h:100,actor:null,free:true},
]
export function curvedWalkerPose(v) {
 const point=(a,ax,h)=>new Vector3(Math.cos(a)*(3200-h),ax,Math.sin(a)*(3200-h))
 const at=point(v.a,v.ax,v.h+1.8),aim=point(.2406392022362218,480.6020805904479,1.4)
 const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(at,aim,new Vector3(-Math.cos(v.a),0,-Math.sin(v.a))))
 return `${v.free?`m=f&rpm=0&p=${at.toArray()}`:`m=g&a=${v.a}&ax=${v.ax}&gh=${v.h}`}&q=${q.toArray()}&t=${v.phase??.42}`
}
