import * as T from 'three'
import {fetchTile} from './base-tiles.js'
import {surfacePoint} from './surface-frame.js'
import {yieldScene} from './tile-worker-client.js'

const BODY=['#cfc6b4','#b3b8b5','#ab9181','#e1d9c9','#8c9c9c']

/** District silhouettes fill the old height-cutoff gap. One instanced cube kit,
 * immutable source-derived dimensions, no per-building objects or collision. */
export class LowriseStream{
  constructor(base,tiles,{maxBytes=8*1024*1024,maxResident=32,maxConcurrent=1,fadeStart=2000,fadeEnd=2800,fetchData=fetchTile}={}){
    Object.assign(this,{base,maxBytes,maxResident,maxConcurrent,fadeStart,fadeEnd,fetchData})
    this.group=new T.Group();this.group.name='lowrise-districts';base.group.add(this.group)
    this.prototype=new T.BoxGeometry(1,1,1);this.disposed=false;this.running=0;this.last=-Infinity;this.frame=performance.now()
    this.loads=0;this.evictions=0;this.failures=0;this.residents=new Set();this.queue=[]
    this.entries=tiles.map(tile=>{
      const b=tile.bounds,h=tile.heightRange
      const center=new T.Vector3(...surfacePoint(base.study.radius,base.sample,'colony',(b[0]+b[2])/2,(b[1]+b[3])/2,(h[0]+h[1])/2))
      return{tile,sphere:new T.Sphere(center,Math.hypot(b[2]-b[0],b[3]-b[1],h[1]-h[0])*.53),status:'unloaded',wanted:false,alpha:0,attempts:0,nextTry:0}
    })
  }
  mesh(e,data){
    const attributes=data[0]?.attributes.instances
    if(!attributes||attributes.length!==e.tile.instances*9)throw Error('Invalid lowrise district')
    const g=new T.InstancedBufferGeometry()
    for(const [key,a] of Object.entries(this.prototype.attributes))g.setAttribute(key,new T.BufferAttribute(a.array,a.itemSize,a.normalized))
    g.setIndex(new T.BufferAttribute(this.prototype.index.array,1))
    const buffer=new T.InstancedInterleavedBuffer(attributes,9)
    g.setAttribute('lowOrigin',new T.InterleavedBufferAttribute(buffer,3,0))
    g.setAttribute('lowSize',new T.InterleavedBufferAttribute(buffer,3,3))
    g.setAttribute('lowMeta',new T.InterleavedBufferAttribute(buffer,3,6))
    g.instanceCount=e.tile.instances;g.boundingSphere=e.sphere.clone()
    const material=new T.MeshStandardMaterial({color:'#ffffff',roughness:.9})
    e.uniforms={lowWorld:{value:new T.Vector4(this.base.study.radius,this.base.sample.band*Math.PI*2/3,...this.base.sample.anchor.local)},
      lowBounds:{value:new T.Vector4(...this.base.sample.bounds)},
      lowCoverage:{value:this.base.coverage.texture},lowAlpha:{value:0},lowFade:{value:new T.Vector2(this.fadeStart,this.fadeEnd)},lowPalette:{value:BODY.map(c=>new T.Color(c))}}
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,e.uniforms)
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 lowOrigin; attribute vec3 lowSize; attribute vec3 lowMeta;
        uniform vec4 lowWorld; uniform float lowAlpha; uniform vec2 lowFade; uniform vec3 lowPalette[5]; varying float vLowTile; varying vec3 vLowColour; varying vec2 vLowSource; varying float vLowHeight;
        vec3 lowNative(vec3 p){
          float a=(lowOrigin.x+lowWorld.z)/lowWorld.x+lowWorld.y,r=lowWorld.x-lowOrigin.z;
          vec3 worldBase=(modelMatrix*vec4(r*sin(a),-r*cos(a),-(lowOrigin.y+lowWorld.w),1.0)).xyz;
          // Flatten sub-pixel silhouettes into the overview instead of leaving
          // a permanent screen-door pattern over an entire residential district.
          vLowHeight=lowAlpha*(1.0-smoothstep(lowFade.x,lowFade.y,distance(worldBase,cameraPosition)));
          p*=lowSize; float c=cos(lowMeta.x),s=sin(lowMeta.x);
          return vec3(c*p.x-s*p.y,s*p.x+c*p.y,(p.z+lowSize.z*0.5)*vLowHeight)+lowOrigin;
        }
      `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        vec3 source=lowNative(position); float angle=(source.x+lowWorld.z)/lowWorld.x+lowWorld.y;
        float ca=cos(lowMeta.x),sa=sin(lowMeta.x);
        vec3 n=vec3(ca*normal.x-sa*normal.y,sa*normal.x+ca*normal.y,normal.z);
        n.x/=1.0-source.z/lowWorld.x;
        objectNormal=vec3(n.x*cos(angle)-n.z*sin(angle),n.x*sin(angle)+n.z*cos(angle),-n.y);
      `).replace('#include <begin_vertex>',`
        vec3 native=lowNative(position);float a=(native.x+lowWorld.z)/lowWorld.x+lowWorld.y;float r=lowWorld.x-native.z;
        vec3 transformed=vec3(r*sin(a),-r*cos(a),-(native.y+lowWorld.w));
        vLowTile=lowMeta.z;vLowColour=lowPalette[int(lowMeta.y)];vLowSource=native.xy;
      `)
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform sampler2D lowCoverage;uniform vec4 lowBounds;varying float vLowTile;varying vec3 vLowColour;varying vec2 vLowSource;varying float vLowHeight;
      `).replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
        float tile=floor(vLowTile+0.5);
        if(vLowSource.x<lowBounds.x||vLowSource.x>lowBounds.z||vLowSource.y<lowBounds.y||vLowSource.y>lowBounds.w)discard;
        vec2 cover=texture2D(lowCoverage,(vec2(mod(tile,64.0),floor(tile/64.0))+0.5)/64.0).rg;
        if(cover.g>0.5||cover.r>0.5||vLowHeight<0.001)discard;
      `).replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=vLowColour;')
    }
    material.customProgramCacheKey=()=>`metro-lowrise-v4`
    this.base.night?.patchMaterial(material,'','vNightNative=native;',false,true)
    const mesh=new T.Mesh(g,material);mesh.name='lowrise-silhouettes';mesh.receiveShadow=true
    return mesh
  }
  update(eye,{active=true,now=performance.now()}={}){
    if(this.disposed)return
    const dt=Math.max(0,Math.min(100,now-this.frame))/600;this.frame=now
    for(const e of this.residents){
      const target=e.wanted?1:0;e.alpha+=Math.sign(target-e.alpha)*Math.min(dt,Math.abs(target-e.alpha));e.uniforms.lowAlpha.value=e.alpha
      if(!e.wanted&&e.alpha===0)this.release(e)
    }
    if(now-this.last<200){this.pump(now);return}this.last=now
    const local=this.base.group.worldToLocal(eye.clone()),candidates=[]
    for(const e of this.entries){e.distance=Math.max(0,e.sphere.center.distanceTo(local)-e.sphere.radius);if(active&&e.distance<this.fadeEnd)candidates.push(e)}
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+e.tile.decodedBytes<=this.maxBytes){wanted.add(e);bytes+=e.tile.decodedBytes}
    this.queue=[...wanted]
    for(const e of this.entries){
      const next=wanted.has(e);if(e.wanted&&!next){e.attempts=0;e.nextTry=0}
      e.wanted=next;if(!next&&e.status==='loading')e.controller.abort()
    }
    this.pump(now)
  }
  pump(now=performance.now()){
    if(this.disposed||this.running>=this.maxConcurrent||this.residents.size+this.running>=this.maxResident)return
    const resident=[...this.residents];let bytes=resident.reduce((n,e)=>n+e.tile.decodedBytes,0)
    // Selection already orders this bounded queue every 200 ms. A stationary
    // frame must not rescan the entire three-band catalog to find no work.
    for(const e of this.queue){
      if(this.running>=this.maxConcurrent||resident.length+this.running>=this.maxResident)break
      if(['resident','loading'].includes(e.status)||e.attempts>=3||now<e.nextTry||bytes+e.tile.decodedBytes>this.maxBytes)continue
      e.controller=new AbortController();const signal=e.controller.signal;e.status='loading';e.attempts++;this.running++;bytes+=e.tile.decodedBytes
      this.fetchData(e.tile,signal).then(async data=>{
        if(this.disposed||signal.aborted||!e.wanted)return
        await yieldScene();const mesh=this.mesh(e,data)
        try{await this.base.prepareVisual(mesh)}catch(error){mesh.geometry.dispose();mesh.material.dispose();throw error}
        if(this.disposed||signal.aborted||!e.wanted){mesh.geometry.dispose();mesh.material.dispose();return}
        this.group.add(mesh);e.mesh=mesh;e.alpha=0;e.status='resident';this.residents.add(e);e.attempts=0;this.loads++
      }).catch(error=>{
        if(this.disposed||signal.aborted)return
        e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);e.error=String(error);this.failures++
      }).finally(()=>{this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded';this.pump()})
    }
  }
  release(e){e.mesh.removeFromParent();e.mesh.geometry.dispose();e.mesh.material.dispose();e.mesh=null;e.uniforms=null;e.alpha=0;e.status='unloaded';this.residents.delete(e);this.evictions++}
  diagnostics(){const rows=[...this.residents];return{resident:rows.length,pending:this.running,bytes:rows.reduce((n,e)=>n+e.tile.decodedBytes,0),maxBytes:this.maxBytes,instances:rows.reduce((n,e)=>n+e.tile.instances,0),loads:this.loads,evictions:this.evictions,failures:this.failures}}
  dispose(){this.disposed=true;for(const e of this.entries){e.wanted=false;e.controller?.abort();if(e.status==='resident')this.release(e)}this.prototype.dispose();this.group.removeFromParent()}
}
