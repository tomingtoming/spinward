// Compare collision heights to the actual cylinder-deformed triangle planes.
// This catches road/terrain intersections that a flat-coordinate test cannot.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import * as T from 'three'
import {TerrainTriangles} from './band-landscape.js'
import {surfacePoint,surfaceAngle} from './surface-frame.js'
const root=path.resolve(process.argv[2]),read=f=>JSON.parse(fs.readFileSync(path.join(root,f))),study=read('study.json'),report=[]
function binary(m,key,Type){const b=fs.readFileSync(path.join(root,m.path,m[key]));return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))}
for(const s of study.samples){
 const data=read(s.bandLandscape),terrain=data.meshes.find(m=>m.name==='band-terrain'),roads=data.meshes.find(m=>m.name==='band-roads'),p=binary(terrain,'positions',Float32Array),idx=binary(terrain,'indices',Uint32Array),rp=binary(roads,'positions',Float32Array),ri=binary(roads,'indices',Uint32Array),query=new TerrainTriangles(p,idx),world=new Float64Array(p.length)
 for(let i=0;i<p.length;i+=3)world.set(surfacePoint(study.radius,s,'colony',p[i],p[i+1],p[i+2]),i)
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3(),down=new T.Vector3(),origin=new T.Vector3(),ray=new T.Ray(),pos=new T.Vector3();let minClearance=Infinity,minAt=null,maxGroundError=0,checked=0
 function distance(x,y,point){const angle=surfaceAngle(study.radius,s,'colony',x);down.set(Math.sin(angle),-Math.cos(angle),0);origin.copy(point).addScaledVector(down,-3);ray.set(origin,down);let best=Infinity
  for(const k of query.cells.get(Math.floor(x/query.size)+','+Math.floor(y/query.size))??[]){a.fromArray(world,idx[k]*3);b.fromArray(world,idx[k+1]*3);c.fromArray(world,idx[k+2]*3);if(ray.intersectTriangle(a,b,c,false,hit))best=Math.min(best,origin.distanceTo(hit))}return best}
 for(let k=0,step=Math.max(3,Math.floor(ri.length/18000/3)*3);k<ri.length;k+=step){let x=0,y=0;pos.set(0,0,0)
  for(let j=0;j<3;j++){const i=ri[k+j]*3;x+=rp[i]/3;y+=rp[i+1]/3;pos.add(new T.Vector3(...surfacePoint(study.radius,s,'colony',rp[i],rp[i+1],rp[i+2])).multiplyScalar(1/3))}
  const clearance=distance(x,y,pos)-3;if(clearance<minClearance){minClearance=clearance;minAt=[x,y]};assert(Number.isFinite(clearance));checked++
  const h=query.height(x,y),error=Math.abs(distance(x,y,new T.Vector3(...surfacePoint(study.radius,s,'colony',x,y,h)))-3);maxGroundError=Math.max(maxGroundError,error)
 }
 report.push({id:s.id,checked,minRoadClearanceM:minClearance,minAt,maxGroundContactErrorM:maxGroundError});console.log(report.at(-1))
}
fs.writeFileSync(path.join(root,'../band-render-contact.json'),JSON.stringify({regions:report},null,2))
assert(report.every(r=>r.minRoadClearanceM>.02&&r.maxGroundContactErrorM<.05),'Deformed road/terrain contact exceeds the budget')
