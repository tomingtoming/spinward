import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import contract from '../../assets/blender/neighborhood-fronts.json'
import type { CityBuilding } from './cityLayout'

export const NEIGHBORHOOD_SHOPS = contract.shops
export function matchNeighborhoodLot(buildings: readonly CityBuilding[], radius:number) {
  if(radius!==contract.radius)return null
  const t=contract.building
  return buildings.find(b=>b.kind===t.kind&&b.front?.axis===t.front.axis&&b.front.side===t.front.side&&
    (['azimuth','axial','width','depth','height'] as const).every(k=>Math.abs(b[k]-t[k])<1e-6))??null
}
export function neighborhoodPoint(b:CityBuilding,radius:number,p:THREE.Vector3) {
  const f=b.front!,t=f.axis==='tangent'?f.side*p.z:-f.side*p.x,a=f.axis==='tangent'?f.side*p.x:f.side*p.z
  const az=b.azimuth+t/radius
  return p.set(Math.cos(az)*(radius-p.y),b.axial+a,Math.sin(az)*(radius-p.y))
}
export function neighborhoodDistance(b:CityBuilding,radius:number,x:number,azimuth:number,axial:number,altitude:number) {
  const f=b.front!,t=Math.atan2(Math.sin(azimuth-b.azimuth),Math.cos(azimuth-b.azimuth))*radius,a=axial-b.axial
  const px=f.axis==='tangent'?f.side*a:-f.side*t,pz=f.axis==='tangent'?f.side*t:f.side*a
  const depth=f.axis==='tangent'?b.width:b.depth
  return Math.hypot(Math.max(0,Math.abs(px-x)-5.2),Math.max(0,depth/2+.16-pz,pz-depth/2-.95),Math.max(0,-altitude,altitude-4.2))
}
export function neighborhoodFade(distance:number,altitude:number) {
  return (1-THREE.MathUtils.smoothstep(distance,140,175))*(1-THREE.MathUtils.smoothstep(altitude,12,22))
}
type Entry={id:string;x:number;groups:THREE.Group[];blend:{value:number};coverage:{value:number}}

// An optional facade overlay: failed loading leaves the ordinary closed shell.
// Geometry is authored in metres and bound to this exact lot, never stretched.
export class NeighborhoodFronts {
  readonly group=new THREE.Group()
  private lot:CityBuilding|null=null
  private radius=1
  private asset:THREE.Group|null=null
  private entries:Entry[]=[]
  private requested=false
  private disposed=false
  private daylight=1
  private readonly params=new URLSearchParams(window.location.search)
  private readonly enabled=this.params.get('shops')!=='0'
  constructor(parent:THREE.Group){this.group.name='neighborhood-shops';parent.add(this.group)}
  rebuild(buildings:readonly CityBuilding[],radius:number){
    this.clear();this.radius=radius;this.lot=matchNeighborhoodLot(buildings,radius)
    if(!this.lot||!this.enabled)return
    for(const shop of NEIGHBORHOOD_SHOPS){
      const groups=[0,1].map(lod=>{const g=new THREE.Group();g.name=`${shop.id}-lod${lod}`;g.visible=false;this.group.add(g);return g})
      this.entries.push({id:shop.id,x:shop.x,groups,blend:{value:0},coverage:{value:0}})
    }
    this.mount()
  }
  private mount(){
    if(!this.asset||!this.lot)return
    const origin=neighborhoodPoint(this.lot,this.radius,new THREE.Vector3());this.group.position.copy(origin)
    for(const e of this.entries)for(const [lod,g] of e.groups.entries()){
      if(g.children.length)continue
      const source=this.asset.getObjectByName(`${e.id}_lod${lod}`);if(!source)continue
      source.updateWorldMatrix(true,true)
      const materials=new Map<THREE.Material,THREE.Material>()
      source.traverse(o=>{
        if(!(o instanceof THREE.Mesh))return
        const geo=o.geometry.clone().applyMatrix4(o.matrixWorld),positions=geo.attributes.position,p=new THREE.Vector3()
        for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i);neighborhoodPoint(this.lot!,this.radius,p).sub(origin);positions.setXYZ(i,p.x,p.y,p.z)}
        geo.computeVertexNormals();geo.computeBoundingSphere()
        const clone=(m:THREE.Material)=>{
          let copy=materials.get(m);if(copy)return copy
          copy=m.clone();copy.onBeforeCompile=shader=>{
            shader.uniforms.shopBlend=e.blend;shader.uniforms.shopCoverage=e.coverage
            shader.fragmentShader='uniform float shopBlend;\nuniform float shopCoverage;\n'+shader.fragmentShader
            shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
              vec2 px=floor(gl_FragCoord.xy);
              float n=fract(sin(dot(px,vec2(12.9898,78.233)))*43758.5453);
              float farNoise=fract(sin(dot(px,vec2(39.346,11.135)))*24634.6345);
              if(farNoise>=shopCoverage)discard;
              if(${lod===0?'n<shopBlend':'n>=shopBlend'})discard;`)
          };copy.customProgramCacheKey=()=>`neighborhood-${lod}`;materials.set(m,copy);return copy
        }
        const mesh=new THREE.Mesh(geo,Array.isArray(o.material)?o.material.map(clone):clone(o.material));mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh)
      })
    }
    this.setDaylight(this.daylight)
  }
  update(azimuth:number,axial:number,altitude:number){
    if(!this.lot||!this.enabled)return
    if(!this.requested&&!this.disposed&&altitude<25&&this.entries.some(e=>neighborhoodDistance(this.lot!,this.radius,e.x,azimuth,axial,altitude)<190)){
      this.requested=true;new GLTFLoader().load('/assets/buildings/neighborhood-fronts.glb',gltf=>{
        if(this.disposed){this.release(gltf.scene);return}this.asset=gltf.scene;this.mount()
      },undefined,error=>console.warn('Neighbourhood fronts unavailable; keeping ordinary facades.',error))
    }
    for(const e of this.entries){
      const distance=neighborhoodDistance(this.lot,this.radius,e.x,azimuth,axial,altitude)
      const forced=this.params.has('debug')?this.params.get('shopsLod'):null
      e.blend.value=forced==='0'?0:forced==='1'?1:THREE.MathUtils.smoothstep(distance,45,60)
      e.coverage.value=neighborhoodFade(distance,altitude)
      e.groups.forEach((g,lod)=>{g.visible=g.children.length>0&&e.coverage.value>0&&(lod===0?e.blend.value<1:e.blend.value>0);g.userData={distance,blend:e.blend.value,coverage:e.coverage.value}})
    }
  }
  setDaylight(daylight:number){this.daylight=daylight;this.group.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial)m.emissiveIntensity=1+(1-daylight)*1.5})}
  private release(root:THREE.Object3D){
    const materials=new Set<THREE.Material>();root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}});materials.forEach(m=>m.dispose())
  }
  clear(){for(const e of this.entries)for(const g of e.groups){this.release(g);g.removeFromParent()}this.entries=[];this.lot=null}
  dispose(){this.disposed=true;this.clear();if(this.asset)this.release(this.asset);this.asset=null;this.group.removeFromParent()}
}
