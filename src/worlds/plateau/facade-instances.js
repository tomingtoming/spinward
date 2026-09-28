import * as T from 'three'
import {composeFacades,PALETTE} from './facade-rules.js'
import {composeBuildingFacades} from './facade-design.js'
import {roomDeclarations,roomVertex,roomFragment} from './night-windows.js'
import {FacadeBatches} from './facade-batches.js'

const colour=value=>new T.Color(value)
const atlases=new WeakMap()
function acquireSigns(kit){
  let atlas=atlases.get(kit)
  if(!atlas){atlas={texture:signAtlas(kit.stationSigns),references:0};atlases.set(kit,atlas)}
  atlas.references++;return atlas.texture
}
function releaseSigns(kit){
  const atlas=atlases.get(kit)
  if(atlas&&--atlas.references===0){atlas.texture.dispose();atlases.delete(kit)}
}
function signAtlas(stations=[]){
  if(typeof document==='undefined')return new T.DataTexture(new Uint8Array([255,255,255,255]),1,1)
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=Math.ceil((4+stations.length)/4)*64
  const ctx=canvas.getContext('2d'),names=[['喫茶','COFFEE'],['日用品','DAILY'],['食料品','MARKET'],['工房','WORKSHOP']]
  names.forEach(([jp,en],i)=>{const x=i*512;ctx.fillStyle=['#3e5755','#735c4b','#635841','#505a60'][i];ctx.fillRect(x,0,512,64)
    ctx.fillStyle='#e9dfc7';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 34px sans-serif';ctx.fillText(jp,x+180,33,180);ctx.font='21px sans-serif';ctx.fillText(en,x+374,33,190)})
  stations.forEach((name,i)=>{const index=i+4,x=(index%4)*512,y=Math.floor(index/4)*64
    ctx.fillStyle='#e7e9df';ctx.fillRect(x,y,512,64);ctx.fillStyle='#476e60';ctx.fillRect(x,y+55,512,9)
    ctx.textAlign='left';ctx.font='600 32px sans-serif';ctx.fillStyle='#273a3a';ctx.fillText(name,x+24,y+29,340)
    ctx.textAlign='right';ctx.font='18px sans-serif';ctx.fillText('駅 / STATION',x+490,y+30,118)})
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture
}
const sharedDeclarations=`
attribute vec2 stretch;
attribute vec2 instanceSize;
attribute float kitRole;
attribute vec3 instanceFrame;
// Pack scalar controls together: WebGL guarantees only 16 vertex attributes,
// and the instancing matrix already occupies four of those locations.
attribute vec4 instanceDetail;
attribute vec3 instanceLight;
uniform vec4 kitWorld;
uniform float kitBand;
uniform float kitDaylight;
varying vec2 vKitPoint;
varying vec2 vKitSize;
varying float vKitRoughness;
varying vec3 vKitFrame;
varying float vKitSurface;
varying float vKitOpening; varying float vKitOwner;
${roomDeclarations}
varying vec3 vKitGlow;
vec3 kitResize(vec3 p){
  p.x+=stretch.x*(instanceSize.x-1.0);
  p.z+=stretch.y*(instanceSize.y-1.0);
  p.y*=instanceDetail.x;
  return p;
}
vec3 kitWarp(vec3 p){
  if(kitWorld.y<0.5)return vec3(p.x,p.z,-p.y);
  float a=(p.x+kitWorld.z)/kitWorld.x+kitBand;
  float r=kitWorld.x-p.z;
  return vec3(r*sin(a),(kitWorld.y<1.5?kitWorld.x:0.0)-r*cos(a),-(p.y+kitWorld.w));
}
vec3 kitNormal(vec3 n,vec3 p){
  if(kitWorld.y<0.5)return vec3(n.x,n.z,-n.y);
  float a=(p.x+kitWorld.z)/kitWorld.x+kitBand;
  n.x/=1.0-p.z/kitWorld.x;
  return vec3(n.x*cos(a)-n.z*sin(a),n.x*sin(a)+n.z*cos(a),-n.y);
}`

function patchMaterial(material,uniforms,mid=false){
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms)
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+sharedDeclarations)
      .replace('#include <begin_vertex>','vec3 transformed=kitResize(position); vKitPoint=transformed.xz; vKitSize=instanceSize; vKitRoughness=kitRole<.5?instanceDetail.y:.86; vKitFrame=instanceFrame; vKitSurface=kitRole<.5?instanceDetail.z:0.0; vKitOpening=mod(instanceDetail.w,4.0);vKitOwner=floor(instanceDetail.w/4.0); vKitGlow=kitRole<.5?instanceLight:vec3(0.0); vKitRay=vec3(0.0,0.0,1.0); if(kitDaylight<.9&&vKitOpening<1.5&&max(max(vKitGlow.r,vKitGlow.g),vKitGlow.b)>0.0){'+roomVertex+'}')
      .replace('#include <project_vertex>',T.ShaderChunk.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;','mvPosition.xyz=kitWarp(mvPosition.xyz);\nmvPosition = modelViewMatrix * mvPosition;'))
      .replace('#include <worldpos_vertex>',T.ShaderChunk.worldpos_vertex.replace('worldPosition = modelMatrix * worldPosition;','worldPosition.xyz=kitWarp(worldPosition.xyz);\nworldPosition = modelMatrix * worldPosition;'))
      .replace('#include <defaultnormal_vertex>',T.ShaderChunk.defaultnormal_vertex.replace('transformedNormal = normalMatrix * transformedNormal;','transformedNormal=kitNormal(transformedNormal,(instanceMatrix*vec4(kitResize(position),1.0)).xyz);\ntransformedNormal = normalMatrix * transformedNormal;'))
      .replace('#include <color_vertex>',T.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;','if(kitRole<0.5)vColor.xyz=instanceColor.xyz; else if(kitRole<1.5)vColor.xyz=instanceFrame;'))
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float kitDaylight; uniform float kitNightTransition; uniform sampler2D kitNightCoverage; uniform sampler2D kitSigns; uniform vec2 kitSignGrid; varying vec3 vKitGlow; varying float vKitRoughness; varying vec3 vKitFrame; varying float vKitSurface; varying vec2 vKitPoint; varying vec2 vKitSize; varying float vKitOpening; varying float vKitOwner;'+roomDeclarations)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=vKitRoughness;')
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        // Daylight, opaque frames and unoccupied rooms contribute no glow.
        // Do not trace an interior ray for those pixels.
        if(kitDaylight<.9&&max(max(vKitGlow.r,vKitGlow.g),vKitGlow.b)>0.0){
        float paneMask=1.0;
        if(vKitOpening<1.5){
          vec2 p=vec2(vKitPoint.x+vKitSize.x*.5,vKitPoint.y);
          if(p.x<.028||p.x>vKitSize.x-.028||p.y<.03||p.y>vKitSize.y-.03||(vKitOpening<.5&&abs(p.x-vKitSize.x*.5)<.026))paneMask=0.0;
          ${roomFragment}
        }
        // A backlit sign illuminates its printed face, preserving lettering
        // contrast instead of adding a uniform luminous rectangle over it.
        float paneTransfer=vKitOpening<1.5?kitNightTransition*texture2D(kitNightCoverage,(vec2(mod(vKitOwner,64.0),floor(vKitOwner/64.0))+.5)/64.0).r*smoothstep(140.0,280.0,length(vViewPosition)):0.0;
        totalEmissiveRadiance+=vKitGlow*smoothstep(.10,.78,1.0-kitDaylight)*paneMask*(1.0-paneTransfer)*(vKitSurface<-.5?diffuseColor.rgb:vec3(1.0));
        }
      `)
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if(vKitSurface<-.5){
        vec2 uv=clamp(vKitPoint/vKitSize+.5,vec2(.015),vec2(.985));
        // Preserve the 8:1 authored lettering even on a narrow storefront.
        uv.x=clamp((uv.x-.5)*(vKitSize.x/vKitSize.y)/8.0+.5,.015,.985);
        float index=clamp(-vKitSurface-1.0,0.0,kitSignGrid.x*kitSignGrid.y-1.0);
        uv=(uv+vec2(mod(index,kitSignGrid.x),kitSignGrid.y-1.0-floor(index/kitSignGrid.x)))/kitSignGrid;
        diffuseColor.rgb=texture2D(kitSigns,uv).rgb;
      }
      if(vKitSurface>.5){
        vec2 size=vKitSurface<1.5?vec2(.3,.15):vec2(1.2,.6);
        vec2 grid=vKitPoint/size,fw=max(fwidth(grid),vec2(.0001));
        vec2 edge=min(fract(grid),1.0-fract(grid));
        vec2 line=1.0-smoothstep(vec2(.012)-fw,vec2(.012)+fw,edge);
        float coverage=1.0-smoothstep(.12,.5,max(fw.x,fw.y));
        diffuseColor.rgb*=1.0-.16*max(line.x,line.y)*coverage;
      }
    `)
    if(mid){
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform vec3 kitFrame; uniform vec3 kitSill;
      `).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 p=vec2(vKitPoint.x+vKitSize.x*.5,vKitPoint.y);
        if(p.y<0.0&&vKitOpening<.5){diffuseColor.rgb=kitSill;}
        else if(p.y<0.0){discard;}
        else if(p.y>vKitSize.y||p.x<0.0||p.x>vKitSize.x){discard;}
        else if(p.x<.0225||p.x>vKitSize.x-.0225||(vKitOpening<.5&&abs(p.x-vKitSize.x*.5)<.0225)||p.y<.025||p.y>vKitSize.y-.025){diffuseColor.rgb=vKitFrame;}
      `)
    }
  }
  material.customProgramCacheKey=()=>`spinward-facade-v7-${mid?'panel':'solid'}`
  return material
}

function prototypeGeometry(data){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(data.positions.flat(),3))
  g.setAttribute('normal',new T.Float32BufferAttribute(data.normals.flat(),3));g.setAttribute('stretch',new T.Float32BufferAttribute(data.stretch.flat(),2))
  g.setAttribute('kitRole',new T.Float32BufferAttribute(data.roles,1));g.setIndex(data.indices)
  const colours=data.roles.flatMap(role=>colour(role===1?PALETTE.frame:role===2?PALETTE.sill:'#ffffff').toArray())
  g.setAttribute('color',new T.Float32BufferAttribute(colours,3));return g
}
function panelGeometry(){
  return prototypeGeometry({positions:[[-.58,-.057,-.09],[.58,-.057,-.09],[.58,-.057,1.035],[-.58,-.057,1.035]],
    normals:Array(4).fill([0,-1,0]),stretch:[[-.5,0],[.5,0],[.5,1],[-.5,1]],roles:[0,0,0,0],indices:[0,1,2,0,2,3]})
}

// Retain the authored outward faces (glass, frame, sill) with their exact
// colours, normals and stretch anchors. Thin back/edge faces contribute little
// at headset resolution; keep the original panel shader at middle distance.
export function openingFaceGeometry(data){
  const kept=[]
  for(let i=0;i<data.indices.length;i+=3){
    const face=data.indices.slice(i,i+3)
    if(face.every(v=>data.normals[v][1]<-.99))kept.push(...face)
  }
  return prototypeGeometry({...data,indices:kept})
}

export function nativePartVertex(part,position,stretch){
  const x=position[0]+stretch[0]*(part.width-1),y=position[1]*part.depth,z=position[2]+stretch[1]*(part.height-1)
  return[part.origin[0]+part.u[0]*x-part.u[1]*y,part.origin[1]+part.u[1]*x+part.u[0]*y,part.origin[2]+z]
}

export class FacadeInstances{
  constructor(kit,sites,study,sample,{flatOpenings=false,batchFacades=false}={}){
    this.flatOpenings=flatOpenings
    this.group=batchFacades?new T.LOD():new T.Group();this.group.name='shared-facades';this.study=study;this.sample=sample;this.chunks=[];this.version=kit.version??1
    this.batcher=batchFacades?new FacadeBatches(this.group):null
    this.prototypes=Object.fromEntries(Object.entries(kit.parts).map(([name,p])=>[name,prototypeGeometry(p)]));this.prototypes.panel=panelGeometry()
    this.openingFaces=flatOpenings?Object.fromEntries(['window','glazing'].filter(k=>kit.parts[k]).map(k=>[k,openingFaceGeometry(kit.parts[k])])):{}
    this.emptyNightCoverage=new T.DataTexture(new Uint8Array([0,0,0,0]),1,1);this.emptyNightCoverage.needsUpdate=true
    this.signs=acquireSigns(kit);this.kit=kit;this.revision=0
    this.uniforms={kitWorld:{value:new T.Vector4(study.radius,0,0,0)},kitBand:{value:0},kitFrame:{value:colour(PALETTE.frame)},kitSill:{value:colour(PALETTE.sill)},kitDaylight:{value:1},kitNightTransition:{value:0},kitNightCoverage:{value:this.emptyNightCoverage},kitSigns:{value:this.signs},kitSignGrid:{value:new T.Vector2(4,Math.ceil((4+(kit.stationSigns?.length??0))/4))}}
    // Authored solids and the mid panels have outward winding. Rendering the
    // hidden reverse face doubled costly window shading around dense blocks.
    this.material=patchMaterial(new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,side:T.FrontSide,roughness:.86}),this.uniforms)
    this.panelMaterial=patchMaterial(new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,side:T.FrontSide,roughness:.86}),this.uniforms,true)
    this.depth=patchMaterial(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide}),this.uniforms)
    this.sites=new Map();this.compileMs=0;this.mode='flat';this.design={parts:[],buildings:[]};this.preparations=0;this.disposed=false
    sites.forEach((s,i)=>this.addSite(s.id??String(i),s.buildings))
    this.updateMode('flat')
  }
  addSite(id,rows){
    if(this.sites.has(id))return
    const start=performance.now(),design=this.version>=2?composeBuildingFacades(rows,{life:this.version>=3}):composeFacades(rows);this.sites.set(id,design)
    // Visibility belongs to the source building, not the current decoration.
    // Splitting a cornice or switching window styles must not shrink its LOD
    // sphere and make a still-readable elevation suddenly lose every window.
    const sourceBounds=new Map()
    if(this.version>=2)for(const row of rows){
      let b=sourceBounds.get(row.id)
      if(!b){b={low:new T.Vector3(Infinity,Infinity,Infinity),high:new T.Vector3(-Infinity,-Infinity,-Infinity)};sourceBounds.set(row.id,b)}
      for(const wall of row.walls)for(const p of [wall.a,wall.b]){
        b.low.min(new T.Vector3(...p,wall.base));b.high.max(new T.Vector3(...p,wall.top))
      }
    }
    const chunks=new Map()
    for(const p of design.parts){const key=`${id}:${Math.floor(p.origin[0]/64)},${Math.floor(p.origin[1]/64)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(p)}
    for(const [key,parts] of chunks){
      const low=new T.Vector3(Infinity,Infinity,Infinity),high=new T.Vector3(-Infinity,-Infinity,-Infinity)
      let detailReach=0
      if(this.version>=2){
        for(const identity of new Set(parts.map(p=>p.id))){
          const b=sourceBounds.get(identity),size=b.high.clone().sub(b.low)
          low.min(b.low);high.max(b.high)
          // Large offices remain legible farther away than a small house.
          // Only the 2-triangle panels gain reach; source loading caps stay fixed.
          detailReach=Math.max(detailReach,Math.min(220,Math.max(size.x,size.y,size.z)*2))
        }
        low.addScalar(this.version>=3?-1.2:-.5);high.addScalar(this.version>=3?1.2:.5)
      }else for(const p of parts){const pad=Math.max(p.width,p.height,2.5)+.5;low.min(new T.Vector3(...p.origin).addScalar(-pad));high.max(new T.Vector3(...p.origin).addScalar(pad))}
      const centre=low.clone().add(high).multiplyScalar(.5),radius=high.distanceTo(low)/2
      const chunk={key,site:id,parts,centre,radius,detailReach,renderPad:Math.max(2,...parts.map(p=>p.depth+.1)),near:[],mid:[],level:null}
      for(const kind of Object.keys(this.prototypes).filter(k=>k!=='panel')){
        const selected=parts.filter(p=>p.kind===kind);if(!selected.length)continue
        // Preserve authored glass/frame faces near the player, with the existing
        // two-triangle panels at middle distance. Entries keep their solid kit.
        if(this.flatOpenings&&['window','glazing'].includes(kind)){
          const mesh=this.instances(this.openingFaces[kind],selected,this.material,`${key}-${kind}-faces`)
          chunk.near.push(mesh)
          chunk.mid.push(this.instances(this.prototypes.panel,selected,this.panelMaterial,`${key}-${kind}-panel`));continue
        }
        chunk.near.push(this.instances(this.prototypes[kind],selected,this.material,`${key}-${kind}`))
        if(['window','glazing','entry'].includes(kind))chunk.mid.push(this.instances(this.prototypes.panel,selected,this.panelMaterial,`${key}-${kind}-panel`))
        else if(selected.some(p=>p.nearOnly)){
          const middle=selected.filter(p=>!p.nearOnly)
          if(middle.length)chunk.mid.push(this.instances(this.prototypes[kind],middle,this.material,`${key}-${kind}-mid`))
        }else chunk.mid.push(chunk.near.at(-1))
      }
      this.chunks.push(chunk)
    }
    this.refreshDesign();this.compileMs+=performance.now()-start;this.updateMode(this.mode)
  }
  refreshDesign(){
    this.revision++
    this.design={parts:[...this.sites.values()].flatMap(s=>s.parts),buildings:[...new Map([...this.sites.values()].flatMap(s=>s.buildings).map(b=>[b.id,b])).values()]}
  }
  async prepareSite(id,rows,prepare){
    if(this.disposed)return
    this.addSite(id,rows)
    const chunks=this.chunks.filter(c=>c.site===id),materials=new Map()
    for(const c of chunks){
      c.preparing=true
      for(const m of new Set([...c.near,...c.mid])){m.visible=false;materials.set(m.material,m)}
    }
    this.preparations++
    try{
      // All instances share these two program variants, regardless of count.
      for(const mesh of materials.values())await prepare(mesh)
      for(const c of chunks){c.preparing=false;c.level=null}
    }finally{this.preparations--;if(this.disposed&&!this.preparations)this.disposeMaterials()}
  }
  removeSite(id){
    // Retire packed copies before their streaming sources are released.
    if(this.batcher){
      const removed=new Set(this.chunks.filter(c=>c.site===id).flatMap(c=>[...c.near,...c.mid]))
      this.batcher.select(this.batcher.sources.filter(m=>!removed.has(m)));this.batcher.clear()
    }
    for(const c of this.chunks.filter(c=>c.site===id))for(const m of new Set([...c.near,...c.mid])){
      this.group.remove(m);m.dispose();m.geometry.dispose()
    }
    this.chunks=this.chunks.filter(c=>c.site!==id);this.sites.delete(id);this.refreshDesign()
  }
  dispose(){
    this.disposed=true
    for(const id of this.sites.keys())this.removeSite(id)
    for(const p of Object.values(this.prototypes))p.dispose()
    for(const p of Object.values(this.openingFaces))p.dispose()
    if(!this.preparations)this.disposeMaterials()
  }
  disposeMaterials(){
    if(this.materialsDisposed)return
    this.materialsDisposed=true
    this.material.dispose();this.panelMaterial.dispose();this.depth.dispose();this.emptyNightCoverage.dispose();releaseSigns(this.kit)
  }
  instances(prototype,parts,material,name){
    const g=new T.BufferGeometry()
    // CPU prototype arrays are shared. GPU buffer ownership is per batch: disposing one
    // site's geometry must not delete buffers referenced by another site's VAO (Three r180).
    for(const [name,a] of Object.entries(prototype.attributes))g.setAttribute(name,new T.BufferAttribute(a.array,a.itemSize,a.normalized))
    g.setIndex(new T.BufferAttribute(prototype.index.array,1))
    g.setAttribute('instanceSize',new T.InstancedBufferAttribute(new Float32Array(parts.flatMap(p=>[p.width,p.height])),2))
    const match=/^(\d+)-(\d+):/.exec(name),owner=match?Number(match[1])+17*Number(match[2]):0
    const glass=new Set(['glass-blue','glass-neutral','shop-glass'].map(k=>PALETTE[k]))
    g.setAttribute('instanceFrame',new T.InstancedBufferAttribute(new Float32Array(parts.flatMap(p=>colour(p.frame??PALETTE.frame).toArray())),3))
    g.setAttribute('instanceDetail',new T.InstancedBufferAttribute(new Float32Array(parts.flatMap(p=>[p.depth,p.roughness??(glass.has(p.colour)?.32:.86),p.surface??0,owner*4+(p.kind==='window'?0:['glazing','entry'].includes(p.kind)?1:2)])),4))
    g.setAttribute('instanceLight',new T.InstancedBufferAttribute(new Float32Array(parts.flatMap(p=>colour(p.light?.colour??'#000000').multiplyScalar(p.light?.strength??0).toArray())),3))
    const mesh=new T.InstancedMesh(g,material,parts.length),matrix=new T.Matrix4();mesh.name=name
    parts.forEach((p,i)=>{matrix.set(p.u[0],-p.u[1],0,p.origin[0],p.u[1],p.u[0],0,p.origin[1],0,0,1,p.origin[2],0,0,0,1);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,colour(p.colour))})
    mesh.customDepthMaterial=this.depth;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.sharedFacade=true;mesh.userData.facadePrototype=prototype.id
    if(this.batcher)mesh.visible=false
    this.group.add(mesh);return mesh
  }
  updateMode(mode){
    if(this.batcher)this.batcher.clear()
    this.mode=mode;const colony=mode==='colony',anchor=colony?this.sample.anchor.local:[0,0]
    this.uniforms.kitWorld.value.set(this.study.radius,mode==='flat'?0:colony?2:1,...anchor)
    this.uniforms.kitBand.value=colony?this.sample.band*Math.PI*2/3:0
    for(const c of this.chunks){
      const [x,y,h]=c.centre.toArray(),r=this.study.radius-h,a=(x+anchor[0])/this.study.radius+this.uniforms.kitBand.value
      c.renderCentre=mode==='flat'?new T.Vector3(x,h,-y):new T.Vector3(r*Math.sin(a),(colony?0:this.study.radius)-r*Math.cos(a),-(y+anchor[1]))
      for(const m of new Set([...c.near,...c.mid]))m.boundingSphere=new T.Sphere(c.renderCentre.clone(),c.radius*1.04+c.renderPad)
      c.level=null
    }
  }
  setDaylight(value){this.uniforms.kitDaylight.value=Math.max(0,Math.min(1,value))}
  updateLOD(cameraWorld,force=null){
    const local=this.group.worldToLocal(cameraWorld.clone()),scale=this.group.getWorldScale(new T.Vector3()).x
    for(const c of this.chunks){
      if(c.preparing)continue
      const distance=Math.max(0,local.distanceTo(c.renderCentre)-c.radius)*scale
      // World-space size accounts for the tiny VR tabletop: it keeps a readable shared panel.
      let level=force??(scale<.01?'mid':distance<(c.level==='near'?115:100)?'near':distance<(this.midRange?this.midRange+c.detailReach+(c.level==='far'?0:50):c.level==='far'?580:650)?'mid':'far')
      if(level===c.level)continue;c.level=level
      for(const m of c.near)m.visible=false;for(const m of c.mid)m.visible=false
      if(level!=='far'&&!this.batcher)for(const m of level==='near'?c.near:c.mid)m.visible=true
    }
    if(this.batcher)this.batcher.select(this.chunks.filter(c=>!c.preparing&&['near','mid'].includes(c.level)).flatMap(c=>c[c.level]))
  }
  diagnostics(){return{version:this.version,buildings:this.design.buildings.length,families:this.design.buildings.reduce((counts,b)=>(counts[b.family??'legacy']=(counts[b.family??'legacy']??0)+1,counts),{}),parts:this.design.parts.length,compileMs:this.compileMs,chunks:this.chunks.map(c=>({key:c.key,level:c.level,parts:c.parts.length})),prototypeVertices:Object.values(this.prototypes).reduce((n,g)=>n+g.attributes.position.count,0)}}
}
