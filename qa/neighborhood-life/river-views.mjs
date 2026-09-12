import { Matrix4, Quaternion, Vector3 } from 'three'
export const riverOrigin = { a: .1763264639508575, ax: 1445.8064516129052 }
export const riverViews = [
 {name:'overview',at:[-102,-140,95],aim:[4,0,0]},
 {name:'bank',at:[18,32,3],aim:[5,-5,2.7],ground:true,h:1.2},
 {name:'bridge',at:[-32,-13,7.14],aim:[28,13,7.14],ground:true,h:5.34},
 {name:'ramp',at:[22,93,6.55],aim:[20,62,3.8],ground:true,h:4.83},
 {name:'junction',at:[-116,-30,1.8],aim:[-70,-17,6],ground:true,h:0},
 {name:'far',at:[-720,-850,300],aim:[0,0,2]},
 {name:'night',at:[18,32,3],aim:[5,-5,2.7],ground:true,h:1.2,phase:.02},
]
export function riverPose(v) {
 const point=([x,y,h])=>{const a=riverOrigin.a+x/3200;return new Vector3(Math.cos(a)*(3200-h),riverOrigin.ax+y,Math.sin(a)*(3200-h))}
 const at=point(v.at), a=riverOrigin.a+v.at[0]/3200
 const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(at,point(v.aim),new Vector3(-Math.cos(a),0,-Math.sin(a))))
 return `${v.ground?`m=g&a=${a}&ax=${riverOrigin.ax+v.at[1]}&gh=${v.h??0}`:`m=f&rpm=0&p=${at.toArray()}`}&q=${q.toArray()}&t=${v.phase??.42}`
}
