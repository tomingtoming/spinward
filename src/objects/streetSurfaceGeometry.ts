import * as THREE from 'three'
import { clipStreetPolygon } from './streetPolygon'
import { type StreetSurface } from './streetSurfacePlan'
import { ROAD_SURFACE_MAX_SAGITTA_METERS } from './roadSurfaceGeometry'

/** Clip long convex pieces into cylindrical strips before triangulating.
 * A diagonal must follow the cylinder too: a single wide triangle is a chord. */
export type StreetSurfaceGeometryInput = Pick<StreetSurface, 'polygon' | 'lift'> & { source: Pick<StreetSurface['source'], 'azimuth' | 'axial'> }
export function buildStreetSurfaceGeometry(surfaces:readonly StreetSurfaceGeometryInput[],radius:number,texturePeriod:number){
 if(!surfaces.length)return null
 const position:number[]=[],normal:number[]=[],uv:number[]=[],index:number[]=[]
 const width=Math.sqrt(8*ROAD_SURFACE_MAX_SAGITTA_METERS*radius)
 for(const s of surfaces){
  const min=Math.min(...s.polygon.map(p=>p.x)),max=Math.max(...s.polygon.map(p=>p.x))
  const count=Math.max(1,Math.ceil((max-min)/width))
  for(let i=0;i<count;i++){
   const left=min+(max-min)*i/count,right=min+(max-min)*(i+1)/count
   const polygon=count===1?s.polygon:clipStreetPolygon(clipStreetPolygon(s.polygon,1,0,-left),-1,0,right)
   if(polygon.length<3)continue
   const start=position.length/3
   for(const p of polygon){
    const angle=s.source.azimuth+p.x/radius,c=Math.cos(angle),sn=Math.sin(angle)
    position.push(c*(radius-s.lift),s.source.axial+p.y,sn*(radius-s.lift));normal.push(c,0,sn);uv.push(p.u,p.v/texturePeriod)
   }
   for(let j=1;j<polygon.length-1;j++)index.push(start,start+j+1,start+j)
  }
 }
 const g=new THREE.BufferGeometry()
 g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index)
 g.computeBoundingBox();g.computeBoundingSphere();return g
}
