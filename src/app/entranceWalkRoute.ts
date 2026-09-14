import type {EntranceWalk} from '../objects/streetEntranceWalk'
import {containsStreetPolygon} from '../objects/streetPolygon'
import {sampleCitySurface} from '../objects/citySurfaceMesh'
import type {SurfacePoint} from './neighborhoodRoute'

/** Short door/landing journeys follow the exact certified surface. A coarse
 * city raster can erase a two-metre oblique ramp. Longer journeys still use
 * the existing route planner; this does not invent a missing street link. */
export function routeOnEntranceWalk(walks:readonly EntranceWalk[],radius:number,start:SurfacePoint,goal:SurfacePoint):SurfacePoint[]|null|undefined {
  for(const w of walks){
    const local=(p:SurfacePoint)=>({x:Math.atan2(Math.sin(p.azimuth-w.source.azimuth),Math.cos(p.azimuth-w.source.azimuth))*radius,y:p.axial-w.source.axial})
    const a=local(start),b=local(goal),pieces=[...w.pieces,...w.landingPieces]
    const inside=(p:typeof a)=>pieces.some(q=>containsStreetPolygon(q,p.x,p.y))
    if(!inside(a)||!inside(b))continue
    const height=(p:typeof a)=>w.pieces.some(q=>containsStreetPolygon(q,p.x,p.y))?sampleCitySurface(w.surfaceMesh,p.x,p.y):w.landingHeight
    if([start,goal].some((p,i)=>p.groundHeight!==undefined&&Math.abs(p.groundHeight-height(i?b:a))>.35))return null
    const dx=b.x-a.x,dy=b.y-a.y,cuts=[0,1]
    const triangles=[]
    for(let i=0;i<w.surfaceMesh.length;i+=9)triangles.push([0,3,6].map(j=>({x:w.surfaceMesh[i+j],y:w.surfaceMesh[i+j+1]})))
    for(const p of [...pieces,...triangles])for(let i=0;i<p.length;i++){
      const u=p[i],v=p[(i+1)%p.length],ex=v.x-u.x,ey=v.y-u.y,det=dx*ey-dy*ex
      if(Math.abs(det)<1e-10)continue
      const t=((u.x-a.x)*ey-(u.y-a.y)*ex)/det,s=((u.x-a.x)*dy-(u.y-a.y)*dx)/det
      if(t>0&&t<1&&s>=-1e-8&&s<=1+1e-8)cuts.push(t)
    }
    cuts.sort((a,b)=>a-b)
    const at=(t:number)=>({x:a.x+dx*t,y:a.y+dy*t})
    // Every interval is bounded by polygon edges, so this detects even a
    // sub-centimetre gap; it is not a fixed-step sampling approximation.
    for(let i=1;i<cuts.length;i++)if(!inside(at((cuts[i-1]+cuts[i])/2)))return null
    return cuts.filter((t,i)=>!i||t-cuts[i-1]>1e-8).map(t=>{const p=at(t);return{azimuth:w.source.azimuth+p.x/radius,axial:w.source.axial+p.y,groundHeight:height(p)}})
  }
  return undefined
}
