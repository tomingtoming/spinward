import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CAFE_PILOT, LOBBY_PILOT, cafePilotPoint, matchesAuthoredPilot, type AuthoredPilotSpec } from './cafePilot'
import { interiorDistance, type BuildingInterior } from './buildingInteriors'
import { roomDressingOpacity, roomPresence, type RoomEnvironment } from './roomExperience'

type Entry = { interior: BuildingInterior; spec: AuthoredPilotSpec; group: THREE.Group; opacity: {value:number} }

// Optional room detail has its own short range, independent of the building roof
// and exterior LOD. One 325KB asset, no new collision and no per-frame geometry.
export class RoomDressing {
  readonly group=new THREE.Group()
  private entries:Entry[]=[]
  private asset:THREE.Group|null=null
  private requested=false
  private disposed=false
  private radius=1
  private daylight=1
  private readonly enabled=new URLSearchParams(window.location.search).get('roomDetails')!=='0'
  constructor(parent:THREE.Group){this.group.name='room-dressing';parent.add(this.group)}
  rebuild(interiors:BuildingInterior[],radius:number){
    this.clear();this.radius=radius
    for(const spec of [CAFE_PILOT,LOBBY_PILOT]) {
      const interior=interiors.find(i=>matchesAuthoredPilot(i,radius,spec))
      if(!interior)continue
      const group=new THREE.Group();group.name=`${spec.id}-room-dressing`;this.group.add(group)
      this.entries.push({interior,spec,group,opacity:{value:0}})
    }
    this.mount()
  }
  private mount(){
    if(!this.asset||!this.enabled)return
    for(const entry of this.entries){
      if(entry.group.children.length)continue
      const source=this.asset.getObjectByName(`${entry.spec.id}_room_dressing`)
      if(!source)continue
      source.updateWorldMatrix(true,true)
      const origin=cafePilotPoint(entry.interior,this.radius,new THREE.Vector3())
      entry.group.position.copy(origin)
      const materials=new Map<THREE.Material,THREE.Material>()
      source.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return
        const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld),positions=geometry.attributes.position,point=new THREE.Vector3()
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i);cafePilotPoint(entry.interior,this.radius,point).sub(origin);positions.setXYZ(i,point.x,point.y,point.z)
        }
        geometry.computeVertexNormals();geometry.computeBoundingSphere()
        const clone=(source:THREE.Material)=>{
          let material=materials.get(source)
          if(material)return material
          material=source.clone();material.onBeforeCompile=shader=>{
            shader.uniforms.roomDetailOpacity=entry.opacity
            shader.fragmentShader='uniform float roomDetailOpacity;\n'+shader.fragmentShader
            shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
              float roomNoise=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
              if(roomNoise>=roomDetailOpacity)discard;`)
          }
          material.customProgramCacheKey=()=> 'room-detail-dither-v1';materials.set(source,material);return material
        }
        const mesh=new THREE.Mesh(geometry,Array.isArray(object.material)?object.material.map(clone):clone(object.material));mesh.castShadow=true;mesh.receiveShadow=true;entry.group.add(mesh)
      })
    }
    this.setDaylight(this.daylight)
  }
  update(azimuth:number,axial:number,altitude:number){
    if(this.enabled&&!this.requested&&!this.disposed&&this.entries.some(e=>interiorDistance(e.interior,this.radius,azimuth,axial,altitude)<32&&altitude<6.5)){
      this.requested=true
      new GLTFLoader().load('/assets/buildings/room-dressing.glb',gltf=>{
        if(this.disposed){this.release(gltf.scene);return}
        this.asset=gltf.scene;this.mount()
      },undefined,error=>console.warn('Room detail unavailable; keeping existing furnishings.',error))
    }
    for(const e of this.entries){
      e.opacity.value=this.enabled?roomDressingOpacity(e.interior,this.radius,azimuth,axial,altitude):0
      e.group.visible=e.opacity.value>0&&e.group.children.length>0;e.group.userData.opacity=e.opacity.value
    }
  }
  sampleEnvironment(azimuth:number,axial:number,altitude:number):RoomEnvironment{
    const result:RoomEnvironment={cafe:0,lobby:0,shelter:0}
    for(const e of this.entries)result[e.spec.id]=roomPresence(e.interior,this.radius,azimuth,axial,altitude)
    result.shelter=Math.max(result.cafe,result.lobby);return result
  }
  setDaylight(daylight:number){
    this.daylight=daylight
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial)m.emissiveIntensity=1+(1-daylight)*2})
  }
  private release(root:THREE.Object3D, releaseTextures=true){
    const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>()
    root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
    for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose()}
    if(releaseTextures)textures.forEach(t=>t.dispose())
  }
  clear(){for(const e of this.entries){this.release(e.group,false);e.group.removeFromParent()}this.entries=[]}
  dispose(){this.disposed=true;this.clear();if(this.asset)this.release(this.asset);this.asset=null;this.group.removeFromParent()}
}
