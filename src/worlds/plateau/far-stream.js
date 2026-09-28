import * as T from 'three'
import {surfacePoint} from './surface-frame.js'
import {yieldScene} from './tile-worker-client.js'

// Distant chunks follow a wide view cone. Keep a three-second turn grace period;
// their exact source terrain replaces the small terrain fallback atomically.
export class FarStream{
  constructor(owner,fetchTile,{maxBytes=48*1024*1024,maxResident=32,maxConcurrent=2,loadDistance=Infinity,evictDistance=Infinity}={}){
    Object.assign(this,{owner,fetchTile,maxBytes,maxResident,maxConcurrent,loadDistance,evictDistance});this.entries=new Map(owner.manifest.farTiles.map(tile=>[tile.id,{tile,status:'unloaded',wanted:false,attempts:0,nextTry:0,meshes:[],seen:-Infinity}]))
    this.running=0;this.loads=0;this.evictions=0;this.failures=0;this.aborted=0;this.disposed=false
  }
  update(eye,{direction,visible=true,overview=false,now=performance.now()}={}){
    const o=this.owner,local=o.group.worldToLocal(eye.clone()),inverse=o.group.matrixWorld.clone().invert(),forward=direction?.clone().transformDirection(inverse),candidates=[],delta=new T.Vector3()
    for(const e of this.entries.values()){
      if(e.boundsMode!==o.mode){const b=e.tile.bounds,h=e.tile.heightRange;e.centre=new T.Vector3(...surfacePoint(o.study.radius,o.sample,o.mode,(b[0]+b[2])/2,(b[1]+b[3])/2,(h[0]+h[1])/2));e.radius=Math.hypot(b[2]-b[0],b[3]-b[1],h[1]-h[0])*.53;e.boundsMode=o.mode}
      delta.subVectors(e.centre,local);const d=delta.length(),r=e.radius
      e.distance=Math.max(0,d-r)
      const facing=overview||!forward||d<r+250||delta.dot(forward)/d>Math.cos(Math.PI*75/180+Math.asin(Math.min(1,r/d)))
      if(visible&&facing)e.seen=now
      if(visible&&e.distance<(e.status==='resident'?this.evictDistance:this.loadDistance)&&(facing||(e.status==='resident'&&now-e.seen<3000)))candidates.push(e)
    }
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+(e.decodedBytes??e.tile.decodedBytes)<=this.maxBytes){wanted.add(e.tile.id);bytes+=e.decodedBytes??e.tile.decodedBytes}
    let changed=false
    for(const e of this.entries.values()){
      const next=wanted.has(e.tile.id);if(e.wanted&&!next){e.attempts=0;e.nextTry=0}e.wanted=next
      if(e.status==='resident'){
        for(const id of e.tile.tiles)o.coverage?.target(id,next)
        if(!next&&(!o.coverage||e.tile.tiles.every(id=>o.coverage.value(id)===0))){this.release(e);changed=true}
      }
      if(!next&&e.status==='loading'&&!e.controller.signal.aborted){e.controller.abort();this.aborted++}
    }
    if(changed)o.refreshFar();this.pump(now)
  }
  release(e){for(const id of e.tile.tiles)this.owner.coverage?.target(id,false);for(const f of e.meshes){const m=f.mesh;this.owner.group.remove(m);m.geometry.dispose();m.material.dispose();m.userData={}}e.meshes=[];e.status='unloaded';this.evictions++}
  pump(now=performance.now()){
    if(this.disposed||this.running>=this.maxConcurrent)return
    const residentCount=this.resident.length
    if(residentCount+this.running>=this.maxResident)return
    // Only pending demand needs ordering, not the entire city catalog.
    const pending=[...this.entries.values()].filter(e=>e.wanted&&e.status!=='resident'&&e.status!=='loading'&&e.attempts<3&&now>=e.nextTry)
    for(const e of pending.sort((a,b)=>a.distance-b.distance)){
      if(this.running>=this.maxConcurrent)break
      if(residentCount+this.running>=this.maxResident)break
      if(!e.wanted||['loading','resident'].includes(e.status)||e.attempts>=3||now<e.nextTry)continue
      const controller=new AbortController();e.controller=controller;e.status='loading';e.attempts++;this.running++
      Promise.resolve().then(()=>this.fetchTile(e.tile,controller.signal)).then(async data=>{
        if(this.disposed||controller.signal.aborted||!e.wanted){for(const d of data)d.bitmap?.close();return}
        e.decodedBytes=e.tile.decodedBytes+(data.extraDecodedBytes??0)
        if(this.diagnostics().decodedBytes+e.decodedBytes>this.maxBytes){e.wanted=false;e.attempts=0;e.nextTry=performance.now()+200;for(const d of data)d.bitmap?.close();return}
        const refs=[];try{for(const d of data){await yieldScene();if(this.disposed||controller.signal.aborted||!e.wanted)break;const mesh=this.owner.mesh(d,'far');refs.push({mesh,segments:d.segments,indices:d.attributes.index});await this.owner.prepareVisual(mesh)}}catch(error){for(const f of refs){f.mesh.geometry.dispose();f.mesh.material.dispose()}for(const d of data)d.bitmap?.close();throw error}
        if(this.disposed||controller.signal.aborted||!e.wanted||this.resident.length>=this.maxResident||this.diagnostics().decodedBytes+e.decodedBytes>this.maxBytes){e.attempts=0;e.nextTry=performance.now()+200;for(const f of refs){f.mesh.geometry.dispose();f.mesh.material.dispose()}for(const d of data)d.bitmap?.close();return}
        e.meshes=refs;for(const f of refs)this.owner.group.add(f.mesh);e.status='resident';e.attempts=0;this.loads++;this.owner.refreshFar()
        for(const id of e.tile.tiles)this.owner.coverage?.target(id,true)
      }).catch(error=>{if(this.disposed||controller.signal.aborted)return;e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);this.failures++;this.owner.onError(error,e.tile)})
        .finally(()=>{this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded';this.pump()})
    }
  }
  get ready(){return [...this.entries.values()].every(e=>!e.wanted||(e.status==='resident'&&(!this.owner.coverage||e.tile.tiles.every(id=>this.owner.coverage.value(id)===1))))}
  get resident(){return [...this.entries.values()].filter(e=>e.status==='resident')}
  retry(){for(const e of this.entries.values())if(e.status==='failed'){e.attempts=0;e.nextTry=0}this.pump()}
  diagnostics(){return{resident:this.resident.map(e=>e.tile.id),decodedBytes:this.resident.reduce((n,e)=>n+(e.decodedBytes??e.tile.decodedBytes),0),pending:this.running,loads:this.loads,evictions:this.evictions,failures:this.failures,aborted:this.aborted}}
  dispose(){this.disposed=true;for(const e of this.entries.values()){e.wanted=false;e.controller?.abort();if(e.status==='resident')this.release(e)}}
}
