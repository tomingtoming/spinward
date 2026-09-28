import assert from 'node:assert/strict'
import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import * as T from 'three'
import {unpackTile} from './tile-format.js'
import {BaseTiles,fetchTile} from './base-tiles.js'
import {surfacePoint} from './surface-frame.js'
const root=fileURLToPath(new URL('../webxr/evidence/plateau-transfer-20260922/derived/',import.meta.url)),json=p=>JSON.parse(fs.readFileSync(root+p)),study=json('study.json')
const buffer=p=>{const b=fs.readFileSync(root+p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}
// HTTP servers may deliver gzip as encoded content (already decoded by fetch) or raw bytes.
const firstManifest=json(study.samples[0].baseTiles),transportDescriptor=firstManifest.overview,compressed=fs.readFileSync(root+transportDescriptor.path),originalFetch=globalThis.fetch
for(const bytes of [compressed,gunzipSync(compressed)]){globalThis.fetch=async()=>new Response(bytes);assert.ok((await fetchTile(transportDescriptor)).length>0)}
globalThis.fetch=originalFetch
const tile=t=>{const b=gunzipSync(fs.readFileSync(root+t.path));assert.equal(b.byteLength,t.decodedBytes);assert.equal(createHash('sha256').update(b).digest('hex'),t.sha256);return unpackTile(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))}
function triangles(a){const rows=[];for(let k=0;k<a.index.length;k+=3){const v=[];for(let j=0;j<3;j++){const i=a.index[k+j];v.push(...a.position.subarray(i*3,i*3+3))}rows.push(v.join(','))}return rows}
const report={regions:[],checks:['every original oriented triangle preserved exactly once','whole building ownership','identical ground across mixed LODs','global terrain normals retained at tile edges','late response ignored','bounded failure retries','bounded residency and repeatable disposal']}
for(const sample of study.samples){
 const manifest=json(sample.baseTiles),near=new Map(),all=new Map(),far=tile(manifest.overview)
 for(const t of manifest.tiles){const meshes=tile(t);near.set(t.id,meshes);for(const m of meshes){if(!all.has(m.name))all.set(m.name,[]);all.get(m.name).push(...triangles(m.attributes))}}
 let count=0
 for(const source of sample.meshes.filter(m=>!m.name.startsWith('frontage-'))){
  const p=new Float32Array(buffer(source.path+source.positions)),i=new Uint32Array(buffer(source.path+source.indices)),expected=triangles({position:p,index:i}).sort(),actual=all.get(source.name).sort()
  assert.deepEqual(actual,expected,sample.id+'/'+source.name);count+=i.length/3
  if(source.name!=='buildings')assert.deepEqual(triangles(far.find(m=>m.name===source.name).attributes).sort(),expected,'Far ground/foundation triangle mismatch')
 }
 const ids=manifest.tiles.flatMap(t=>t.buildingIds),features=json(sample.features);assert.equal(new Set(ids).size,features.length);assert.equal(ids.length,features.length)
 // Every copy of a terrain vertex carries the same normal, including boundary duplicates.
 const normals=new Map();for(const meshes of near.values())for(const m of meshes.filter(m=>m.name==='terrain')){const a=m.attributes;for(let i=0;i<a.position.length;i+=3){const key=Array.from(a.position.subarray(i,i+3)).join(','),n=Array.from(a.normal.subarray(i,i+3));if(normals.has(key))assert.deepEqual(normals.get(key),n);else normals.set(key,n)}}
 const sourceBuilding=sample.meshes.find(m=>m.name==='buildings'),buildingP=new Float32Array(buffer(sourceBuilding.path+sourceBuilding.positions)),buildingI=new Uint32Array(buffer(sourceBuilding.path+sourceBuilding.indices)),featureById=new Map(features.map(f=>[f.id,f]))
 for(const t of manifest.tiles){const actual=near.get(t.id).find(m=>m.name==='buildings'),expected=[];for(const id of t.buildingIds){const f=featureById.get(id);expected.push(...triangles({position:buildingP,index:buildingI.subarray(f.firstIndex,f.firstIndex+f.indexCount)}))}assert.deepEqual(actual?triangles(actual.attributes).sort():[],expected.sort(),'A source building crosses ownership tiles')}
 report.regions.push({id:sample.id,tiles:manifest.tiles.length,triangles:count,buildings:ids.length})
 const base=new BaseTiles(study,sample,manifest,far,{fetchNear:async t=>near.get(t.id)})
 const flush=()=>new Promise(resolve=>setImmediate(resolve)),eye=()=>new T.Vector3(...surfacePoint(study.radius,sample,base.mode,185,30,1.7))
 const snapshots=[]
 for(const view of ['flat','curved','colony']){
  base.updateMode(view);base.group.updateWorldMatrix(true,true)
  for(let cycle=0;cycle<3;cycle++){
   base.update(eye(),{force:true});await flush();assert.ok(base.ready)
   assert.ok(base.diagnostics().resident.length>0&&base.diagnostics().resident.length<=25);assert.ok(base.diagnostics().nearDecodedBytes<=12*1024*1024)
   // Actual index draw ranges, not undrawn retained far indices, are the coverage oracle.
   for(const name of ['terrain','roads']){
    const rendered=base.group.children.filter(m=>m.visible&&m.name===name).reduce((n,m)=>n+Math.min(m.geometry.drawRange.count,m.geometry.index.count)/3,0)
    assert.equal(rendered,sample.meshes.find(m=>m.name===name).triangles)
   }
   snapshots.push(base.group.children.length);base.update(eye(),{active:false,force:true});await flush();assert.equal(base.diagnostics().nearDecodedBytes,0);assert.equal(base.group.children.length,far.length)
  }
 }
 assert.equal(new Set(snapshots).size,1);base.dispose()
 if(sample.id==='tokyo'){
  const waiting=[],stale=new BaseTiles(study,sample,manifest,far,{fetchNear:t=>new Promise(resolve=>waiting.push(()=>resolve(near.get(t.id))))})
  stale.update(new T.Vector3(185,1.7,-30),{force:true});await flush();stale.update(new T.Vector3(185,1.7,-30),{active:false,force:true});waiting.forEach(f=>f());await flush();assert.equal(stale.loads,0);assert.equal(stale.aborted,2);stale.dispose()
  let attempts=0;const bad=new BaseTiles(study,sample,{...manifest,tiles:manifest.tiles},far,{maxResident:1,fetchNear:async()=>{attempts++;throw Error('offline')}})
  for(let n=0;n<10;n++){bad.update(new T.Vector3(0,1.7,0),{force:true,now:performance.now()+10000+n*10000});await flush()}
  assert.equal(attempts,3);assert.equal(bad.loads,0);assert.equal(bad.group.children.length,far.length);bad.dispose()
 }
}
fs.writeFileSync(root+'../base-tile-unit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
