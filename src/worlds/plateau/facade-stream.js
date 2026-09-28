import * as T from 'three'
import {surfacePoint} from './surface-frame.js'
import {yieldScene} from './tile-worker-client.js'

// Geometry/recipe residency is distinct from visual LOD. Load before the last visible
// panel and evict beyond it. Base buildings and collision never depend on this queue.
export class FacadeStream{
  constructor(facades,manifest,{fetchSite,onError=()=>{},maxConcurrent=2,maxResident=4,maxBytes=Infinity,loadDistance=780,evictDistance=920,prepareVisual}={}){
    this.facades=facades;this.manifest=manifest;this.fetchSite=fetchSite??(async(s,signal)=>{
      const r=await fetch('/'+s.path,{signal});if(!r.ok)throw Error(`${r.status} ${s.path}`);return r.json()
    });this.onError=onError;this.maxConcurrent=maxConcurrent;this.maxResident=maxResident;this.maxBytes=maxBytes;this.loadDistance=loadDistance;this.evictDistance=evictDistance;this.prepareVisual=prepareVisual
    this.entries=new Map(manifest.sites.map(site=>[site.id,{site,status:'unloaded',attempts:0,nextTry:0,wanted:false,controller:null}]))
    this.running=0;this.loads=0;this.evictions=0;this.aborted=0;this.failures=0;this.lastUpdate=-Infinity;this.disposed=false
  }
  update(cameraWorld,{active=true,tabletop=false,now=performance.now(),force=false}={}){
    if(this.disposed||(!force&&now-this.lastUpdate<150))return;this.lastUpdate=now
    const f=this.facades,local=f.group.worldToLocal(cameraWorld.clone()),candidates=[]
    for(const e of this.entries.values()){
      if(e.boundsMode!==f.mode){const b=e.site.bounds,h=e.site.heightRange??[0,60],centre=[(b[0]+b[2])/2,(b[1]+b[3])/2,(h[0]+h[1])/2]
        e.centre=new T.Vector3(...surfacePoint(f.study.radius,f.sample,f.mode,...centre));e.radius=Math.hypot(b[2]-b[0],b[3]-b[1],h[1]-h[0])/2*1.04;e.boundsMode=f.mode}
      const d=Math.max(0,local.distanceTo(e.centre)-e.radius)
      e.distance=d
      const wanted=active&&(tabletop||d<(e.status==='resident'?this.evictDistance:this.loadDistance))
      if(wanted)candidates.push(e)
    }
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+e.site.bytes<=this.maxBytes){wanted.add(e.site.id);bytes+=e.site.bytes}
    for(const e of this.entries.values()){
      const next=wanted.has(e.site.id)
      if(e.wanted&&!next){e.attempts=0;e.nextTry=0}
      e.wanted=next
      if(!next&&e.status==='resident'){f.removeSite(e.site.id);e.status='unloaded';this.evictions++}
      if(!next&&e.status==='loading'&&!e.controller.signal.aborted){e.controller.abort();this.aborted++}
    }
    this.pump(now)
  }
  pump(now=performance.now()){
    if(this.disposed||this.running>=this.maxConcurrent)return
    // Only pending demand needs ordering, not the entire city catalog.
    const pending=[...this.entries.values()].filter(e=>e.wanted&&e.status!=='resident'&&e.status!=='loading'&&e.attempts<3&&now>=e.nextTry)
    for(const e of pending.sort((a,b)=>a.distance-b.distance)){
      if(this.running>=this.maxConcurrent)break
      if(!e.wanted||e.status==='resident'||e.status==='loading'||e.attempts>=3||now<e.nextTry)continue
      const controller=new AbortController();e.controller=controller;e.status='loading';e.attempts++;this.running++
      Promise.resolve().then(()=>this.fetchSite(e.site,controller.signal)).then(async site=>{
        await yieldScene()
        // A transport that ignores AbortSignal may still deliver an old region's result.
        if(this.disposed||controller.signal.aborted||!e.wanted)return
        if(site.id!==e.site.id||!Array.isArray(site.buildings))throw Error('Invalid facade site')
        if(this.prepareVisual)await this.facades.prepareSite(site.id,site.buildings,this.prepareVisual)
        else this.facades.addSite(site.id,site.buildings)
        if(this.disposed||controller.signal.aborted||!e.wanted){this.facades.removeSite(site.id);return}
        e.status='resident';this.loads++;e.attempts=0
      }).catch(error=>{
        this.facades.removeSite(e.site.id)
        if(controller.signal.aborted||this.disposed)return
        this.failures++;e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);this.onError(error,e.site)
      }).finally(()=>{
        this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded'
        this.pump()
      })
    }
  }
  dispose(){
    this.disposed=true
    for(const e of this.entries.values()){e.wanted=false;e.controller?.abort();if(e.status==='resident')this.facades.removeSite(e.site.id);e.status='unloaded'}
  }
  diagnostics(){return{resident:[...this.entries.values()].filter(e=>e.status==='resident').map(e=>e.site.id),pending:this.running,loads:this.loads,evictions:this.evictions,aborted:this.aborted,failures:this.failures,
    recipeBytes:[...this.entries.values()].filter(e=>e.status==='resident').reduce((n,e)=>n+e.site.bytes,0),sites:[...this.entries.values()].map(e=>({id:e.site.id,status:e.status,distance:e.distance,attempts:e.attempts}))}}
}
