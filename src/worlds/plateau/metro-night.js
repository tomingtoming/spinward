import * as T from 'three'
import {surfacePoint} from './surface-frame.js'
import {fetchTile} from './base-tiles.js'
import {frontageLight} from './frontage-light.js'
import {ObstructionLights} from './obstruction-lights.js'
import {bakeLocalLight,LOCAL_LIGHT_SIZE} from './local-light-field.js'
import {metroDataURL} from './data-source.js'

export const NIGHT_FIXTURE_LIMIT=512
const black=()=>{const t=new T.DataTexture(new Uint8Array([0,0,0,255]),1,1);t.needsUpdate=true;return t}
const nightDeclarations=`
uniform sampler2D metroNightPools; uniform sampler2D metroNightWalls;
uniform float metroNightProxy; uniform float metroNight; varying vec3 vNightNative;
uniform sampler2D metroNightLocalMap; uniform vec4 metroNightLocalBounds;
`
const fieldUV=`vec2 nightUV=(vNightNative.xy-vec2(-1700.0,-20000.0))/vec2(3400.0,40000.0);`
const nightGround=`
${fieldUV}
float nightDistance=length(vViewPosition);
vec3 roadLight=nightDistance>85.0?texture2D(metroNightPools,nightUV).rgb:vec3(0.0);
if(nightDistance<120.0){
  vec2 localUV=(vNightNative.xy-metroNightLocalBounds.xy)/metroNightLocalBounds.zw;
  vec3 closeLight=texture2D(metroNightLocalMap,clamp(localUV,vec2(0.0),vec2(1.0))).rgb;
  closeLight*=step(0.0,localUV.x)*step(0.0,localUV.y)*step(localUV.x,1.0)*step(localUV.y,1.0);
  roadLight=mix(closeLight,roadLight,smoothstep(85.0,120.0,nightDistance));
}
if(nightDistance>1800.0)roadLight+=texture2D(metroNightWalls,nightUV).rgb*.32*smoothstep(1800.0,2800.0,nightDistance);
totalEmissiveRadiance+=metroNight*roadLight;
`
const nightWall=`
${fieldUV}
float farWeight=mix(smoothstep(1300.0,2000.0,length(vViewPosition)),smoothstep(180.0,320.0,length(vViewPosition)),metroNightProxy);
if(farWeight>.00001){
vec3 sourceNormal=normalize(cross(dFdx(vNightNative),dFdy(vNightNative)));
float wall=1.0-smoothstep(.15,.65,abs(sourceNormal.z));
vec3 light=texture2D(metroNightWalls,nightUV).rgb;
totalEmissiveRadiance+=metroNight*light*wall*farWeight;
}
`

export class NightField{
  constructor(descriptor){
    this.descriptor=descriptor;this.pools=black();this.walls=black();this.disposed=false
    this.paneValues=new Uint8Array(64*64*4);this.paneTexture=new T.DataTexture(this.paneValues,64,64);this.paneTexture.needsUpdate=true
    this.localData=new Uint8Array(LOCAL_LIGHT_SIZE**2*4);this.localWork=new Float32Array(LOCAL_LIGHT_SIZE**2*3)
    this.localMap=new T.DataTexture(this.localData,LOCAL_LIGHT_SIZE,LOCAL_LIGHT_SIZE);this.localMap.minFilter=T.LinearFilter;this.localMap.magFilter=T.LinearFilter;this.localMap.needsUpdate=true
    this.uniforms={metroNightPanes:{value:this.paneTexture},metroNightPools:{value:this.pools},metroNightWalls:{value:this.walls},metroNight:{value:0},
      metroNightLocalMap:{value:this.localMap},metroNightLocalBounds:{value:new T.Vector4(0,0,LOCAL_LIGHT_SIZE,LOCAL_LIGHT_SIZE)}}
    this.ready=false;this.fade=0;this.daylight=1;this.errors=[]
  }
  async load(signal){
    // Texture objects are stable: residents and in-flight prepared materials
    // observe the same update without compiling a new shader on arrival.
    for(const key of ['pools','walls']){
      const r=await fetch(metroDataURL(this.descriptor[key]),{signal});if(!r.ok)throw Error(`Night field: ${r.status}`)
      const bitmap=await createImageBitmap(await r.blob(),{imageOrientation:'flipY'})
      if(this.disposed||signal.aborted){bitmap.close();return}
      const old=this[key],t=new T.Texture(bitmap);this[key]=t;
      this.uniforms[key==='pools'?'metroNightPools':'metroNightWalls'].value=t;old.dispose();t.flipY=false;t.format=T.RGBAFormat;t.type=T.UnsignedByteType
      // Values are linear irradiance, not an sRGB photograph.
      t.colorSpace=T.NoColorSpace;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter
      t.generateMipmaps=true;t.needsUpdate=true
    }
    this.ready=true
  }
  setDaylight(daylight){this.daylight=daylight;this.uniforms.metroNight.value=T.MathUtils.smoothstep(1-daylight,.1,.78)*this.fade}
  update(dt){this.fade=Math.min(1,this.fade+(this.ready?dt*2:0));this.setDaylight(this.daylight)}
  patch(mesh,data,level){
    const ground=['terrain','source-surface-detail'].includes(data.name),building=data.name==='buildings'
    if(!ground&&!building)return
    mesh.geometry.setAttribute('nightNative',new T.BufferAttribute(data.attributes.position,3))
    this.patchMaterial(mesh.material,'attribute vec3 nightNative;', 'vNightNative=nightNative;', ground,level==='overview')
  }
  patchMaterial(material,declaration,assignment,ground=false,proxy=false){
    const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material),key=cache()
    material.onBeforeCompile=(shader,renderer)=>{
      previous.call(material,shader,renderer);Object.assign(shader.uniforms,this.uniforms,{metroNightProxy:{value:proxy?1:0}})
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${declaration}\nvarying vec3 vNightNative;`)
        .replace('#include <project_vertex>',`${assignment}\n#include <project_vertex>`)
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${nightDeclarations}`)
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>\nif(metroNight>.001){${ground?nightGround:nightWall}}`)
    }
    material.customProgramCacheKey=()=>`${key}-night-v4-${ground?'ground':'wall'}-${proxy?'proxy':'source'}`
  }
  bakeLocal(x,y,sources){
    const bounds=[Math.floor(x/8)*8-LOCAL_LIGHT_SIZE/2,Math.floor(y/8)*8-LOCAL_LIGHT_SIZE/2]
    bakeLocalLight(this.localData,this.localWork,bounds,sources);this.localMap.needsUpdate=true
    this.uniforms.metroNightLocalBounds.value.set(...bounds,LOCAL_LIGHT_SIZE,LOCAL_LIGHT_SIZE)
  }
  dispose(){this.disposed=true;this.paneTexture.dispose();this.localMap.dispose();for(const t of [this.pools,this.walls]){t.image?.close?.();t.dispose()}}
}

const yAxis=new T.Vector3(0,1,0)
export class MetroNight{
  constructor(study,manifest,{defer=false,loadFixtures=fetchTile}={}){
    this.study=study;this.manifest=manifest;this.group=new T.Group();this.group.name='metro-night-fixtures'
    this.fields=new Map(study.samples.map(s=>[s.id,new NightField(manifest.bands[s.id])]))
    this.cells=new Map();this.buffers=new Map();this.count=0;this.revision=0;this.selected=[];this.sources=[];this.lastEye=null;this.lastRevision=-1
    this.frontageCache=new Map();this.frontages=[];this.lastFrontageEye=null
    this.obstruction=manifest.obstruction?new ObstructionLights(study,manifest.obstruction):null
    if(this.obstruction)this.group.add(this.obstruction.group)
    this.controller=new AbortController();this.disposed=false;this.loaded=0;this.failures=[]
    this.loadFixtures=loadFixtures;this.attempts=0;this.retryAt=0
    this.poleMaterial=new T.MeshStandardMaterial({color:'#686c67',roughness:.8})
    this.headMaterial=new T.MeshBasicMaterial({color:'#f2d6a3'})
    this.poles=new T.InstancedMesh(new T.CylinderGeometry(.065,.09,1,6),this.poleMaterial,NIGHT_FIXTURE_LIMIT)
    this.arms=new T.InstancedMesh(new T.CylinderGeometry(.045,.045,1,6),this.poleMaterial,NIGHT_FIXTURE_LIMIT)
    this.heads=new T.InstancedMesh(new T.BoxGeometry(.6,.13,.28),this.headMaterial,NIGHT_FIXTURE_LIMIT)
    for(const [name,m] of [['posts',this.poles],['arms',this.arms],['heads',this.heads]]){
      m.name=`metro-lamp-${name}`;m.count=0;m.frustumCulled=false;m.receiveShadow=true;this.group.add(m)
    }
    if(!defer)this.start()
  }
  start(){
    if(this.loading)return this.loading
    if(this.disposed||this.loaded===this.study.samples.length||this.attempts>=3||performance.now()<this.retryAt)return
    this.attempts++
    return this.loading=this.load().finally(()=>{this.loading=null;this.retryAt=performance.now()+500*2**(this.attempts-1)})
  }
  retry(){this.attempts=0;this.retryAt=0;return this.start()}
  async load(){
    this.failures=[]
    for(const sample of this.study.samples){
      if(this.disposed)return
      if(this.buffers.has(sample.id))continue
      try{
        const descriptor=this.manifest.bands[sample.id]
        const field=this.fields.get(sample.id)
        if(!field.ready)await field.load(this.controller.signal)
        const data=await this.loadFixtures(descriptor.lamps,this.controller.signal)
        if(this.disposed)return
        const values=data[0]?.attributes.instances
        if(!values||values.length!==descriptor.count*7)throw Error('Invalid night fixture count')
        this.buffers.set(sample.id,values)
        for(let i=0;i<descriptor.count;i++){
          const x=values[i*7],y=values[i*7+1]
          const key=`${sample.band}:${Math.floor(x/200)}:${Math.floor(y/200)}`
          if(!this.cells.has(key))this.cells.set(key,[])
          this.cells.get(key).push(i);this.count++
        }
        this.loaded++;this.revision++
      }catch(error){if(!this.disposed)this.failures.push(String(error))}
    }
  }
  updateFrontages(local,layers){
    let changed=false
    for(const l of layers){
      const id=l.base.sample.id,facade=l.facade,cached=this.frontageCache.get(id)
      if(cached?.revision===facade.revision)continue
      const rows=[]
      for(const part of facade.design.parts){
        const source=frontageLight(part);if(!source)continue
        const p=source.origin,sample=l.base.sample
        const head=new T.Vector3(...surfacePoint(this.study.radius,sample,'colony',...p))
        const up=new T.Vector3(...surfacePoint(this.study.radius,sample,'colony',p[0],p[1],p[2]+1)).sub(head).normalize()
        const outward=new T.Vector3(...surfacePoint(this.study.radius,sample,'colony',p[0]+source.normal[0],p[1]+source.normal[1],p[2])).sub(head).normalize()
        rows.push({...source,id:`front:${id}:${source.id}`,band:id,head,down:up.negate().addScaledVector(outward,.75).normalize(),
          linear:new T.Color(source.colour).multiplyScalar(source.strength*.35)})
      }
      this.frontageCache.set(id,{revision:facade.revision,rows});changed=true
    }
    if(!changed&&this.lastFrontageEye?.distanceToSquared(local)<8**2)return
    this.lastFrontageEye=local.clone()
    this.localDirty=true
    this.frontages=[...this.frontageCache.values()].flatMap(c=>c.rows).map(row=>({row,distance:row.head.distanceToSquared(local)}))
      .filter(c=>c.distance<150**2).sort((a,b)=>a.distance-b.distance).slice(0,128).map(c=>c.row)
  }
  updateLocalFields(local){
    if(!this.localDirty)return;this.localDirty=false
    for(const sample of this.study.samples){
      const a=Math.atan2(local.x,-local.y)-sample.band*Math.PI*2/3
      const x=Math.atan2(Math.sin(a),Math.cos(a))*this.study.radius-sample.anchor.local[0],y=-local.z-sample.anchor.local[1]
      const field=this.fields.get(sample.id)
      const lamps=this.selected.filter(r=>r.band===sample.id).map(r=>({x:r.nativeHead.x,y:r.nativeHead.y,radius:12.24,colour:[.115*r.power,.086*r.power,.052*r.power]}))
      const fronts=this.frontages.filter(r=>r.band===sample.id).map(r=>({x:r.origin[0],y:r.origin[1],radius:r.radius,width:r.width,height:r.height,normal:r.normal,
        colour:r.linear.clone().multiplyScalar(1-T.MathUtils.smoothstep(r.height,6,9)).toArray()}))
      if(lamps.length||fronts.length||field.localActive)field.bakeLocal(x,y,[...lamps,...fronts])
      field.localActive=lamps.length+fronts.length>0
    }
  }
  update(eye,layers=[]){
    this.obstruction?.update(eye)
    const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-(this.lastFrame??now))/1000));this.lastFrame=now
    for(const field of this.fields.values())field.update(dt)
    const local=this.group.worldToLocal(eye.clone())
    this.updateFrontages(local,layers)
    if(this.lastEye&&this.lastEye.distanceToSquared(local)<20**2&&this.lastRevision===this.revision){this.updateLocalFields(local);return}
    this.lastEye=local.clone();this.lastRevision=this.revision
    const radius=this.study.radius,azimuth=Math.atan2(local.x,-local.y),axial=-local.z,candidates=[]
    for(const sample of this.study.samples){
      const a=azimuth-sample.band*Math.PI*2/3
      const x=Math.atan2(Math.sin(a),Math.cos(a))*radius-sample.anchor.local[0],y=axial-sample.anchor.local[1]
      for(let ix=Math.floor((x-450)/200);ix<=Math.floor((x+450)/200);ix++)for(let iy=Math.floor((y-450)/200);iy<=Math.floor((y+450)/200);iy++){
        const values=this.buffers.get(sample.id)
        for(const i of this.cells.get(`${sample.band}:${ix}:${iy}`)??[]){
          const [x,y,z,nx,ny,h]=values.subarray(i*7,i*7+6)
          const head=new T.Vector3(...surfacePoint(radius,sample,'colony',x+nx*1.5,y+ny*1.5,z+h))
          const distance=head.distanceToSquared(local)
          if(distance<450**2)candidates.push({sample,i,head,distance})
        }
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance)
    this.selected=candidates.slice(0,NIGHT_FIXTURE_LIMIT).map(c=>{
      const [x,y,z,nx,ny,h,power]=this.buffers.get(c.sample.id).subarray(c.i*7,c.i*7+7)
      const point=(h)=>new T.Vector3(...surfacePoint(radius,c.sample,'colony',x,y,h))
      const base=point(z),top=point(z+h-.25),up=point(z+1).sub(base).normalize()
      return{id:`${c.sample.id}:${c.i}`,band:c.sample.id,base,top,up,head:c.head,nativeHead:new T.Vector3(x+nx*1.5,y+ny*1.5,z+h),power}
    })
    const matrix=new T.Matrix4(),q=new T.Quaternion(),scale=new T.Vector3(1,1,1)
    const cylinder=(mesh,i,a,b)=>{const delta=b.clone().sub(a);q.setFromUnitVectors(yAxis,delta.clone().normalize());scale.set(1,delta.length(),1);matrix.compose(a.clone().add(b).multiplyScalar(.5),q,scale);mesh.setMatrixAt(i,matrix)}
    this.selected.forEach((row,i)=>{
      cylinder(this.poles,i,row.base,row.top);cylinder(this.arms,i,row.top,row.head)
      const right=row.head.clone().sub(row.top).normalize(),forward=right.clone().cross(row.up).normalize(),up=forward.clone().cross(right).normalize()
      matrix.makeBasis(right,up,forward);matrix.setPosition(row.head);this.heads.setMatrixAt(i,matrix)
    })
    for(const m of [this.poles,this.arms,this.heads]){m.count=this.selected.length;m.instanceMatrix.needsUpdate=true}
    // Only a bounded neighbourhood enters the already bounded real-light pool.
    this.sources=this.selected.slice(0,32)
    this.localDirty=true;this.updateLocalFields(local)
  }
  lightsFor(target){
    this.group.updateWorldMatrix(true,false);target.updateWorldMatrix(true,false)
    const matrix=new T.Matrix4().copy(target.matrixWorld).invert().multiply(this.group.matrixWorld)
    return [...this.sources,...this.frontages].sort((a,b)=>a.head.distanceToSquared(this.lastEye)-b.head.distanceToSquared(this.lastEye)).slice(0,32)
      .map(row=>({id:row.id,position:row.head.clone().applyMatrix4(matrix),down:(row.down??row.up.clone().negate()).clone().transformDirection(matrix),
        color:row.colour??'#ffdfb5',intensity:row.intensity??95*row.power,distance:row.radius?row.radius*1.7:28,angle:row.radius?Math.PI/2.6:Math.PI/3}))
  }
  setDaylight(value){this.obstruction?.setDaylight(value);for(const field of this.fields.values())field.setDaylight(value);this.headMaterial.color.set('#f2d6a3').multiplyScalar(.14+.86*T.MathUtils.smoothstep(1-value,.1,.78))}
  diagnostics(){const localTextureBytes=this.fields.size*LOCAL_LIGHT_SIZE**2*4;return{loadedBands:this.loaded,sourceFixtures:this.count,visibleFixtures:this.selected.length,maxFixtures:NIGHT_FIXTURE_LIMIT,localSources:Math.min(32,this.sources.length+this.frontages.length),frontages:this.frontages.length,obstruction:this.obstruction?.diagnostics(),sourceBytes:[...this.buffers.values()].reduce((n,b)=>n+b.byteLength,0),localTextureBytes,maxTextureBytes:this.manifest.maxTextureBytes+localTextureBytes,failures:this.failures}}
  dispose(){
    this.disposed=true;this.controller.abort();this.obstruction?.dispose();for(const field of this.fields.values())field.dispose()
    for(const m of [this.poles,this.arms,this.heads]){m.geometry.dispose();m.dispose()}
    this.poleMaterial.dispose();this.headMaterial.dispose();this.cells.clear();this.buffers.clear();this.frontageCache.clear();this.group.removeFromParent()
  }
}
