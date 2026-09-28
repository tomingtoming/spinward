import assert from 'node:assert/strict'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import * as T from 'three'
import {FacadeInstances} from './facade-instances.js'
import {FacadeStream} from './facade-stream.js'
import {surfacePoint} from './surface-frame.js'
const dir=fileURLToPath(new URL('../webxr/evidence/plateau-transfer-20260922/derived/',import.meta.url)),j=p=>JSON.parse(fs.readFileSync(dir+p)),study=j('study.json'),manifest=j('facade-sites.json'),kit=j('facade-kit.json')
const create=()=>new FacadeInstances(kit,[],study,study.samples[0]),flush=()=>new Promise(resolve=>setImmediate(resolve))
const f=create(),s=new FacadeStream(f,manifest,{fetchSite:async site=>j(site.path)})
f.group.updateWorldMatrix(true,true)
s.update(new T.Vector3(4000,4000,4000),{force:true});await flush();assert.equal(s.loads,0)
s.update(new T.Vector3(),{force:true});await flush();assert.equal(s.loads,2);assert.equal(f.design.buildings.length,66)
for(let i=0;i<4;i++){
 s.update(new T.Vector3(),{active:false,force:true});await flush();assert.equal(f.group.children.length,0);assert.equal(s.diagnostics().recipeBytes,0)
 s.update(new T.Vector3(),{force:true});await flush();assert.equal(f.design.buildings.length,66)
}
// Every deformed part remains inside the instance's culling bound in all three views.
for(const view of ['flat','curved','colony']){
 f.updateMode(view)
 for(const c of f.chunks)for(const p of c.parts){
  const v=new T.Vector3(...surfacePoint(study.radius,study.samples[0],view,...p.origin))
  assert.ok(v.distanceTo(c.renderCentre)+Math.max(p.width,p.height,2.5)<c.radius*1.04+2)
 }
}
// Abort may be ignored by a transport. A late region result must never become resident.
const staleF=create(),pending=[],stale=new FacadeStream(staleF,manifest,{fetchSite:site=>new Promise(resolve=>pending.push(()=>resolve(j(site.path))))})
stale.update(new T.Vector3(),{force:true});await flush();assert.equal(stale.running,2)
stale.update(new T.Vector3(),{active:false,force:true});for(const resolve of pending)resolve();await flush()
assert.equal(staleF.group.children.length,0);assert.equal(stale.loads,0);assert.equal(stale.aborted,2)
// Retry is bounded even when the camera remains still beside a failed asset.
let calls=0;const badF=create(),bad=new FacadeStream(badF,{...manifest,sites:manifest.sites.slice(0,1)},{fetchSite:async()=>{calls++;throw Error('offline')}})
for(let i=0;i<20;i++){bad.update(new T.Vector3(),{force:true,now:performance.now()+10000+i*10000});await flush()}
assert.equal(calls,3);assert.equal(bad.failures,3);assert.equal(badF.group.children.length,0)
// The colony copies keep the same native scale and point their local up toward the axis.
for(const sample of study.samples){
 const p=new T.Vector3(...surfacePoint(study.radius,sample,'colony',17,29,3)),up=new T.Vector3(...surfacePoint(study.radius,sample,'colony',17,29,4)).sub(p)
 assert.ok(Math.abs(up.length()-1)<1e-9);assert.ok(up.dot(new T.Vector3(-p.x,-p.y,0).normalize())>.999999)
}
const report={passed:true,loads:s.loads,evictions:s.evictions,lateRepliesIgnored:stale.aborted,retryAttempts:calls,checks:['lazy distance loading','four unload/reload cycles','culling bounds in three coordinate frames','abort/late reply','bounded retry','three-band local up and metre scale']}
for(const stream of [s,stale,bad])stream.dispose();for(const instance of [f,staleF,badF])instance.dispose()
console.log(JSON.stringify(report,null,2))
