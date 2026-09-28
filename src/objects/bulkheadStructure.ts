import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { BULKHEAD_SECTORS, BULKHEAD_SECTOR_ANGLE, BULKHEAD_PRIMARY_OFFSET } from './bulkheadLayout'

const TAU = Math.PI * 2

/** Pressure-wall relief: a load path from the rim through annular girders to
 * the axial transfer collar. Dimensions are metres, never texture pixels. */
export function bulkheadStructurePlan(radius: number, length: number, port: boolean) {
  const scale = Math.min(radius / 3200, length / 1200)
  return {
    scale, depth: 24 * scale, ribWidth: 26 * scale,
    collar: THREE.MathUtils.clamp(radius * .03, 2.5, 120),
    rings: [.26, .58, .78, .976].map(r => radius * r),
    // Equipment has fixed human dimensions. Small habitats omit it rather
    // than shrinking doors, handrails and pipe clamps into decorative noise.
    services: radius < 180 ? [] : Array.from({ length: BULKHEAD_SECTORS * 2 }, (_, i) => {
      const angle = BULKHEAD_PRIMARY_OFFSET + (i % BULKHEAD_SECTORS + .5) * BULKHEAD_SECTOR_ANGLE
      const radial = radius * (i < BULKHEAD_SECTORS ? .63 : .86)
      return { angle, radial, label: `${port ? 'P' : 'U'}-${String(i + 1).padStart(2, '0')}` }
    })
  }
}

function annulus(inner: number, outer: number, depth: number, z: number, segments = 192) {
  const p: number[] = [], idx: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = TAU * i / segments, b = TAU * (i + 1) / segments
    const corners = [[inner,a,z],[outer,a,z],[outer,b,z],[inner,b,z],
      [inner,a,z+depth],[outer,a,z+depth],[outer,b,z+depth],[inner,b,z+depth]]
      .map(([r,t,h]) => [r*Math.cos(t),r*Math.sin(t),h])
    for (const face of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5]]) {
      const k = p.length / 3
      for (const j of face) p.push(...corners[j])
      idx.push(k,k+1,k+2,k,k+2,k+3)
    }
  }
  const g = new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(p,3))
  g.setIndex(idx);g.computeVertexNormals();return g
}

function merged(parts: THREE.BufferGeometry[], material: THREE.Material, name: string) {
  // Box/annulus geometry differ in UVs; these materials need vertex normals only.
  for (const g of parts) g.deleteAttribute('uv')
  const geometry = mergeGeometries(parts)!
  for (const g of parts) g.dispose()
  const mesh = new THREE.Mesh(geometry, material);mesh.name = name;mesh.receiveShadow = true
  return mesh
}

export class BulkheadStructure {
  readonly group = new THREE.Group()
  private readonly frame = new THREE.MeshStandardMaterial({color:0x84918f,roughness:.86,metalness:.18})
  private readonly inset = new THREE.MeshStandardMaterial({color:0x354852,roughness:.92,metalness:.14})
  private readonly trim = new THREE.MeshStandardMaterial({color:0xb0aa94,roughness:.78,metalness:.25})
  private readonly lights = new THREE.MeshStandardMaterial({color:0xc7b898,emissive:0xffd6a2,emissiveIntensity:.1,roughness:.65})
  private modules: THREE.Object3D[] = []
  private moduleAsset: THREE.Object3D | null = null
  private services: THREE.Group[] = []
  private assetRequested = false
  private daylight = 1
  private disposed = false

  constructor() { this.group.name = 'bulkhead-structure';this.group.userData.moduleStatus = 'unrequested' }

  rebuild(radius: number, length: number, ends: number[]) {
    this.clear();this.group.userData.ends = [...ends]
    this.group.userData.services = []
    for (const sign of ends) {
      const port = sign < 0, plan = bulkheadStructurePlan(radius,length,port), s = plan.scale
      const segments=radius>=180?192:48
      const face = new THREE.Group();face.name = port ? 'bulkhead-port' : 'bulkhead-utilities'
      face.rotation.x = sign*Math.PI/2;face.position.y = sign*length/2
      this.group.add(face)
      const frames: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [], trims: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = []
      const box = (target: THREE.BufferGeometry[], x:number,y:number,z:number,w:number,h:number,d:number,angle=0) => {
        const g = new THREE.BoxGeometry(w,h,d).translate(x,y,z+d/2).rotateZ(angle);target.push(g)
      }
      for (const [i,r] of plan.rings.entries()) {
        const width = [36,56,24,64][i]*s, depth = [36,50,30,38][i]*s
        frames.push(annulus(r-width/2,r+width/2,depth+1*s,-1*s,segments))
        trims.push(annulus(r-width/2,r-width/2+4*s,2*s,depth,segments))
      }
      for (let i=0;i<BULKHEAD_SECTORS;i++) {
        const a=BULKHEAD_PRIMARY_OFFSET+i*BULKHEAD_SECTOR_ANGLE,start=plan.rings[0],end=plan.rings[3],span=end-start,center=(start+end)/2
        const primary=i%2===0,width=primary?72*s:plan.ribWidth,depth=primary?60*s:plan.depth
        // I-section ribs keep a deep web and a broad front flange. The back
        // is anchored in the pressure wall; there are no floating strokes.
        box(frames,center,0,-1*s,span,width*.3,depth+1*s,a)
        box(frames,center,0,depth-4*s,span,width,4*s,a)
        if(primary)box(frames,center,0,-s,span,width*1.2,7*s,a)
        for (const [index,r] of plan.rings.slice(0,3).entries()) box(trims,r,0,Math.max(depth,[36,50,30][index]*s),primary?94*s:36*s,primary?98*s:38*s,2*s,a)
        // Six paired transfer trunks connect the central collar to the load ring.
        if (primary) {
          const inner=plan.collar*2.35,outer=plan.rings[0]
          for(const side of [-1,1])box(frames,(inner+outer)/2,side*18*s,-1*s,outer-inner,12*s,24*s,a)
        }
        // Ventilation/service cassettes occupy the bays between the girders.
        // The utility end has paired banks; the port end has fewer, wider bays.
        for (const row of [0,1]) {
          const r=radius*(row===0?.44:.875),a=BULKHEAD_PRIMARY_OFFSET+(i+.5)*BULKHEAD_SECTOR_ANGLE,w=(port?140:112)*s,h=(port?76:96)*s
          box(panels,r,0,-.1*s,h,w,3.1*s,a)
          for(const offset of [-1,1])box(frames,r+offset*(h/2+2*s),0,-1*s,4*s,w+8*s,9*s,a)
          for(let l=0;l<(port?4:6);l++)box(trims,r-h/2+5*s+l*(h-10*s)/(port?3:5),0,4*s,2.4*s,w-6*s,4*s,a)
          const trunkEnd=plan.rings[row===0?1:3],trunkStart=r+h/2
          for(const side of [-1,1])box(frames,(trunkStart+trunkEnd)/2,side*9*s,-s,trunkEnd-trunkStart,5*s,6*s,a)
          // Small supported fixtures, not a continuous glowing wheel.
          box(lights,r+h/2+4*s,0,8*s,1.3*s,Math.min(8*s,8),.4*s,a)
        }
      }
      const collar=plan.collar
      frames.push(annulus(collar*1.42,collar*2.35,16*s,-s,96))
      trims.push(annulus(collar*2.25,collar*2.35,6*s,15*s,96))
      frames.push(annulus(collar*1.08,collar*1.42,Math.min(30*s,30)+s,-s,96))
      trims.push(annulus(collar*1.40,collar*1.52,5*s,-s,96))
      // Closed pressure leaves retain the disk behind them. The port has a
      // paired transfer seal; the opposite end has a segmented utility cover.
      const hatch=new THREE.CircleGeometry(collar*1.06,96);hatch.translate(0,0,2*s);panels.push(hatch)
      if(port)box(frames,0,0,2.1*s,2*s,collar*2.05,3*s)
      else for(let i=0;i<3;i++)box(frames,collar*.52,0,2.1*s,collar,2*s,3*s,i*TAU/3)
      face.add(merged(frames,this.frame,'bulkhead-girders'),merged(panels,this.inset,'bulkhead-equipment'),
        merged(trims,this.trim,'bulkhead-flanges'),merged(lights,this.lights,'bulkhead-markers'))
      for(const service of plan.services) {
        const anchor=new THREE.Group();anchor.name='bulkhead-service-'+service.label
        anchor.position.set(service.radial*Math.cos(service.angle),service.radial*Math.sin(service.angle),-.04)
        // Module Y points inward toward the axis (local up under spin gravity).
        anchor.rotation.z=service.angle+Math.PI/2;face.add(anchor);this.services.push(anchor)
        this.group.userData.services.push({end:sign,...service,position:anchor.position.toArray()})
      }
    }
    this.group.userData.triangles = 0
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)this.group.userData.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3})
    this.installServices()
    if(this.services.length&&!this.assetRequested&&typeof window!=='undefined')this.loadServices()
    this.setDaylight(this.daylight)
  }

  private loadServices() {
    this.assetRequested=true;this.group.userData.moduleStatus='loading'
    new GLTFLoader().loadAsync('/assets/bulkhead-service.glb').then(g=>{
      if(this.disposed){g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}});return}
      const near=g.scene.getObjectByName('bulkhead_service_lod0'),mid=g.scene.getObjectByName('bulkhead_service_lod1')
      if(!near||!mid)throw Error('Missing bulkhead service LOD')
      this.moduleAsset=g.scene;this.modules=[near,mid]
      g.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=false;o.receiveShadow=true}})
      this.group.userData.moduleStatus='blender';this.installServices()
    }).catch(e=>{this.group.userData.moduleStatus='unavailable';console.warn('Bulkhead service module unavailable',e)})
  }

  private installServices() {
    for(const anchor of this.services) {
      anchor.clear()
      if(!this.modules.length)continue
      const lod=new THREE.LOD();lod.name='bulkhead-service-lod'
      lod.addLevel(this.modules[0].clone(true),0,.15);lod.addLevel(this.modules[1].clone(true),120,.15)
      lod.addLevel(new THREE.Object3D(),650,.15);anchor.add(lod)
    }
  }

  setDaylight(value:number) {this.daylight=value;this.lights.emissiveIntensity=.08+.32*(1-THREE.MathUtils.clamp(value,0,1))**2}

  private clear() {
    // Shared module geometry belongs to the asset, not individual LOD clones.
    for(const anchor of this.services)anchor.clear()
    this.services=[]
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()})
    this.group.clear()
  }

  dispose() {
    this.disposed=true
    this.clear();this.moduleAsset?.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})
    for(const m of [this.frame,this.inset,this.trim,this.lights])m.dispose()
  }
}
