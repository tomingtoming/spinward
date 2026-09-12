import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createLandscapeCrown, createMeadowTexture } from './landscapeVegetation'
import { citySurfaceVertices } from './citySurfaceMesh'
import { riverCentre, RIVER_BRIDGE_YAW, type RiverDistrict as Plan, type RiverBox } from './riverDistrictPlan'
import type { RainRoof } from './rainShelter'
import type { CityBuilding } from './cityLayout'
import type { RoomSeat } from '../app/roomSeating'
import type { StreetLampSource } from './streetLampLighting'

/** Bounded river reach. Shared material batches, streamed collision meshes,
 * an advected water shader and three Blender bridge LODs; no reflection pass. */
export class RiverDistrictLayer {
  readonly group = new THREE.Group()
  readonly seats: RoomSeat[] = []
  readonly lamps: StreetLampSource[] = []
  readonly colliders: CityBuilding[] = []
  readonly rainRoofs: RainRoof[] = []
  private time = { value: 0 }
  private radius = 1
  private plan: Plan | null = null
  private bridge: THREE.LOD | null = null
  private fallback: THREE.Mesh | null = null
  private modules: THREE.BufferGeometry[] | null = null
  private disposed = false
  private materials = {
    earth: new THREE.MeshStandardMaterial({ color: '#647558', roughness: 1, side: THREE.DoubleSide }),
    stone: new THREE.MeshStandardMaterial({ color: '#b2b0a1', roughness: .92, side: THREE.DoubleSide }),
    road: new THREE.MeshStandardMaterial({ color: '#454d4b', roughness: .97, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: '#335b50', roughness: .24, metalness: .24, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: '#303e40', roughness: .7, metalness: .35 }),
    wood: new THREE.MeshStandardMaterial({ color: '#897253', roughness: .9 }),
    light: new THREE.MeshStandardMaterial({ color: '#ffdbac', emissive: '#ffd8a1', emissiveIntensity: 0 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#607350', roughness: 1, vertexColors: true }),
    paint: new THREE.MeshStandardMaterial({ color: '#c5c9b9', roughness: .95 })
  }
  constructor(parent: THREE.Group) {
    this.group.name = 'riverside-district'; parent.add(this.group)
    this.materials.earth.color.set('#59764b'); this.materials.earth.map = createMeadowTexture()
    this.materials.stone.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 riverStoneUv;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n riverStoneUv=uv;')
      shader.fragmentShader = 'varying vec2 riverStoneUv;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 cell=riverStoneUv;cell.x+=mod(floor(cell.y),2.)*.5;
        vec2 f=fract(cell),aa=max(fwidth(cell),vec2(.002));
        vec2 line=smoothstep(vec2(.025),vec2(.025)+aa,min(f,1.-f));
        float joints=min(line.x,line.y),fade=1.-smoothstep(.3,.9,max(aa.x,aa.y));
        float tint=fract(sin(dot(floor(cell),vec2(12.9898,78.233)))*43758.5453);
        diffuseColor.rgb*=mix(1.,(.88+tint*.16)*mix(.68,1.,joints),fade);`)
    }
    this.materials.water.onBeforeCompile = shader => {
      shader.uniforms.riverTime = this.time
      shader.vertexShader = 'varying vec2 riverUv;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n riverUv=uv;')
      shader.fragmentShader = 'uniform float riverTime; varying vec2 riverUv;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float wave=sin(riverUv.y*2.-riverTime*.65+sin(riverUv.x*1.7))*sin(riverUv.x*.6+riverUv.y*3.7-riverTime*.8);
        float fade=1.-smoothstep(.3,1.,length(fwidth(riverUv)));
        diffuseColor.rgb*=1.+wave*.12*fade;`)
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal=normalize(normal+vec3(sin(riverUv.y*2.-riverTime*.65)*.05,cos(riverUv.x*1.7+riverTime*.2)*.025,0.));`)
    }
    new GLTFLoader().loadAsync('/assets/buildings/river-bridge.glb').then(g => {
      try {
        if (this.disposed) return
        this.modules = [0, 1, 2].map(i => {
          const node = g.scene.getObjectByName(`river_bridge_lod${i}`)
          if (!(node instanceof THREE.Mesh)) throw Error('Missing river bridge LOD ' + i)
          node.updateWorldMatrix(true, false)
          return node.geometry.clone().applyMatrix4(node.matrixWorld)
        })
        this.installBridge()
      } finally {
        g.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
      }
    }).catch(e => console.warn('River bridge modules unavailable; retaining the matching arch fallback.', e))
  }
  private frame(x: number, y: number, h = 0, yaw = 0) {
    const a = this.plan!.azimuth + x / this.radius, c = Math.cos(a), s = Math.sin(a)
    return new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, 0, c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, -1, 0))
      .setPosition(c * (this.radius - h), this.plan!.axial + y, s * (this.radius - h)).multiply(new THREE.Matrix4().makeRotationY(yaw))
  }
  private stoneUV(g: THREE.BufferGeometry) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i)), h = this.radius - Math.hypot(p.getX(i), p.getZ(i))
      const flat = Math.abs(n.getX(i) * Math.cos(a) + n.getZ(i) * Math.sin(a)) > .7
      uv[i * 2] = (a * this.radius + (flat ? 0 : p.getY(i))) / 1.15
      uv[i * 2 + 1] = flat ? p.getY(i) / .65 : h / .38
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g
  }
  rebuild(plan: Plan | null, radius: number) {
    this.clear(); this.plan = plan; this.radius = radius
    if (!plan) return
    const parts: Record<string, THREE.BufferGeometry[]> = {}
    const add = (key: string, g: THREE.BufferGeometry) => { const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose(); (parts[key] ??= []).push(flat) }
    for (const { material, collider: b } of plan.surfaces) {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(citySurfaceVertices(b.surfaceMesh!, radius), 3))
      g.rotateY(-b.azimuth); g.translate(Math.cos(b.azimuth) * radius, b.axial, Math.sin(b.azimuth) * radius)
      g.computeVertexNormals(); this.stoneUV(g)
      if (material === 'water' || material === 'earth') {
        const uv = g.getAttribute('uv'), v = g.getAttribute('position')
        for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.atan2(v.getZ(i), v.getX(i)) * radius / (material === 'earth' ? 18 : 1), v.getY(i) / (material === 'earth' ? 18 : 1))
      }
      add(material, g)
    }
    this.colliders.push(...plan.colliders)
    // One rotated footprint covers the full oblique deck, including the slim
    // edge wedges that a staircase of inscribed rectangles would leave wet.
    this.rainRoofs.push({cos:Math.cos(plan.azimuth),sin:Math.sin(plan.azimuth),axial:plan.axial,
      radial:radius-5.12,halfWidth:25,halfDepth:5.8,yaw:RIVER_BRIDGE_YAW})
    const box = (b: RiverBox, solid = false) => {
      const g = new THREE.BoxGeometry(b.w, b.height, b.d).rotateZ(b.pitch??0).translate(0, b.height / 2, 0).applyMatrix4(this.frame(b.x, b.y, b.h, b.yaw))
      this.stoneUV(g); add(b.material, g)
      if (solid) this.colliders.push({ azimuth: plan.azimuth + b.x / radius, axial: plan.axial + b.y, width: b.w, depth: b.d, height: b.height,
        baseHeight: b.h, yaw: b.yaw, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5 })
    }
    for (const b of plan.boxes) box(b)
    for (const side of [-1, 1]) for (const y of [-32, 32]) {
      const x = riverCentre(y) + side * 16, yaw = side * Math.PI / 2
      const shift = (d: number) => x + side * d
      box({ x, y, h: 1.63, w: 1.8, d: .48, height: .1, yaw, material: 'wood' }, true)
      box({ x: shift(.23), y, h: 1.68, w: 1.8, d: .07, height: .55, yaw, material: 'wood' }, true)
      for (const dy of [-.65, .65]) box({ x, y: y + dy, h: 1.2, w: .08, d: .42, height: .43, yaw, material: 'metal' }, true)
      this.seats.push({ id: `river-bench-${side}-${y}`, label: 'Riverside bench', radius, azimuth: plan.azimuth + x / radius,
        axialPosition: plan.axial + y, seatHeight: 1.73, groundHeight: 1.2,
        exit: { azimuth: plan.azimuth + (x - side * 1.25) / radius, axialPosition: plan.axial + y } })
    }
    for (const side of [-1, 1]) for (const y of [-87.5, -52.5, -17.5, 17.5, 52.5, 87.5]) {
      const x = riverCentre(y) + side * 20, a = plan.azimuth + x / radius
      box({ x, y, h: 5, w: .12, d: .12, height: 3.5, yaw: 0, material: 'metal' }, true)
      box({ x, y, h: 8.47, w: .38, d: .38, height: .16, yaw: 0, material: 'light' })
      box({ x, y, h: 8.65, w: .52, d: .52, height: .08, yaw: 0, material: 'metal' })
      this.lamps.push({ id: `river-${side}-${y}`, position: new THREE.Vector3(Math.cos(a) * (radius - 8.5), plan.axial + y, Math.sin(a) * (radius - 8.5)),
        down: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), intensity: 75, distance: 18, angle: Math.PI / 2.4 })
    }
    for(const x of [-13.5,13.5]){
      const y=.25*x,a=plan.azimuth+x/radius,h=3.75+.9*Math.cos((x/Math.cos(RIVER_BRIDGE_YAW))/25*Math.PI/2)
      box({x,y,h:h-.09,w:.48,d:.3,height:.08,yaw:RIVER_BRIDGE_YAW,material:'metal'})
      box({x,y,h:h-.12,w:.38,d:.22,height:.04,yaw:RIVER_BRIDGE_YAW,material:'light'})
      this.lamps.push({id:`river-bridge-${x}`,position:new THREE.Vector3(Math.cos(a)*(radius-h+.12),plan.axial+y,Math.sin(a)*(radius-h+.12)),
        down:new THREE.Vector3(Math.cos(a),0,Math.sin(a)),intensity:48,distance:14,angle:Math.PI/2.4})
    }
    const crown = createLandscapeCrown()
    for (const side of [-1, 1]) for (const [i, y] of [-103, -77, -52, 57, 82, 106].entries()) {
      const x = riverCentre(y) + side * (29 + (i % 2) * 3), h = 5, height = 5.5 + (i % 3) * .7
      box({ x, y, h, w: .23, d: .23, height: height * .66, yaw: 0, material: 'wood' }, true)
      const g = crown.clone().scale(height * .7, height * .82, height * .68).applyMatrix4(this.frame(x, y, h))
      const color = new Float32Array(g.getAttribute('position').count * 3), tint = new THREE.Color(i % 2 ? '#97a787' : '#b1b99a')
      for (let n = 0; n < color.length; n += 3) color.set([tint.r, tint.g, tint.b], n)
      g.setAttribute('color', new THREE.BufferAttribute(color, 3)); this.stoneUV(g); add('leaf', g)
    }
    crown.dispose()
    for (const [key, geometries] of Object.entries(parts)) {
      const geometry = mergeGeometries(geometries, false)!
      const mesh = new THREE.Mesh(geometry, this.materials[key === 'arch' ? 'stone' : key as keyof typeof this.materials])
      mesh.name = `river-${key}`; mesh.receiveShadow = true; mesh.castShadow = key !== 'water' && key !== 'earth'
      this.group.add(mesh); if (key === 'arch') this.fallback = mesh
      for (const g of geometries) g.dispose()
    }
    this.group.userData = { surfaces: plan.surfaces.length, colliders: this.colliders.length,
      triangles: this.group.children.reduce((n, o) => n + ((o as THREE.Mesh).geometry?.getAttribute('position').count ?? 0) / 3, 0) }
    this.installBridge()
  }
  private installBridge() {
    if (!this.plan || !this.modules || this.bridge) return
    const lod = new THREE.LOD(); lod.autoUpdate = false
    for (const [i, source] of this.modules.entries()) {
      const g = source.clone(), v = g.getAttribute('position'), c = Math.cos(RIVER_BRIDGE_YAW), s = Math.sin(RIVER_BRIDGE_YAW)
      for (let i=0;i<v.count;i++) { const x=v.getX(i),y=v.getY(i),z=v.getZ(i),a=this.plan.azimuth+(x*c+z*s)/this.radius,r=this.radius-y;
        v.setXYZ(i,Math.cos(a)*r,this.plan.axial+x*s-z*c,Math.sin(a)*r) }
      g.computeVertexNormals(); this.stoneUV(g)
      const mesh = new THREE.Mesh(g, this.materials.stone); mesh.castShadow = true; mesh.receiveShadow = true
      lod.addLevel(mesh, [0, 120, 600][i])
    }
    this.group.add(lod); this.bridge = lod
    if (this.fallback) this.fallback.visible = false
    this.group.userData.blenderReady = true
  }
  update(dt: number) { this.time.value = (this.time.value + Math.max(0, dt)) % 10000 }
  setFocus(a: number, ax: number, h: number) {
    if (!this.plan) return
    const d = Math.hypot(Math.atan2(Math.sin(a - this.plan.azimuth), Math.cos(a - this.plan.azimuth)) * this.radius, ax - this.plan.axial, h - 5)
    for (const o of this.group.children) {if (['river-metal','river-light'].includes(o.name)) o.visible=d<300; if(o.name==='river-leaf'||o.name==='river-wood')o.visible=d<1000}
    const previous=this.group.userData.bridgeLod??2
    const level = d < (previous===0?144:120) ? 0 : d < (previous<=1?720:600) ? 1 : 2
    this.bridge?.levels.forEach((l, i) => { l.object.visible = i === level })
    this.group.userData.bridgeLod = level
  }
  setDaylight(daylight: number) { this.materials.light.emissiveIntensity = .9 * (1 - daylight) }
  clear() {
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    this.group.clear(); this.seats.length = 0; this.lamps.length = 0; this.colliders.length = 0; this.rainRoofs.length = 0
    this.plan = null; this.bridge = null; this.fallback = null; this.group.userData = {}
  }
  dispose() { this.disposed = true; this.clear(); this.materials.earth.map?.dispose(); for (const m of Object.values(this.materials)) m.dispose(); for (const g of this.modules ?? []) g.dispose() }
}
