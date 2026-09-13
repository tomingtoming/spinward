export type RoadKnot={point:[number,number];tangent:[number,number]}
/** Cubic Hermite centreline in surface metres. Derivatives own both the lane
 * offset and heading, so curves never get an unrelated interpolated normal. */
export function sampleRoadCurve(a:RoadKnot,b:RoadKnot,t:number,offset=0){
 const t2=t*t,t3=t2*t,h=[2*t3-3*t2+1,t3-2*t2+t,-2*t3+3*t2,t3-t2]
 const dh=[6*t2-6*t,3*t2-4*t+1,-6*t2+6*t,3*t2-2*t]
 const values=[a.point,a.tangent,b.point,b.tangent]
 const point=[0,1].map(k=>values.reduce((s,v,i)=>s+v[k]*h[i],0))
 const derivative=[0,1].map(k=>values.reduce((s,v,i)=>s+v[k]*dh[i],0))
 const length=Math.hypot(...derivative)
 if(length<1e-8)throw Error('Road curve has a stationary tangent')
 const dx=derivative[0]/length,dy=derivative[1]/length
 return {x:point[0]-dy*offset,y:point[1]+dx*offset,heading:Math.atan2(dy,dx),normal:[-dy,dx] as const}
}
