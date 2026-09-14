import {BufferGeometry,BufferAttribute} from 'three'
import {citySurfaceVertices} from './citySurfaceMesh'
import type {EntranceWalk} from './streetEntranceWalk'

/** Render precisely the triangles used for grounding and streamed collision.
 * The existing sidewalk owns the landing; do not lay another skin over it. */
export function buildEntranceWalkGeometry(walk:EntranceWalk,radius:number){
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(citySurfaceVertices(walk.surfaceMesh,radius),3))
  geometry.rotateY(-walk.source.azimuth)
  geometry.translate(Math.cos(walk.source.azimuth)*radius,walk.source.axial,Math.sin(walk.source.azimuth)*radius)
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
  return geometry
}
