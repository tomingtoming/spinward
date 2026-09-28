import assert from 'node:assert/strict'
import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {WalkWorld} from './walking.js'
import {WalkStream} from './walk-stream.js'
const root=new URL('../webxr/evidence/plateau-neighbourhood-20260923/derived/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),study=read('study.json'),route=read('exploration.json'),flush=()=>new Promise(r=>setImmediate(r))
const report={lengthM:route.length,steps:0,maxResident:0,maxDecodedBytes:0,maxCandidates:0,checks:[]}
for(const s of study.samples){
 const source=new WalkWorld(read(s.walk)),manifest=read(s.walkTiles)
 const load=t=>{const raw=gunzipSync(fs.readFileSync(new URL(t.path,root)));assert.equal(raw.length,t.decodedBytes);assert.equal(createHash('sha256').update(raw).digest('hex'),t.sha256);return JSON.parse(raw)}
 const stream=new WalkStream(manifest,{fetchTile:async t=>load(t)})
 const points=s.id==='tokyo'?route.points:source.data.arrival.route
 let state=source.spawn()
 for(let k=1;k<points.length;k++){
  const a=points[k-1],b=points[k],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1)
  for(let j=1;j<=n;j++){
   const target=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];stream.update(state.x,state.y,{force:true});await flush()
   const original=source.move(state,target[0]-state.x,target[1]-state.y),actual=stream.move(state,target[0]-state.x,target[1]-state.y)
   assert.equal(stream.waiting,false);assert.ok(Math.hypot(original.x-target[0],original.y-target[1])<1e-6);assert.equal(original.rejected,0)
   assert.ok(Math.abs(actual.h-original.h)<1e-8);assert.ok(Math.hypot(actual.x-original.x,actual.y-original.y)<1e-8)
   state=actual;report.steps++;report.maxCandidates=Math.max(report.maxCandidates,stream.lastCandidateCount)
   const d=stream.diagnostics();report.maxResident=Math.max(report.maxResident,d.resident.length);report.maxDecodedBytes=Math.max(report.maxDecodedBytes,d.decodedBytes)
  }
 }
 if(s.id==='tokyo')assert.ok(stream.evictions>0);stream.dispose();assert.equal(stream.diagnostics().decodedBytes,0)
 // At every collision tile edge, compare sampled source queries including polygon holes.
 let comparisons=0
 for(const t of manifest.tiles){const local=new WalkWorld(load(t)),b=t.bounds;for(let j=0;j<=10;j++)for(const [x,y] of [[b[0],b[1]+(b[3]-b[1])*j/10],[b[2]-.001,b[1]+(b[3]-b[1])*j/10],[b[0]+(b[2]-b[0])*j/10,b[1]],[b[0]+(b[2]-b[0])*j/10,b[3]-.001]]){assert.ok(Math.abs(source.terrain(x,y)-local.terrain(x,y))<1e-8);assert.equal(source.blocked(x,y),local.blocked(x,y));assert.ok(Math.abs(source.ground(x,y)-local.ground(x,y))<1e-8);comparisons++}}
 report.checks.push({region:s.id,edgeComparisons:comparisons,loads:stream.loads,evictions:stream.evictions})
}
const m=read(study.samples[0].walkTiles),deferred=[],late=new WalkStream(m,{fetchTile:t=>new Promise(r=>deferred.push(r))});late.update(0,0,{force:true});await flush();const state=late.spawn();assert.deepEqual(late.move(state,1,0),state);assert.ok(late.waiting);late.update(0,0,{active:false,force:true});deferred.forEach(r=>r({}));await flush();assert.equal(late.loads,0);late.dispose()
assert.ok(report.maxResident<=16);assert.ok(report.maxDecodedBytes<=4*1024*1024);fs.writeFileSync(new URL('../neighbourhood-unit.json',root),JSON.stringify(report,null,2));console.log(report)
