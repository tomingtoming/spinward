import * as T from 'three'
import {surfacePoint,surfaceAngle} from './surface-frame.js'
import {FarStream} from './far-stream.js'
import {createSharedTileSource} from './shared-tile-source.js'
import {decodeTileAsync,yieldScene} from './tile-worker-client.js'
import {metroDataURL} from './data-source.js'

export const nativeTiles=createSharedTileSource(async(descriptor,signal)=>{
  const r=await fetch(metroDataURL(descriptor.path),{signal});if(!r.ok)throw Error(`${r.status} ${descriptor.path}`)
  // Vite serves .gz with Content-Encoding; browsers decompress that automatically.
  // Static object stores may instead return the compressed bytes as octet-stream.
  return decodeTileAsync(await r.arrayBuffer(),descriptor.decodedBytes)
})
export const fetchTile=(descriptor,signal)=>nativeTiles.get(descriptor,signal)

// Original ground triangles are identical in both levels. Replacement is atomic:
// a far triangle is removed only once its complete near tile has been constructed.
export class BaseTiles{
  constructor(study,sample,manifest,overview,{fetchNear=fetchTile,maxResident=25,maxBytes=12*1024*1024,maxConcurrent=2,loadDistance=180,evictDistance=260,farOptions={},onError=()=>{},initialMode='flat',prepareVisual=async()=>{}}={}){
    Object.assign(this,{study,sample,manifest,fetchNear,maxResident,maxBytes,maxConcurrent,loadDistance,evictDistance,farOptions,onError,prepareVisual})
    this.group=new T.Group();this.group.name='base-tiles';this.mode=initialMode;this.far=[]
    this.entries=new Map(manifest.tiles.map(t=>[t.id,{tile:t,status:'unloaded',wanted:false,attempts:0,nextTry:0,meshes:[]}]))
    this.running=0;this.loads=0;this.evictions=0;this.failures=0;this.aborted=0;this.lastUpdate=-Infinity;this.disposed=false
    for(const data of overview)this.addOverview(data)
    this.farStream=manifest.farTiles?new FarStream(this,fetchNear,farOptions):null
  }
  addOverview(data,mesh=this.mesh(data,'overview')){this.far.push({mesh,segments:data.segments,indices:data.attributes.index});this.group.add(mesh)}
  setFarCatalog(tiles){
    if(this.farStream)throw Error('Far catalog already installed')
    this.manifest.farTiles=tiles;this.farStream=new FarStream(this,this.fetchNear,this.farOptions)
  }
  mesh(data,level){
    const a=data.attributes,g=new T.BufferGeometry()
    for(const [key,array] of Object.entries(a)){
      if(key==='index')g.setIndex(new T.BufferAttribute(array.slice(),1))
      else g.setAttribute(key,new T.BufferAttribute(data.projected?.[key]??(key==='color'?array:array.slice()),key==='closedShell'?1:3))
    }
    const overlay=!data.solid&&!['terrain','buildings','foundations'].includes(data.name)
    const material=new T.MeshStandardMaterial({color:a.color?'#ffffff':data.colour,vertexColors:!!a.color,roughness:data.roughness,side:T.DoubleSide,flatShading:!a.normal,
      polygonOffset:overlay,polygonOffsetFactor:overlay?-1:0,polygonOffsetUnits:overlay?-4:0})
    const mesh=new T.Mesh(g,material);mesh.name=data.name;mesh.userData={level,native:a}
    mesh.castShadow=data.name==='buildings'||data.name==='bridge-decks'||data.name.startsWith('park-tree');mesh.receiveShadow=true
    if(data.projected&&this.mode==='colony')g.computeBoundingSphere();else this.transform(mesh)
    return mesh
  }
  transform(mesh){
    const a=mesh.userData.native,p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal
    for(let i=0;i<a.position.length;i+=3){
      const x=a.position[i],y=a.position[i+1],h=a.position[i+2]
      p.array.set(surfacePoint(this.study.radius,this.sample,this.mode,x,y,h),i)
      const angle=this.mode==='flat'?0:surfaceAngle(this.study.radius,this.sample,this.mode,x),c=Math.cos(angle),s=Math.sin(angle)
      // Inverse transpose of the cylinder's Jacobian, with native global normals.
      // Keeping those normals across tile boundaries avoids lighting seams.
      if(!a.normal)continue
      const nx=a.normal[i]/(this.mode==='flat'?1:1-h/this.study.radius),ny=a.normal[i+1],nz=a.normal[i+2],l=Math.hypot(nx,ny,nz)||1
      n.array.set([(nx*c-nz*s)/l,(nx*s+nz*c)/l,-ny/l],i)
    }
    p.needsUpdate=true;if(n)n.needsUpdate=true;mesh.geometry.computeBoundingSphere()
  }
  updateMode(mode){if(this.mode===mode)return;this.mode=mode;for(const m of this.group.children)if(m.isMesh)this.transform(m)}
  refreshFar(){
    this.coverage?.nearTiles([...this.entries.values()].filter(e=>e.status==='resident').map(e=>e.tile.id))
    const distant=this.farStream?.resident??[],covered=new Set(distant.flatMap(e=>e.tile.tiles))
    const refs=[...this.far,...distant.flatMap(e=>e.meshes)]
    for(const f of refs){let count=0;const out=f.mesh.geometry.index
      const visible=f.segments.filter(segment=>this.entries.get(segment.tile).status!=='resident'&&!(!this.coverage&&this.far.includes(f)&&covered.has(segment.tile)))
      // Most loads affect one ownership tile, not all thirty overview meshes.
      // Do not recopy or reupload a distant buffer whose visibility is unchanged.
      if(f.visibleSegments&&visible.length===f.visibleSegments.length&&visible.every((s,i)=>s===f.visibleSegments[i]))continue
      f.visibleSegments=visible
      for(const segment of visible){
        out.array.set((segment.indices??f.indices).subarray(segment.first,segment.first+segment.count),count);count+=segment.count
      }
      out.needsUpdate=true;f.mesh.geometry.setDrawRange(0,count);f.mesh.visible=count>0
    }
  }
  release(e){
    for(const m of e.meshes){this.group.remove(m);m.geometry.dispose();m.material.dispose();m.userData={}}
    e.meshes=[];e.status='unloaded';this.evictions++
  }
  update(cameraWorld,{active=true,now=performance.now(),force=false,direction,visible=true,overview=false,distant=true,allowedTiles=null}={}){
    if(this.disposed||(!force&&now-this.lastUpdate<150))return;this.lastUpdate=now
    if(distant)this.farStream?.update(cameraWorld,{direction,visible,overview,now})
    const local=this.group.worldToLocal(cameraWorld.clone()),candidates=[]
    for(const e of this.entries.values()){
      if(e.boundsMode!==this.mode){
        const b=e.tile.bounds,h=e.tile.heightRange,centre=[(b[0]+b[2])/2,(b[1]+b[3])/2,(h[0]+h[1])/2]
        e.centre=new T.Vector3(...surfacePoint(this.study.radius,this.sample,this.mode,...centre));e.radius=Math.hypot(b[2]-b[0],b[3]-b[1],h[1]-h[0])/2*1.04;e.boundsMode=this.mode
      }
      e.distance=Math.max(0,local.distanceTo(e.centre)-e.radius)
      if(active&&(!allowedTiles||allowedTiles.has(e.tile.id))&&e.distance<(e.status==='resident'?this.evictDistance:this.loadDistance))candidates.push(e)
    }
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+(e.decodedBytes??e.tile.decodedBytes)<=this.maxBytes){wanted.add(e.tile.id);bytes+=e.decodedBytes??e.tile.decodedBytes}
    let changed=false
    for(const e of this.entries.values()){
      const next=wanted.has(e.tile.id);if(e.wanted&&!next){e.attempts=0;e.nextTry=0}e.wanted=next
      if(!next&&e.status==='resident'){this.release(e);changed=true}
      if(!next&&e.status==='loading'&&!e.controller.signal.aborted){e.controller.abort();this.aborted++}
    }
    if(changed)this.refreshFar();this.pump(now)
  }
  pump(now=performance.now()){
    if(this.disposed||this.running>=this.maxConcurrent)return
    // Only pending demand needs ordering, not the entire city catalog.
    const pending=[...this.entries.values()].filter(e=>e.wanted&&e.status!=='resident'&&e.status!=='loading'&&e.attempts<3&&now>=e.nextTry)
    for(const e of pending.sort((a,b)=>a.distance-b.distance)){
      if(this.running>=this.maxConcurrent)break
      if(!e.wanted||e.status==='resident'||e.status==='loading'||e.attempts>=3||now<e.nextTry)continue
      const controller=new AbortController();e.controller=controller;e.status='loading';e.attempts++;this.running++
      Promise.resolve().then(()=>this.fetchNear(e.tile,controller.signal)).then(async data=>{
        if(this.disposed||controller.signal.aborted||!e.wanted){for(const d of data)d.bitmap?.close();return}
        e.decodedBytes=e.tile.decodedBytes+(data.extraDecodedBytes??0)
        // Reconsider the wanted set next update with the measured refined size.
        // Never attach meshes that would exceed the resident array budget.
        if(this.diagnostics().nearDecodedBytes+e.decodedBytes>this.maxBytes){e.wanted=false;e.attempts=0;e.nextTry=performance.now()+200;for(const d of data)d.bitmap?.close();return}
        const meshes=[]
        try{for(const d of data){await yieldScene();if(this.disposed||controller.signal.aborted||!e.wanted)break;const mesh=this.mesh(d,'near');meshes.push(mesh);await this.prepareVisual(mesh)}}catch(error){for(const m of meshes){m.geometry.dispose();m.material.dispose()}for(const d of data)d.bitmap?.close();throw error}
        if(this.disposed||controller.signal.aborted||!e.wanted||this.diagnostics().nearDecodedBytes+e.decodedBytes>this.maxBytes){e.attempts=0;e.nextTry=performance.now()+200;for(const m of meshes){m.geometry.dispose();m.material.dispose()}for(const d of data)d.bitmap?.close();return}
        e.meshes=meshes;for(const m of meshes)this.group.add(m);e.status='resident';e.attempts=0;this.loads++;this.refreshFar()
      }).catch(error=>{
        if(controller.signal.aborted||this.disposed)return
        e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);this.failures++;this.onError(error,e.tile)
      }).finally(()=>{this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded';this.pump()})
    }
  }
  diagnostics(){return{resident:[...this.entries.values()].filter(e=>e.status==='resident').map(e=>e.tile.id),pending:this.running,loads:this.loads,evictions:this.evictions,failures:this.failures,aborted:this.aborted,
    nearDecodedBytes:[...this.entries.values()].filter(e=>e.status==='resident').reduce((n,e)=>n+(e.decodedBytes??e.tile.decodedBytes),0),overviewDecodedBytes:this.manifest.overview.decodedBytes,far:this.farStream?.diagnostics(),
    triangles:[...new Set([...this.group.children,...this.far.map(f=>f.mesh)])].filter(m=>m.isMesh&&m.visible&&m.parent?.visible).reduce((n,m)=>n+Math.min(m.geometry.index.count,m.geometry.drawRange.count)/3,0)}}
  get ready(){return (!this.farStream||this.farStream.ready)&&[...this.entries.values()].every(e=>!e.wanted||e.status==='resident')}
  retry(){
    for(const e of this.entries.values())if(e.status==='failed'){e.attempts=0;e.nextTry=0}
    this.pump();this.farStream?.retry()
  }
  dispose(){this.disposed=true;this.farStream?.dispose();for(const e of this.entries.values()){e.wanted=false;e.controller?.abort();if(e.status==='resident')this.release(e)}for(const {mesh} of this.far){mesh.geometry.dispose();mesh.material.dispose();mesh.userData={}}this.far=[];this.group.clear()}
}
