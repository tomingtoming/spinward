import type {BlockSpec} from './authoredCityBlockPlan'
/** Uses the same rigid tangent frame as the rendered model, including recessed roofs. */
export function buildingRoofAttachment(spec:BlockSpec,radius:number,roofInset=0){
 const v=spec.volumes.reduce((a,b)=>b.y+b.h/2>a.y+a.h/2+1e-5||(Math.abs(b.y+b.h/2-a.y-a.h/2)<1e-5&&b.w*b.d>a.w*a.d)?b:a)
 const b=spec.building,a=b.azimuth,side=b.front?.side??-1,tangent=b.front?.axis==='tangent'
 const height=v.y+v.h/2-roofInset,t=side*(tangent?v.z:-v.x),ax=side*(tangent?v.x:v.z)
 return {x:Math.cos(a)*(radius-height)-Math.sin(a)*t,y:b.axial+ax,z:Math.sin(a)*(radius-height)+Math.cos(a)*t,height,local:{x:v.x,y:height,z:v.z},up:{x:-Math.cos(a),y:0,z:-Math.sin(a)}}
}
