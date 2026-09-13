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

/** Close the raised paving edge down to the ground in rebuilt districts.
 * A top skin alone exposes grass beneath it when viewed across a junction. */
export function buildDistrictKerbGeometry(surfaces:readonly StreetSurfaceGeometryInput[],radius:number,regions:readonly {azimuth:number;axial:number;width:number;length:number}[]){
 const positions:number[]=[],step=Math.sqrt(8*ROAD_SURFACE_MAX_SAGITTA_METERS*radius)
 const vertex=(s:StreetSurfaceGeometryInput,x:number,y:number,h:number)=>{const a=s.source.azimuth+x/radius;return[Math.cos(a)*(radius-h),s.source.axial+y,Math.sin(a)*(radius-h)]}
 for(const s of surfaces)for(const d of regions){
  const dx=Math.atan2(Math.sin(d.azimuth-s.source.azimuth),Math.cos(d.azimuth-s.source.azimuth))*radius,dy=d.axial-s.source.axial,w=d.width/2+24,h=d.length/2+24
  if(Math.max(...s.polygon.map(p=>p.x))<dx-w||Math.min(...s.polygon.map(p=>p.x))>dx+w||Math.max(...s.polygon.map(p=>p.y))<dy-h||Math.min(...s.polygon.map(p=>p.y))>dy+h)continue
  const p=clipStreetPolygon(clipStreetPolygon(clipStreetPolygon(clipStreetPolygon(s.polygon,1,0,w-dx),-1,0,w+dx),0,1,h-dy),0,-1,h+dy)
  for(let i=0;i<p.length;i++){
   const a=p[i],b=p[(i+1)%p.length],count=Math.max(1,Math.ceil(Math.abs(b.x-a.x)/step))
   for(let j=0;j<count;j++){
    const x0=a.x+(b.x-a.x)*j/count,y0=a.y+(b.y-a.y)*j/count,x1=a.x+(b.x-a.x)*(j+1)/count,y1=a.y+(b.y-a.y)*(j+1)/count
    const a0=vertex(s,x0,y0,s.lift),a1=vertex(s,x1,y1,s.lift),b0=vertex(s,x0,y0,-.02),b1=vertex(s,x1,y1,-.02)
    positions.push(...a0,...b0,...a1,...a1,...b0,...b1)
   }
  }
 }
 if(!positions.length)return null
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g
}
