import {StableInstanceBatch,type InstanceSlot} from './stableInstanceBatch'
import {colonyGroundHeight,colonyShopBays} from './colonyBuildingFrontage'
import {colonyShopSignMaterial} from './colonyShopSigns'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBalconies,BALCONY_BUILDING_LIMIT,BALCONY_SECTION_LIMIT} from './colonyBalconies'
import {colonyRoofSurface,colonyRoofUnits,colonyRoofLod,ROOF_BUILDING_LIMIT,ROOF_DETAIL_LIMIT,ROOF_UNIT_LIMIT} from './colonyRoofs'
import {planColonyStairs,colonyStairParts,colonyStairCollider,STAIR_BUILDING_LIMIT,STAIR_CORE_LIMIT,type ColonyStair} from './colonyStairs'
import {planColonyForecourts,forecourtCollider,type ForecourtPlanter} from './colonyForecourts'
import * as THREE from 'three'
import type { CityBuilding,CityRoad } from './cityLayout'
import type { BuildingInterior } from './buildingInteriors'
import { cityBlockSpec, cityBlockDistance, type BlockSpec, type BlockVolume } from './authoredCityBlockPlan'
import { colonyBuildingSpec, colonyWindowGrid } from './colonyBuildingPlan'
import { colonyFacadeMaterial, prepareColonyGeometry,writeColonyFacade, loadColonyModules, type ColonyModules } from './colonyBuildingModules'

type StructureKind='structure'|'entrance-structure'|'mixed-structure'
type StructurePart={volume:BlockVolume;kind:StructureKind;ground:number;slot:InstanceSlot}
type Entry={parts:StructurePart[];design:ReturnType<typeof colonyBuildingDesign>;trim:THREE.Color;spec:BlockSpec;matrix:THREE.Matrix4;color:THREE.Color;interior:boolean;size:number;visible:boolean;roof:BlockVolume|null;roofLod:0|1|2}
/** All non-pilot lots. Shared Blender parts, bounded close detail, persistent instance buffers. */
export class ColonyBuildings {
 readonly group=new THREE.Group()
 private entries:Entry[]=[]
 private forecourts=new Map<CityBuilding,ForecourtPlanter[]>()
 private stairwells=new Map<CityBuilding,ColonyStair>()
 private capacities={shell:1,entrance:1,mixed:1}
 private entryByBuilding=new Map<CityBuilding,Entry>()
 private radius=1
 private modules:ColonyModules|null=null
 private fallback=new THREE.BoxGeometry(1,1,1)
 private facade=colonyFacadeMaterial(false,true)
 private entranceFacade=colonyFacadeMaterial(true,true)
 private mixedFacade=colonyFacadeMaterial(true,true,true)
 private shopColors=['#587970','#a18161','#687987','#917565','#657c70','#607984','#8b816e','#887660'].map(c=>new THREE.Color(c))
 private timber=new THREE.Color('#9e8768')
 private potColors=['#9e806b','#a3a698','#667675'].map(c=>new THREE.Color(c))
 private leafColors=['#657b54','#728862','#527565'].map(c=>new THREE.Color(c))
 private frame=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7})
 private roofEquipment=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.8})
 private roofTints=['#d7ddd9','#b9c9cd','#d9cfc0','#afbbb6'].map(c=>new THREE.Color(c))
 private roofProxyTints=this.roofTints.map(c=>c.clone().multiplyScalar(.64))
 private signGeometry=new THREE.PlaneGeometry(1,1)
 private signs=colonyShopSignMaterial()
 private door=new THREE.MeshStandardMaterial({color:0x28434c,roughness:.55})
 private structuresDirty=true
 private structures=new Map<StructureKind,StableInstanceBatch>()
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
 rebuild(buildings:CityBuilding[],radius:number,interiors:Map<CityBuilding,BuildingInterior>,roads:CityRoad[]){
  this.clearBatches();this.radius=radius;this.nearInteriors.clear()
  this.entries=buildings.filter(b=>!cityBlockSpec(b,radius)).map(b=>{
   const interior=interiors.get(b),spec=colonyBuildingSpec(b,interior),a=b.azimuth,side=b.front?.side??-1,tangent=b.front?.axis==='tangent'
   const x=tangent?new THREE.Vector3(0,side,0):new THREE.Vector3(side*Math.sin(a),0,-side*Math.cos(a))
   const z=tangent?new THREE.Vector3(-side*Math.sin(a),0,side*Math.cos(a)):new THREE.Vector3(0,side,0)
   const matrix=new THREE.Matrix4().makeBasis(x,new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)),z).setPosition(Math.cos(a)*radius,b.axial,Math.sin(a)*radius)
   const design=colonyBuildingDesign(b,interior?.kind)
   const parts:StructurePart[]=spec.volumes.map(volume=>{const ground=interior?0:colonyGroundHeight(volume,design);return {volume,ground,kind:ground>0?'mixed-structure':!interior&&volume.y-volume.h/2<.01&&Math.abs(volume.x)<volume.w/2?'entrance-structure':'structure',slot:{index:-1}}})
   return {parts,design,trim:new THREE.Color('#'+design.trim),spec,matrix,color:new THREE.Color('#'+spec.wall),interior:!!interior,visible:false,size:Math.max(b.width,b.depth,b.height),roof:interior?null:colonyRoofSurface(spec),roofLod:2}
  })
  this.capacities={shell:0,entrance:0,mixed:0}
  for(const e of this.entries)for(const v of e.spec.volumes){
   const kind=!e.interior&&colonyGroundHeight(v,e.design)>0?'mixed':!e.interior&&v.y-v.h/2<.01&&Math.abs(v.x)<v.w/2?'entrance':'shell'
   this.capacities[kind]++
  }
  this.entryByBuilding=new Map(this.entries.map(e=>[e.spec.building,e]))
  this.forecourts=planColonyForecourts(this.entries,buildings,roads,radius)
  this.stairwells=planColonyStairs(this.entries,buildings,roads,radius)
  this.extent=Math.hypot(radius,Math.max(0,...buildings.map(b=>Math.abs(b.axial)))+100)
  this.invalidate()
 }
 isBuildingVisible(b:CityBuilding){const e=this.entryByBuilding.get(b);return !!e&&(e.visible||(e.interior&&this.nearInteriors.has(b)))}
 getForecourtColliders(){return [...this.forecourts].flatMap(([b,planters])=>planters.map(p=>forecourtCollider(b,p)))}
 getStairColliders(){return [...this.stairwells].filter(([,s])=>s.kind==='external').map(([b,s])=>colonyStairCollider(b,s,this.radius))}
 setNearInteriors(buildings:CityBuilding[]){this.nearInteriors=new Set(buildings);this.invalidate()}
 private batch(key:string,geometry:THREE.BufferGeometry,material:THREE.Material,capacity:number){
  let mesh=this.batches.get(key)
  if(!mesh||mesh.instanceMatrix.count<capacity){if(mesh){if(mesh.geometry.getAttribute('aColonyFacade')||mesh.geometry.getAttribute('aShopSign'))mesh.geometry.dispose();mesh.removeFromParent();mesh.dispose()}
   mesh=new THREE.InstancedMesh(key==='structure'||key==='entrance-structure'||key==='mixed-structure'?prepareColonyGeometry(geometry,Math.max(capacity,1)):geometry,material,Math.max(capacity,1));if(key==='signs'){mesh.geometry=geometry.clone();mesh.geometry.setAttribute('aShopSign',new THREE.InstancedBufferAttribute(new Float32Array(Math.max(capacity,1)),1))};mesh.name='colony-'+key;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);this.batches.set(key,mesh)
  }mesh.count=0;return mesh
 }
 private structure(key:StructureKind,material:THREE.Material,capacity:number){
  let batch=this.structures.get(key)
  if(!batch){
   const mesh=this.batch(key,this.modules?.structure??this.fallback,material,capacity)
   mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(),this.extent)
   batch=new StableInstanceBatch(mesh);this.structures.set(key,batch)
  }
  return batch
 }
 update(azimuth:number,axial:number,altitude:number){
  const camera=new THREE.Vector3(Math.cos(azimuth)*(this.radius-altitude),axial,Math.sin(azimuth)*(this.radius-altitude))
  if(camera.distanceTo(this.focus)<8)return
  this.focus.copy(camera)
  const shell=this.structure('structure',this.facade,this.capacities.shell)
  const frontShell=this.structure('entrance-structure',this.entranceFacade,this.capacities.entrance)
  const mixedShell=this.structure('mixed-structure',this.mixedFacade,this.capacities.mixed)
  const resetStructures=this.structuresDirty;this.structuresDirty=false
  const trim=this.batch('trim',this.modules?.canopy??this.fallback,this.frame,4096)
  const doors=this.batch('doors',this.modules?.door??this.fallback,this.door,2048)
  const frames=this.modules?this.batch('window-frames',this.modules.window_frame,this.frame,8192):null
  const balconies=this.modules?this.batch('balconies',this.modules.balcony,this.frame,BALCONY_BUILDING_LIMIT*BALCONY_SECTION_LIMIT):null
  const railBalconies=this.modules?this.batch('balconies-rail',this.modules.balcony_rail,this.frame,BALCONY_BUILDING_LIMIT*BALCONY_SECTION_LIMIT):null
  const stairFlights=this.modules?this.batch('stair-flights',this.modules.stair_flight,this.frame,96):null
  const stairMetal=this.batch('stair-metal',this.modules?.canopy??this.fallback,this.frame,4096)
  const roofHvac=this.modules?this.batch('roof-hvac',this.modules.roof_hvac,this.roofEquipment,ROOF_DETAIL_LIMIT*ROOF_UNIT_LIMIT):null
  const roofVents=this.modules?this.batch('roof-vents',this.modules.roof_vent,this.roofEquipment,ROOF_DETAIL_LIMIT*ROOF_UNIT_LIMIT):null
  const roofSimple=this.batch('roof-simple',this.modules?.canopy??this.fallback,this.frame,ROOF_BUILDING_LIMIT*ROOF_UNIT_LIMIT)
  const awnings=this.modules?this.batch('awnings',this.modules.shop_awning,this.frame,512):null
  const signs=this.batch('signs',this.signGeometry,this.signs,1024)
  const pots=this.batch('planters',this.modules?.planter??this.fallback,this.frame,320)
  const plants=this.batch('planting',this.modules?.planting??this.fallback,this.frame,320)
  const up=new THREE.Vector3(0,1,0),roll=new THREE.Vector3(0,0,1),local=new THREE.Matrix4(),world=new THREE.Matrix4(),q=new THREE.Quaternion(),tiltQ=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3()
  const mount=new THREE.Matrix4(),mx=new THREE.Vector3(),my=new THREE.Vector3(),mz=new THREE.Vector3()
  const add=(batch:THREE.InstancedMesh,e:Entry,v:BlockVolume,rotation=0,tint=e.trim,frame=e.matrix,tilt=0)=>{
   if(batch.count>=batch.instanceMatrix.count)return
   q.setFromAxisAngle(up,rotation);if(tilt)q.multiply(tiltQ.setFromAxisAngle(roll,tilt));local.compose(p.set(v.x,v.y,v.z),q,s.set(v.w,v.h,v.d));world.multiplyMatrices(frame,local);batch.setMatrixAt(batch.count,world);if(batch!==doors&&batch!==signs)batch.setColorAt(batch.count,tint)
   batch.count++
  }
  const label=(e:Entry,v:BlockVolume,id:number)=>{
   const index=signs.count;if(index>=signs.instanceMatrix.count)return
   add(signs,e,v);(signs.geometry.getAttribute('aShopSign') as THREE.InstancedBufferAttribute).setX(index,id)
  }
  let visible=0,near=0,framed=0,balconyBuildings=0,retailBuildings=0,stairBuildings=0,enclosedStairs=0
  const close:Array<{e:Entry;distance:number}>=[]
  const roofClose:Array<{e:Entry;distance:number}>=[]
  for(const e of this.entries){
   const interiorOwned=e.interior&&this.nearInteriors.has(e.spec.building)
   const distance=Math.max(1,camera.distanceTo(p.setFromMatrixPosition(e.matrix))-e.size)
   const threshold=e.spec.building.kind==='tower'?(e.visible?1.7:2):(e.visible?3.1:3.6)
   const visibleNow=!interiorOwned&&e.size*this.projection/distance>=threshold,changed=resetStructures||visibleNow!==e.visible
   e.visible=visibleNow
   if(changed)for(const part of e.parts){
    const batch=this.structures.get(part.kind)!
    if(!e.visible){batch.remove(part.slot);continue}
    if(part.slot.index>=0)continue
    batch.add(part.slot,index=>{
     const mesh=batch.mesh,v=part.volume,data=mesh.instanceMatrix.array,m=e.matrix.elements,i=index*16
     for(let row=0;row<3;row++){
      data[i+row]=m[row]*v.w;data[i+4+row]=m[4+row]*v.h;data[i+8+row]=m[8+row]*v.d
      data[i+12+row]=m[row]*v.x+m[4+row]*v.y+m[8+row]*v.z+m[12+row]
     }
     data[i+3]=data[i+7]=data[i+11]=0;data[i+15]=1
     mesh.setColorAt(index,e.color);writeColonyFacade(mesh,index,e.design,part.ground,v.y-v.h/2)
    })
   }
   if(!e.visible)continue
   visible++
   if(e.roof){
    const v=e.roof
    const distance=camera.distanceTo(p.set(v.x,v.y+v.h/2,v.z).applyMatrix4(e.matrix))
    const level=colonyRoofLod(distance,e.roofLod)
    e.roofLod=level
    if(level<2)roofClose.push({e,distance})
   }
   if(distance<144&&!e.interior)close.push({e,distance:cityBlockDistance(e.spec,this.radius,{azimuth,axial,altitude})})
  }
  roofClose.sort((a,b)=>a.distance-b.distance)
  let roofBuildings=0,roofDetailed=0,roofUnits=0
  for(const {e} of roofClose.slice(0,ROOF_BUILDING_LIMIT)){
   const units=colonyRoofUnits(e.spec,e.design);if(!units.length)continue
   const detailed=e.roofLod===0&&roofDetailed<ROOF_DETAIL_LIMIT&&roofHvac&&roofVents
   roofBuildings++;if(detailed)roofDetailed++
   for(const unit of units){
    const tint=this.roofTints[unit.tint]
    if(detailed)add(unit.kind==='roof_hvac'?roofHvac:roofVents,e,unit,unit.yaw,tint)
    else add(roofSimple,e,{...unit,y:unit.y+unit.h/2},unit.yaw,this.roofProxyTints[unit.tint])
    roofUnits++
   }
  }
  close.sort((a,b)=>a.distance-b.distance)
  for(const {e,distance} of close.slice(0,160)){
   near++
   const detailed=distance<30&&framed++<6
   const stair=this.stairwells.get(e.spec.building)
   if(stair&&(stair.kind==='external'?stairBuildings<STAIR_BUILDING_LIMIT:enclosedStairs<STAIR_CORE_LIMIT)){
    const wallTint=e.color.clone().lerp(e.trim,.3)
    if(stair.kind==='external')stairBuildings++;else enclosedStairs++
    if(stair.kind==='external'&&!stairFlights){
     // An opaque proxy retains the permanent envelope if the optional asset fails.
     add(stairMetal,e,{x:stair.x-2.45,y:(stair.levels.at(-1)!+1.1)/2,z:stair.z-1.36,w:6.4,h:stair.levels.at(-1)!+1.1,d:2.8},0,wallTint)
    }else for(const part of colonyStairParts(stair)){
     const batch=part.kind==='flight'?stairFlights!:stairMetal
     add(batch,e,part,part.yaw,part.kind==='wall'?wallTint:part.kind==='door'?this.door.color:e.trim,e.matrix,part.tilt)
    }
   }
   for(const planter of this.forecourts.get(e.spec.building)??[]){
    const a=planter.azimuth,side=e.spec.building.front!.side,tangent=e.spec.building.front!.axis==='tangent'
    mx.set(tangent?0:side*Math.sin(a),tangent?side:0,tangent?0:-side*Math.cos(a))
    my.set(-Math.cos(a),0,-Math.sin(a))
    mz.set(tangent?-side*Math.sin(a):0,tangent?0:side,tangent?side*Math.cos(a):0)
    mount.makeBasis(mx,my,mz).setPosition(Math.cos(a)*this.radius,planter.axial,Math.sin(a)*this.radius)
    add(pots,e,{x:0,y:planter.lift+planter.height/2,z:0,w:planter.width,h:planter.height,d:planter.depth},0,this.potColors[planter.tint],mount)
    add(plants,e,{x:0,y:planter.lift+planter.height+planter.leafHeight/2-.06,z:0,w:planter.width*.9,h:planter.leafHeight,d:planter.depth*.94},0,this.leafColors[Math.floor(e.design.seed*3)%3],mount)
   }
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
   const use=e.design.use.primary
   if(use!=='house'&&use!=='industrial'&&v.h>3.4&&v.w>6){
    const office=use==='office'||use==='commercial',portal=Math.min(v.w*.6,office?4.6:3.3)
    add(trim,e,{x:v.x,y:3.12,z:front+.44,w:portal,h:.15,d:1.05})
    label(e,{x:v.x,y:2.91,z:front+.075,w:Math.min(portal*.68,2.4),h:.28,d:1},use==='office'?9:use==='commercial'?10:8)
    if(office)for(const side of [-1,1]){
     add(doors,e,{x:v.x+side*1.65,y:1.3,z:front+.025,w:.95,h:2.6,d:.03})
     add(trim,e,{x:v.x+side*2.15,y:1.5,z:front+.10,w:.10,h:3,d:.2})
    }
    if(detailed){
     // Human-scale arrival hardware, beside rather than across the entrance.
     const side=office?-1:1,px=v.x+side*Math.min(v.w*.42,office?2.5:1.55)
     add(doors,e,{x:px,y:1.45,z:front+.07,w:.2,h:.32,d:.12})
     add(trim,e,{x:px,y:1.49,z:front+.14,w:.11,h:.08,d:.015})
     if(!office)for(let row=0;row<2;row++)for(let col=0;col<3;col++){
      const x=v.x-1.75+col*.22
      add(trim,e,{x,y:1.1+row*.22,z:front+.10,w:.20,h:.18,d:.16})
      add(doors,e,{x,y:1.13+row*.22,z:front+.19,w:.14,h:.018,d:.012})
     }
    }
   }
   for(const storefront of e.spec.volumes){
    const height=colonyGroundHeight(storefront,e.design);if(!height)continue
    const face=storefront.z+storefront.d/2
    add(trim,e,{x:storefront.x,y:height-.08,z:face+.06,w:storefront.w,h:.16,d:.18})
    for(const bay of colonyShopBays(storefront)){
     if(e.spec.volumes.some(o=>o!==storefront&&Math.abs(bay.x-o.x)<o.w/2&&face<o.z+o.d/2+.05&&face>o.z-o.d/2))continue
     if(retail){
      const tenant=(bay.index+Math.floor(e.design.seed*31))%8,color=this.shopColors[tenant]
      label(e,{x:bay.x,y:3.7,z:face+.10,w:bay.width*(tenant===6?.72:1),h:.5,d:.10},tenant)
      if(awnings&&[0,1,3,7].includes(tenant))add(awnings,e,{x:bay.x,y:3.32,z:face+.025,w:bay.width+.1,h:1,d:tenant===3?1.15:.85},0,color)
      else add(trim,e,{x:bay.x,y:3.35,z:face+.26,w:bay.width+.12,h:.12,d:.6},0,color)
      // Alternate shop doors without moving the certified upstairs entrance.
      const side=tenant%2?1:-1,dx=bay.x+side*bay.width*.26
      add(doors,e,{x:dx,y:1.25,z:face+.028,w:1.05,h:2.5,d:.03})
      const displayX=bay.x-side*bay.width*.14,displayWidth=Math.max(.4,bay.width*.49)
      if([1,2,3,6].includes(tenant))add(trim,e,{x:displayX,y:.43,z:face+.045,w:displayWidth,h:.7,d:.07},0,tenant===6?color:this.timber)
      if(detailed){
       add(trim,e,{x:dx-side*.35,y:1.1,z:face+.07,w:.04,h:.4,d:.05})
       if(tenant===2||tenant===4)for(const y of [1.1,1.65]){
        add(trim,e,{x:displayX,y,z:face+.052,w:displayWidth*.9,h:.045,d:.035},0,this.timber)
        for(let item=0;item<5;item++)add(trim,e,{x:displayX+(item-2)*displayWidth*.15,y:y+.14,z:face+.06,w:displayWidth*.1,h:.23,d:.04},0,this.shopColors[(tenant+item)%8])
       }
      }
     }
     if(detailed&&frames)for(let floor=0;floor*4.2+3.35<height;floor++)
      add(frames,e,{x:bay.x,y:floor*4.2+1.9,z:face+.016,w:bay.width,h:2.9,d:1})
    }
   }
   // Complete dwelling bays or continuous parapets; both follow the glazing grid.
   if(balconies&&railBalconies&&e.design.use.primary==='apartments'&&distance<65&&balconyBuildings++<BALCONY_BUILDING_LIMIT){
    const plan=colonyBalconies(e.spec,e.design),batch=plan.style==='rail'?railBalconies:balconies,parapet=e.color.clone().lerp(e.trim,.25),tint=plan.style==='rail'?e.trim:parapet
    for(const section of plan.sections)add(batch,e,{x:section.x,y:section.y,z:section.z,w:section.width,h:1,d:section.depth},0,tint)
    if(detailed)for(const divider of plan.dividers)add(trim,e,divider,0,parapet)
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
  let structuralWrites=0
  for(const batch of this.structures.values())structuralWrites+=batch.flush()
  for(const [key,batch] of this.batches){
   if(this.structures.has(key as StructureKind))continue
   batch.instanceMatrix.needsUpdate=true;if(batch.instanceColor)batch.instanceColor.needsUpdate=true;batch.computeBoundingSphere()
  }
  this.group.userData={buildings:this.entries.length,visible,near,asset:!!this.modules,legacyBuildings:0,structuralInstances:shell.mesh.count+frontShell.mesh.count+mixedShell.mesh.count,structuralWrites,windowFrames:frames?.count??0,balconies:(balconies?.count??0)+(railBalconies?.count??0),railBalconies:railBalconies?.count??0,shopSigns:signs.count,awnings:awnings?.count??0,retailBuildings,planters:pots.count,stairBuildings,enclosedStairs,stairFlights:stairFlights?.count??0,roofBuildings,roofDetailed,roofUnits}

 }
 setDaylight(daylight:number){this.facade.emissiveIntensity=this.entranceFacade.emissiveIntensity=this.mixedFacade.emissiveIntensity=.015+(1-daylight)*.5}
 private clearBatches(){this.structuresDirty=true;this.structures.clear();for(const e of this.entries)for(const p of e.parts)p.slot.index=-1;for(const m of this.batches.values()){if(m.geometry.getAttribute('aColonyFacade')||m.geometry.getAttribute('aShopSign'))m.geometry.dispose();m.removeFromParent();m.dispose()}this.batches.clear()}
 dispose(){this.disposed=true;this.clearBatches();this.fallback.dispose();this.facade.dispose();this.entranceFacade.dispose();this.mixedFacade.dispose();this.frame.dispose();this.roofEquipment.dispose();this.door.dispose();this.signGeometry.dispose();this.signs.map?.dispose();this.signs.dispose();this.group.removeFromParent()}
}
