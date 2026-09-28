import fs from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import * as T from 'three'
import {unpackTile} from '../../src/worlds/plateau/tile-format.js'
import {composeFacades} from '../../src/worlds/plateau/facade-rules.js'
import {surfacePoint} from '../../src/worlds/plateau/surface-frame.js'
import {refineCurvedBuilding} from '../../src/worlds/plateau/curved-building-mesh.js'
import assert from 'node:assert/strict'
const root=process.env.SPINWARD_METRO_ROOT,output=process.env.SPINWARD_METRO_EVIDENCE
if(!root||!output)throw Error('Explicit root and output required')
const read=async p=>JSON.parse(await fs.readFile(root+'/derived/'+p,'utf8'))
const study=await read('metro-overview.json'),sample=study.samples.find(s=>s.id==='west'),R=study.radius
const material=new T.MeshBasicMaterial({side:T.DoubleSide}),ray=new T.Raycaster(),records=[]
for(const id of ['1-196','1-197','2-197']){
  const buffer=gunzipSync(await fs.readFile(root+'/derived/west/tiles/'+id+'.bin.gz'))
  const data=unpackTile(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)).find(m=>m.name==='buildings')
  if(process.env.SPINWARD_REFINE==='1'){
    const before=data.attributes.index.length/3,start=performance.now()
    data.attributes=refineCurvedBuilding(data.attributes,R)
    console.log(id,{before,after:data.attributes.index.length/3,ms:performance.now()-start})
  }
  const native=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(data.attributes.position,3)).setIndex(new T.BufferAttribute(data.attributes.index,1))
  const curved=native.clone(),p=curved.attributes.position
  for(let i=0;i<p.count;i++)p.setXYZ(i,...surfacePoint(R,sample,'colony',...data.attributes.position.slice(i*3,i*3+3)))
  const meshes=[new T.Mesh(native,material),new T.Mesh(curved,material)]
  const site=JSON.parse(gunzipSync(await fs.readFile(root+'/derived/west/tiles/'+id+'-facade.json.gz')))
  const parts=composeFacades(site.buildings.filter(b=>Math.max(...b.walls.map(w=>w.top-w.base))>80)).parts.filter(p=>p.kind==='window')
  for(let i=0;i<parts.length;i+=7){
    const p=parts[i],n=new T.Vector3(p.u[1],-p.u[0],0)
    const v=new T.Vector3(p.origin[0],p.origin[1],p.origin[2]+p.height/2).addScaledVector(n,.057*p.depth)
    const a=(v.x+sample.anchor.local[0])/R+sample.band*Math.PI*2/3
    const nn=new T.Vector3(n.x*Math.cos(a)/(1-v.z/R),n.x*Math.sin(a)/(1-v.z/R),-n.y).normalize()
    const vv=new T.Vector3(...surfacePoint(R,sample,'colony',...v.toArray()))
    const clear=[]
    for(const [j,[point,normal]] of [[v,n],[vv,nn]].entries()){
      ray.set(point.clone().add(normal),normal.clone().negate());ray.near=0;ray.far=2
      const hits=ray.intersectObject(meshes[j]);clear.push(hits.length?hits[0].distance-1:null)
    }
    records.push({id:p.id,wall:p.wall,at:v.toArray(),native:clear[0],curved:clear[1]})
  }
  native.dispose();curved.dispose()
}
const stats=key=>{const rows=records.filter(r=>r[key]!==null),values=rows.map(r=>r[key]).sort((a,b)=>a-b);return{count:values.length,min:values[0],median:values[Math.floor(values.length/2)],max:values.at(-1),behind:values.filter(x=>x<0).length}}
const newPenetrations=records.filter(r=>r.native>0&&r.curved!==null&&r.curved<0).length
if(process.env.SPINWARD_REFINE==='1')assert.equal(newPenetrations,0,'cylinder warp must not bury previously clear windows')
await fs.mkdir(output,{recursive:true});const result={native:stats('native'),curved:stats('curved'),newPenetrations,records}
await fs.writeFile(output+'/clearance.json',JSON.stringify(result,null,2));console.log(JSON.stringify({native:result.native,curved:result.curved}))
