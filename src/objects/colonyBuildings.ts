import {colonyGroundHeight,colonyShopBays} from './colonyBuildingFrontage'
import {colonyShopSignMaterial} from './colonyShopSigns'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import * as THREE from 'three'
import type { CityBuilding } from './cityLayout'
import type { BuildingInterior } from './buildingInteriors'
import { cityBlockSpec, cityBlockDistance, type BlockSpec, type BlockVolume } from './authoredCityBlockPlan'
import { colonyBuildingSpec, colonyWindowGrid } from './colonyBuildingPlan'
import { colonyFacadeMaterial, prepareColonyGeometry,writeColonyFacade,dirtyColonyFacade, loadColonyModules, type ColonyModules } from './colonyBuildingModules'

type Entry={design:ReturnType<typeof colonyBuildingDesign>;trim:THREE.Color;spec:BlockSpec;matrix:THREE.Matrix4;color:THREE.Color;interior:boolean;size:number;visible:boolean}
/** All non-pilot lots. Shared Blender parts, bounded close detail, persistent instance buffers. */
export class ColonyBuildings {
 readonly group=new THREE.Group()
 private entries:Entry[]=[]
 private capacities={shell:1,entrance:1,mixed:1}
 private entryByBuilding=new Map<CityBuilding,Entry>()
 private radius=1
 private modules:ColonyModules|null=null
 private fallback=new THREE.BoxGeometry(1,1,1)
 private facade=colonyFacadeMaterial(false,true)
 private entranceFacade=colonyFacadeMaterial(true,true)
 private mixedFacade=colonyFacadeMaterial(true,true,true)
 private frame=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7})
 private signGeometry=new THREE.PlaneGeometry(1,1)
 private signs=colonyShopSignMaterial()
 private door=new THREE.MeshStandardMaterial({color:0x28434c,roughness:.55})
 private batches=new Map<string,THREE.InstancedMesh>()
 private nearInteriors=new Set<CityBuilding>()
 private focus=new THREE.Vector3(Infinity,Infinity,Infinity)
 private projection=935
 private extent=1
 private disposed=false
 constructor(parent:THREE.Group){
  this.group.name='blender-colony-buildings';parent.add(this.group)
  loadColonyModules().then(modules=>{if(this.disposed)return;this.modules=modules;this.clearBatches();this.invalidate()}).catch(e=>console.warn('Colony modules unavailable; retaining the new structural recipe.',e))
 }
 setProjection(value:number){if(Math.abs(value-this.projection)>1){this.projection=value;this.invalidate()}}
 private invalidate(){this.focus.set(Infinity,Infinity,Infinity)}
 rebuild(buildings:CityBuilding[],radius:number,interiors:Map<CityBuilding,BuildingInterior>){
  this.clearBatches();this.radius=radius;this.nearInteriors.clear()
  this.entries=buildings.filter(b=>!cityBlockSpec(b,radius)).map(b=>{
   const interior=interiors.get(b),spec=colonyBuildingSpec(b,interior),a=b.azimuth,side=b.front?.side??-1,tangent=b.front?.axis==='tangent'
   const x=tangent?new THREE.Vector3(0,side,0):new THREE.Vector3(side*Math.sin(a),0,-side*Math.cos(a))
   const z=tangent?new THREE.Vector3(-side*Math.sin(a),0,side*Math.cos(a)):new THREE.Vector3(0,side,0)
   const matrix=new THREE.Matrix4().makeBasis(x,new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)),z).setPosition(Math.cos(a)*radius,b.axial,Math.sin(a)*radius)
   const design=colonyBuildingDesign(b,interior?.kind)
   return {design,trim:new THREE.Color('#'+design.trim),spec,matrix,color:new THREE.Color('#'+spec.wall),interior:!!interior,visible:false,size:Math.max(b.width,b.depth,b.height)}
  })
  this.capacities={shell:0,entrance:0,mixed:0}
  for(const e of this.entries)for(const v of e.spec.volumes){
   const kind=!e.interior&&colonyGroundHeight(v,e.design)>0?'mixed':!e.interior&&v.y-v.h/2<.01&&Math.abs(v.x)<v.w/2?'entrance':'shell'
   this.capacities[kind]++
  }
  this.entryByBuilding=new Map(this.entries.map(e=>[e.spec.building,e]))
  this.extent=Math.hypot(radius,Math.max(0,...buildings.map(b=>Math.abs(b.axial)))+100)
  this.invalidate()
 }
 isBuildingVisible(b:CityBuilding){const e=this.entryByBuilding.get(b);return !!e&&(e.visible||(e.interior&&this.nearInteriors.has(b)))}
 setNearInteriors(buildings:CityBuilding[]){this.nearInteriors=new Set(buildings);this.invalidate()}
 private batch(key:string,geometry:THREE.BufferGeometry,material:THREE.Material,capacity:number){
  let mesh=this.batches.get(key)
  if(!mesh||mesh.instanceMatrix.count<capacity){if(mesh){if(mesh.geometry.getAttribute('aColonyFacade')||mesh.geometry.getAttribute('aShopSign'))mesh.geometry.dispose();mesh.removeFromParent();mesh.dispose()}
   mesh=new THREE.InstancedMesh(key==='structure'||key==='entrance-structure'||key==='mixed-structure'?prepareColonyGeometry(geometry,Math.max(capacity,1)):geometry,material,Math.max(capacity,1));if(key==='signs'){mesh.geometry=geometry.clone();mesh.geometry.setAttribute('aShopSign',new THREE.InstancedBufferAttribute(new Float32Array(Math.max(capacity,1)),1))};mesh.name='colony-'+key;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);this.batches.set(key,mesh)
  }mesh.count=0;return mesh
 }
 update(azimuth:number,axial:number,altitude:number){
  const camera=new THREE.Vector3(Math.cos(azimuth)*(this.radius-altitude),axial,Math.sin(azimuth)*(this.radius-altitude))
  if(camera.distanceTo(this.focus)<8)return
  this.focus.copy(camera)
  const shell=this.batch('structure',this.modules?.structure??this.fallback,this.facade,this.capacities.shell)
  const frontShell=this.batch('entrance-structure',this.modules?.structure??this.fallback,this.entranceFacade,this.capacities.entrance)
  const mixedShell=this.batch('mixed-structure',this.modules?.structure??this.fallback,this.mixedFacade,this.capacities.mixed)
  const trim=this.batch('trim',this.modules?.canopy??this.fallback,this.frame,4096)
  const doors=this.batch('doors',this.modules?.door??this.fallback,this.door,2048)
  const frames=this.modules?this.batch('window-frames',this.modules.window_frame,this.frame,8192):null
  const balconies=this.modules?this.batch('balconies',this.modules.balcony,this.frame,1024):null
  const signs=this.batch('signs',this.signGeometry,this.signs,1024)
  const up=new THREE.Vector3(0,1,0),local=new THREE.Matrix4(),world=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3()
  const add=(batch:THREE.InstancedMesh,e:Entry,v:BlockVolume,rotation=0)=>{
   if(batch.count>=batch.instanceMatrix.count)return
   if(batch===shell||batch===frontShell||batch===mixedShell){
    const data=batch.instanceMatrix.array,m=e.matrix.elements,i=batch.count*16
    for(let row=0;row<3;row++){
     data[i+row]=m[row]*v.w;data[i+4+row]=m[4+row]*v.h;data[i+8+row]=m[8+row]*v.d
     data[i+12+row]=m[row]*v.x+m[4+row]*v.y+m[8+row]*v.z+m[12+row]
    }
    data[i+3]=data[i+7]=data[i+11]=0;data[i+15]=1;batch.setColorAt(batch.count,e.color);writeColonyFacade(batch,batch.count,e.design,e.interior?0:colonyGroundHeight(v,e.design))
   }else{
    q.setFromAxisAngle(up,rotation);local.compose(p.set(v.x,v.y,v.z),q,s.set(v.w,v.h,v.d));world.multiplyMatrices(e.matrix,local);batch.setMatrixAt(batch.count,world);if(batch!==doors&&batch!==signs)batch.setColorAt(batch.count,e.trim)
   }
   batch.count++
  }
  let visible=0,near=0,framed=0,balconyBuildings=0,retailBuildings=0
  const close:Array<{e:Entry;distance:number}>=[]
  for(const e of this.entries){
   if(e.interior&&this.nearInteriors.has(e.spec.building))continue
   const distance=Math.max(1,camera.distanceTo(p.setFromMatrixPosition(e.matrix))-e.size)
   const threshold=e.spec.building.kind==='tower'?(e.visible?1.7:2):(e.visible?3.1:3.6)
   e.visible=e.size*this.projection/distance>=threshold
   if(!e.visible)continue
   visible++
   for(const v of e.spec.volumes)add(!e.interior&&colonyGroundHeight(v,e.design)>0?mixedShell:!e.interior&&v.y-v.h/2<.01&&Math.abs(v.x)<v.w/2?frontShell:shell,e,v)
   if(distance<144&&!e.interior)close.push({e,distance:cityBlockDistance(e.spec,this.radius,{azimuth,axial,altitude})})
  }
  close.sort((a,b)=>a.distance-b.distance)
  for(const {e,distance} of close.slice(0,160)){
   near++
   const detailed=distance<30&&framed++<6
   // Entrance on the most central front-accessible volume; fixed human dimensions.
   const v=e.spec.volumes.find(v=>Math.abs(v.x)<v.w/2&&v.y-v.h/2<.01)??e.spec.volumes[0]
   const groundHeight=colonyGroundHeight(v,e.design),retail=e.design.use.ground==='retail'&&groundHeight>0
   if(retail)retailBuildings++
   const front=v.z+v.d/2,width=Math.min(e.spec.building.kind==='house'?1.3:2.2,v.w*.6),height=Math.min(2.5,v.h*.8)
   add(doors,e,{x:v.x,y:height/2,z:front+.012,w:width,h:height,d:.025})
   add(trim,e,{x:v.x,y:height+.12,z:front-.4,w:Math.min(width+.6,v.w),h:.16,d:.85})
   for(const sign of [-1,1])add(trim,e,{x:v.x+sign*width/2,y:height/2,z:front+.035,w:.065,h:height,d:.065})
   add(trim,e,{x:v.x,y:height,z:front+.035,w:width,h:.065,d:.065})
   if(width>1.5)add(trim,e,{x:v.x,y:height/2,z:front+.035,w:.045,h:height,d:.065})
   add(trim,e,{x:v.x+width*.32,y:Math.min(1.1,height*.5),z:front+.08,w:.045,h:.35,d:.06})
   for(const storefront of e.spec.volumes){
    const height=colonyGroundHeight(storefront,e.design);if(!height)continue
    const face=storefront.z+storefront.d/2
    add(trim,e,{x:storefront.x,y:height-.08,z:face+.06,w:storefront.w,h:.16,d:.18})
    for(const bay of colonyShopBays(storefront)){
     if(e.spec.volumes.some(o=>o!==storefront&&Math.abs(bay.x-o.x)<o.w/2&&face<o.z+o.d/2+.05&&face>o.z-o.d/2))continue
     if(retail){
      const i=signs.count
      add(signs,e,{x:bay.x,y:3.7,z:face+.10,w:bay.width,h:.5,d:.10})
      ;(signs.geometry.getAttribute('aShopSign') as THREE.InstancedBufferAttribute).setX(i,(bay.index+Math.floor(e.design.seed*31))%8)
      add(trim,e,{x:bay.x,y:3.35,z:face+.26,w:bay.width+.12,h:.12,d:.6})
      // Tenant door is separate from the central upper-floor entrance.
      const dx=bay.x+bay.width*.26
      add(doors,e,{x:dx,y:1.25,z:face+.028,w:1.05,h:2.5,d:.03})
      if(detailed)add(trim,e,{x:dx+.35,y:1.1,z:face+.07,w:.04,h:.4,d:.05})
     }
     if(detailed&&frames)for(let floor=0;floor*4.2+3.35<height;floor++)
      add(frames,e,{x:bay.x,y:floor*4.2+1.9,z:face+.016,w:bay.width,h:2.9,d:1})
    }
   }
   // Apartment balconies repeat by dwelling bay, and start above shops/lobbies.
   // Only the closest eight residential facades carry this geometry.
   if(balconies&&e.design.use.primary==='apartments'&&distance<65&&balconyBuildings++<8){
    let count=0
    for(const volume of [...e.spec.volumes].sort((a,b)=>(b.z+b.d/2)-(a.z+a.d/2))){
     const ground=colonyGroundHeight(volume,e.design),upper=volume.h-ground
     const grid=colonyWindowGrid({...volume,h:upper},e.design.profile),floorHeight=upper/grid.floors
     const face=volume.z+volume.d/2
     for(let row=0;row<grid.floors&&count<96;row++){
      const y=volume.y-volume.h/2+ground+row*floorHeight
      if(y<2.8)continue
      // Inset rear volumes may be hidden by the U-shaped wings.
      const width=volume.w*.94
      if(e.spec.volumes.some(o=>o!==volume&&Math.abs(volume.x-o.x)<o.w/2&&face<o.z+o.d/2+.05&&face>o.z-o.d/2&&Math.abs(y+.5-o.y)<o.h/2))continue
      add(balconies,e,{x:volume.x,y,z:face+.02,w:width,h:1,d:.85});count++
      if(detailed&&count<24)for(let col=1;col<grid.columnsX;col++){
       const x=volume.x+(col/grid.columnsX-.5)*width
       add(trim,e,{x,y:y+.48,z:face+.44,w:.04,h:.96,d:.8})
      }
     }
    }
   }

   for(const volume of e.spec.volumes){
    const top=volume.y+volume.h/2
    // Insets and roof edge are metric trims, never stretched complete buildings.
    for(const sign of [-1,1])add(trim,e,{x:volume.x,y:top-.12,z:volume.z+sign*(volume.d/2-.1),w:volume.w,h:.24,d:.18})
    if(!detailed||!frames)continue
    const ground=e.interior?0:colonyGroundHeight(volume,e.design),upper=volume.h-ground
    const profile=e.design.profile,grid=colonyWindowGrid({...volume,h:upper},profile)
    for(const axis of ['x','z'] as const)for(const sign of [-1,1]){
     const columns=axis==='z'?grid.columnsX:grid.columnsZ,width=axis==='z'?volume.w:volume.d
     if(width<1.5||volume.h<2)continue
     for(let row=0;row<grid.floors;row++)for(let col=0;col<columns;col++){
      const along=(col+.5)*width/columns-width/2,y=volume.y-volume.h/2+ground+(row+profile.paneBottom+profile.paneHeight/2)*upper/grid.floors
      const x=volume.x+(axis==='z'?along:sign*(volume.w/2+.012)),z=volume.z+(axis==='z'?sign*(volume.d/2+.012):along)
      if(ground===0&&volume===v&&axis==='z'&&sign===1&&Math.abs(x-v.x)<Math.min(2.2,v.w*.6)/2+width/columns*profile.paneWidth*.5&&y<height+volume.h/grid.floors*profile.paneHeight*.5)continue
      if(e.spec.volumes.some(o=>o!==volume&&Math.abs(x-o.x)<o.w/2+.01&&Math.abs(z-o.z)<o.d/2+.01&&Math.abs(y-o.y)<o.h/2))continue
      add(frames,e,{x,y,z,w:width/columns*profile.paneWidth,h:upper/grid.floors*profile.paneHeight,d:1},axis==='z'?(sign===1?0:Math.PI):sign*Math.PI/2)
     }
    }
   }
  }
  ;(signs.geometry.getAttribute('aShopSign') as THREE.InstancedBufferAttribute).needsUpdate=true
  for(const batch of this.batches.values()){batch.instanceMatrix.needsUpdate=true;dirtyColonyFacade(batch);if(batch.instanceColor)batch.instanceColor.needsUpdate=true;if(batch===shell||batch===frontShell||batch===mixedShell)batch.boundingSphere=new THREE.Sphere(new THREE.Vector3(),this.extent);else batch.computeBoundingSphere()}
  this.group.userData={buildings:this.entries.length,visible,near,asset:!!this.modules,legacyBuildings:0,structuralInstances:shell.count+frontShell.count+mixedShell.count,windowFrames:frames?.count??0,balconies:balconies?.count??0,shopSigns:signs.count,retailBuildings}
 }
 setDaylight(daylight:number){this.facade.emissiveIntensity=this.entranceFacade.emissiveIntensity=this.mixedFacade.emissiveIntensity=.015+(1-daylight)*.5}
 private clearBatches(){for(const m of this.batches.values()){if(m.geometry.getAttribute('aColonyFacade')||m.geometry.getAttribute('aShopSign'))m.geometry.dispose();m.removeFromParent();m.dispose()}this.batches.clear()}
 dispose(){this.disposed=true;this.clearBatches();this.fallback.dispose();this.facade.dispose();this.entranceFacade.dispose();this.mixedFacade.dispose();this.frame.dispose();this.door.dispose();this.signGeometry.dispose();this.signs.map?.dispose();this.signs.dispose();this.group.removeFromParent()}
}
