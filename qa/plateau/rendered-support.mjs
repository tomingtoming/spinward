import {Matrix4,Triangle,Vector3} from 'three'

// Match the physical sphere (playerTraversal.ts: 0.32 m) and its 0.02 m contact
// tolerance. A centre ray misses a valid contact at a roof edge. Conversely,
// a floor metres below the body must not pass this finite-contact inspection.
export function findRenderedSupport(probe,{radius=.32,separation=.02}={}){
  const outward=new Vector3(Math.cos(probe.a),0,Math.sin(probe.a))
  const center=outward.clone().multiplyScalar(probe.radial);center.y=probe.y
  const limit=radius+separation,triangle=new Triangle(),normal=new Vector3(),point=new Vector3(),delta=new Vector3(),matrix=new Matrix4()
  let closest=null
  for(const mesh of probe.meshes){
    matrix.fromArray(mesh.matrix)
    for(let i=0;i<mesh.i.length;i+=3){
      triangle.a.fromArray(mesh.p,mesh.i[i]*3).applyMatrix4(matrix)
      triangle.b.fromArray(mesh.p,mesh.i[i+1]*3).applyMatrix4(matrix)
      triangle.c.fromArray(mesh.p,mesh.i[i+2]*3).applyMatrix4(matrix)
      if(['x','y','z'].some(axis=>Math.min(triangle.a[axis],triangle.b[axis],triangle.c[axis])>center[axis]+limit||Math.max(triangle.a[axis],triangle.b[axis],triangle.c[axis])<center[axis]-limit))continue
      if(Math.abs(triangle.getNormal(normal).dot(outward))<.5)continue
      triangle.closestPointToPoint(center,point);delta.subVectors(point,center)
      const distance=delta.length(),depth=delta.dot(outward)
      if(distance>limit||depth<0||closest&&distance>=closest.contactDistance)continue
      const height=probe.r-Math.hypot(point.x,point.z)
      closest={drawnHeight:height,physicsHeight:probe.h,clearance:probe.r-probe.radial-height,
        contactDistance:distance,lateralOffset:Math.sqrt(Math.max(0,distance*distance-depth*depth))}
    }
  }
  return closest
}
