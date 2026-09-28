import * as T from 'three'
import {fetchTile} from './base-tiles.js'
import {surfacePoint} from './surface-frame.js'
import {tileOrdinal} from './tile-coverage.js'
import {yieldScene} from './tile-worker-client.js'

export const NIGHT_PANE_BYTES=8*1024*1024
export const NIGHT_PANE_TILES=80

// Emissive openings, not a second set of buildings. The source-body ownership
// mask suppresses these on the deliberately coarser district silhouettes.
export class NightPaneStream{
  constructor(base,facade,tiles,field,{fetchData=fetchTile,maxBytes=NIGHT_PANE_BYTES,maxResident=NIGHT_PANE_TILES,loadDistance=2200}={}){
    Object.assign(this,{base,facade,field,fetchData,maxBytes,maxResident,loadDistance})
    this.group=new T.Group();this.group.name='metro-night-panes';base.group.add(this.group)
    this.prototype=new T.PlaneGeometry(1,1);this.last=-Infinity;this.frame=performance.now();this.running=0;this.disposed=false
    this.loads=0;this.evictions=0;this.failures=0;this.aborted=0;this.residents=new Set();this.nearTiles=new Set()
    this.entries=tiles.filter(t=>t.instances>0).map(tile=>{
      const b=tile.bounds,h=tile.heightRange,centre=new T.Vector3(...surfacePoint(base.study.radius,base.sample,'colony',(b[0]+b[2])/2,(b[1]+b[3])/2,(h[0]+h[1])/2))
      return{tile,ordinal:tileOrdinal(tile.id),centre,radius:Math.hypot(b[2]-b[0],b[3]-b[1],h[1]-h[0])*.53,status:'unloaded',wanted:false,alpha:0,attempts:0,nextTry:0}
    })
    facade.uniforms.kitNightCoverage=field.uniforms.metroNightPanes
    facade.uniforms.kitNightTransition.value=0
  }
  mesh(e,values){
    if(!(values instanceof Float32Array)||values.length!==e.tile.instances*10)throw Error('Invalid night pane tile')
    const g=new T.InstancedBufferGeometry()
    for(const [key,a] of Object.entries(this.prototype.attributes))g.setAttribute(key,new T.BufferAttribute(a.array,a.itemSize,a.normalized))
    g.setIndex(new T.BufferAttribute(this.prototype.index.array,1))
    const buffer=new T.InstancedInterleavedBuffer(values,10)
    for(const [key,size,offset] of [['paneOrigin',3,0],['paneU',2,3],['paneSize',2,5],['paneLight',3,7]])g.setAttribute(key,new T.InterleavedBufferAttribute(buffer,size,offset))
    g.instanceCount=e.tile.instances;g.boundingSphere=new T.Sphere(e.centre,e.radius+2)
    // The facade's two-triangle LOD lies 57 mm outside the source wall.
    // A 1 mm gap loses depth precision at city scale and cuts panes diagonally.
    const material=new T.MeshBasicMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.FrontSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})
    const uniforms={paneWorld:{value:new T.Vector4(this.base.study.radius,this.base.sample.band*Math.PI*2/3,...this.base.sample.anchor.local)},
      paneTile:{value:e.ordinal},paneOwnership:{value:this.base.coverage.texture},...this.field.uniforms}
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,uniforms)
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 paneOrigin; attribute vec2 paneU; attribute vec2 paneSize; attribute vec3 paneLight;
        uniform vec4 paneWorld; varying vec3 vPaneLight; varying float vPaneDistance;
      `).replace('#include <begin_vertex>',`
        vec3 native=paneOrigin+vec3(paneU*position.x*paneSize.x+vec2(paneU.y,-paneU.x)*.12,(position.y+.5)*paneSize.y);
        float a=(native.x+paneWorld.z)/paneWorld.x+paneWorld.y,r=paneWorld.x-native.z;
        vec3 transformed=vec3(r*sin(a),-r*cos(a),-(native.y+paneWorld.w));vPaneLight=paneLight;
      `).replace('#include <project_vertex>','#include <project_vertex>\nvPaneDistance=length(mvPosition.xyz);')
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform float paneTile; uniform sampler2D paneOwnership; uniform sampler2D metroNightPanes; uniform float metroNight;
        varying vec3 vPaneLight; varying float vPaneDistance;
      `).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 uv=(vec2(mod(paneTile,64.0),floor(paneTile/64.0))+.5)/64.0;
        vec2 ownership=texture2D(paneOwnership,uv).rg;
        if(max(ownership.x,ownership.y)<.5)discard;
        vec2 blend=texture2D(metroNightPanes,uv).rg;
        float nearWeight=1.0-blend.y*(1.0-smoothstep(140.0,280.0,vPaneDistance));
        diffuseColor.rgb=vPaneLight;
        diffuseColor.a*=metroNight*blend.x*nearWeight*(1.0-smoothstep(1300.0,2000.0,vPaneDistance));
      `).replace('#include <fog_fragment>',T.ShaderChunk.fog_fragment.replace('fogColor','vec3(0.0)'))
    }
    material.customProgramCacheKey=()=>`metro-night-panes-v1`
    const mesh=new T.Mesh(g,material);mesh.name=`night-windows-${e.tile.id}`;mesh.userData.nightPane=true;return mesh
  }
  update(eye,{active=true,now=performance.now()}={}){
    if(this.disposed)return
    // Keep the existing facade glow until the replacement lighting is ready,
    // including a slow or failed field download; movement never waits for it.
    this.facade.uniforms.kitNightTransition.value=this.field.fade
    const dt=Math.min(.1,Math.max(0,(now-this.frame)/1000));this.frame=now
    const values=this.field.paneValues;let changed=false
    const nearSites=new Set(this.facade.chunks.filter(c=>c.level!=='far'&&!c.preparing).map(c=>c.site))
    // Per-frame fading touches at most 80 residents, never all 3,400 tiles.
    for(const e of this.residents){
      const owned=!!(this.base.coverage.values[e.ordinal*4]||this.base.coverage.values[e.ordinal*4+1])
      // Prefetching must not finish the fade while the corresponding source
      // wall is still absent; that made whole blocks light up in one frame.
      e.alpha=T.MathUtils.clamp(e.alpha+(e.wanted&&owned?dt*2:-dt*2),0,1)
      if(!e.wanted&&e.alpha===0)this.release(e)
      else e.mesh.visible=owned
      const i=e.ordinal*4,r=Math.round(e.alpha*255)
      if(values[i]!==r){values[i]=r;changed=true}
    }
    for(const id of new Set([...this.nearTiles,...nearSites])){
      const i=tileOrdinal(id)*4+1,g=nearSites.has(id)?255:0
      if(values[i]!==g){values[i]=g;changed=true}
    }
    this.nearTiles=nearSites
    if(changed)this.field.paneTexture.needsUpdate=true
    this.group.visible=this.field.uniforms.metroNight.value>.001
    if(now-this.last<200)return;this.last=now
    const local=this.base.group.worldToLocal(eye.clone()),candidates=[]
    for(const e of this.entries){e.distance=Math.max(0,e.centre.distanceTo(local)-e.radius);if(active&&e.distance<this.loadDistance)candidates.push(e)}
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+e.tile.decodedBytes<=this.maxBytes){wanted.add(e);bytes+=e.tile.decodedBytes}
    for(const e of this.entries){const next=wanted.has(e);if(e.wanted&&!next){e.attempts=0;e.nextTry=0}e.wanted=next;if(!next&&e.status==='loading'&&!e.controller.signal.aborted){e.controller.abort();this.aborted++}}
    this.pump(now)
  }
  pump(now=performance.now()){
    if(this.disposed||this.running)return
    const resident=[...this.residents],bytes=resident.reduce((n,e)=>n+e.tile.decodedBytes,0)
    const e=this.entries.filter(e=>e.wanted&&!['resident','loading'].includes(e.status)&&e.attempts<3&&now>=e.nextTry).sort((a,b)=>a.distance-b.distance)[0]
    if(!e||resident.length>=this.maxResident||bytes+e.tile.decodedBytes>this.maxBytes)return
    e.controller=new AbortController();const signal=e.controller.signal;e.status='loading';e.attempts++;this.running++
    this.fetchData(e.tile,signal).then(async data=>{
      await yieldScene();if(this.disposed||signal.aborted||!e.wanted)return
      const mesh=this.mesh(e,data[0]?.attributes.instances)
      try{await this.base.prepareVisual(mesh)}catch(error){mesh.geometry.dispose();mesh.material.dispose();throw error}
      if(this.disposed||signal.aborted||!e.wanted){mesh.geometry.dispose();mesh.material.dispose();return}
      e.mesh=mesh;this.group.add(mesh);e.status='resident';this.residents.add(e);e.attempts=0;this.loads++
    }).catch(error=>{if(this.disposed||signal.aborted)return;e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);e.error=String(error);this.failures++})
      .finally(()=>{this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded';this.pump()})
  }
  release(e){e.mesh.removeFromParent();e.mesh.geometry.dispose();e.mesh.material.dispose();e.mesh=null;e.alpha=0;e.status='unloaded';this.residents.delete(e);this.evictions++}
  diagnostics(){const rows=[...this.residents];return{resident:rows.length,bytes:rows.reduce((n,e)=>n+e.tile.decodedBytes,0),instances:rows.reduce((n,e)=>n+e.tile.instances,0),maxBytes:this.maxBytes,maxResident:this.maxResident,pending:this.running,loads:this.loads,failures:this.failures,aborted:this.aborted}}
  dispose(){this.disposed=true;for(const e of this.entries){e.wanted=false;e.controller?.abort();if(e.status==='resident')this.release(e)}this.prototype.dispose();this.group.removeFromParent()}
}
