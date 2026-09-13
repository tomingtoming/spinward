import * as THREE from 'three'
import { type CityPlan,type CityBuilding } from './cityLayout'
import {SurfaceIndex} from './streetAccess'
import {planPublicPark} from './publicPark'
import {getStreetProfile} from './streetProfile'
import { centralPlazaArrival } from './civicArrival'
import { civicSign } from './civicSign'

export type CarShareBay = { azimuth: number; axial: number; heading: number; signSide: number; height?:number; driveway?:number }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** A dedicated forecourt bay inside a parcel, never a moving traffic lane.
 * Reserve the entire parking/boarding area and the parcel's entrance route. */
export function planCarShareBay(plan: CityPlan, radius: number, anchor = centralPlazaArrival(radius), excluded: readonly CarShareBay[] = []): CarShareBay | null {
  if(radius<800)return null
  type Rect={azimuth:number;axial:number;tangentWidth:number;axialLength:number}
  const obstacles:Rect[]=[],index=new SurfaceIndex(radius)
  const insert=(r:Rect)=>{index.insert(r,obstacles.length);obstacles.push(r)}
  for(const b of plan.buildings){
    insert({azimuth:b.azimuth,axial:b.axial,tangentWidth:b.width+.4,axialLength:b.depth+.4})
    if(b.access&&b.front){const a=b.access,t=b.front.axis==='tangent';insert({azimuth:a.entrance.azimuth+wrap(a.roadEdge.azimuth-a.entrance.azimuth)/2,axial:(a.entrance.axial+a.roadEdge.axial)/2,tangentWidth:t?a.length:a.width+.4,axialLength:t?a.width+.4:a.length})}
  }
  for(const r of plan.roads){const sidewalk=getStreetProfile(r.kind,radius).sidewalk*2;insert({...r,tangentWidth:r.tangentWidth+(r.axialLength>r.tangentWidth?sidewalk:0),axialLength:r.axialLength+(r.axialLength>r.tangentWidth?0:sidewalk)})}
  for(const t of plan.trees)insert({azimuth:t.azimuth,axial:t.axial,tangentWidth:2,axialLength:2})
  const park=planPublicPark(plan,radius)
  if(park)for(const path of park.paths)insert({azimuth:park.azimuth+path.x/radius,axial:park.axial+path.y,tangentWidth:path.width+1,axialLength:path.depth+1})
  const sites:CityBuilding[]=[...plan.buildings]
  for(const patch of plan.patches){
    if(patch.kind!=='park'||Math.hypot(wrap(patch.azimuth-anchor.azimuth)*radius,patch.axial-anchor.axialPosition)>900)continue
    for(const axis of ['tangent','axial']as const)for(const side of [-1,1]as const){
      const t=axis==='tangent',half=(t?patch.tangentExtent:patch.axialExtent)/2
      const adjoining=plan.roads.some(r=>{if((r.axialLength>r.tangentWidth)!==t||r.kind==='alley')return false
        const across=t?wrap(r.azimuth-patch.azimuth)*radius:r.axial-patch.axial,along=t?r.axial-patch.axial:wrap(r.azimuth-patch.azimuth)*radius
        const gap=side*across-(t?r.tangentWidth:r.axialLength)/2-half
        return gap>=0&&gap<=8&&Math.abs(along)+(t?patch.axialExtent:patch.tangentExtent)/2<(t?r.axialLength:r.tangentWidth)/2-5})
      if(adjoining)sites.push({azimuth:patch.azimuth,axial:patch.axial,width:0,depth:0,height:0,kind:'block',tone:0,front:{axis,side},parcel:{tangentOffset:0,axialOffset:0,tangentExtent:patch.tangentExtent,axialExtent:patch.axialExtent}})
    }
  }
  const near=sites.filter(b=>b.parcel&&b.front&&Math.hypot(wrap(b.azimuth-anchor.azimuth)*radius,b.axial-anchor.axialPosition)<900).sort((a,b)=>Math.hypot(wrap(a.azimuth-anchor.azimuth)*radius,a.axial-anchor.axialPosition)-Math.hypot(wrap(b.azimuth-anchor.azimuth)*radius,b.axial-anchor.axialPosition))
  for(const b of near){
    const p=b.parcel!,front=b.front!,t=front.axis==='tangent',along=t?p.axialExtent:p.tangentExtent
    if(along<16)continue
    for(const shift of [-along*.28,along*.28]){
      const dx=p.tangentOffset+(t?front.side*(p.tangentExtent/2-1.5):shift),dy=p.axialOffset+(t?shift:front.side*(p.axialExtent/2-1.5))
      const bay={azimuth:b.azimuth+dx/radius,axial:b.axial+dy,heading:t?0:Math.PI/2,signSide:t?front.side:-front.side,height:.13}
      // Parking rectangle reaches 1.25m toward the street and 3.1m inward,
      // including its sign and a clear boarding/exit route beside the car.
      const inward=-front.side*.925,rect:Rect={azimuth:bay.azimuth+(t?inward:0)/radius,axial:bay.axial+(t?0:inward),tangentWidth:t?4.35:6.6,axialLength:t?6.6:4.35}
      const centreT=p.tangentOffset/radius+b.azimuth,centreA=p.axialOffset+b.axial
      if(Math.abs(wrap(rect.azimuth-centreT))*radius+rect.tangentWidth/2>p.tangentExtent/2||Math.abs(rect.axial-centreA)+rect.axialLength/2>p.axialExtent/2)continue
      if([...index.query(rect)].some(i=>{const o=obstacles[i];return Math.abs(wrap(o.azimuth-rect.azimuth))*radius<(o.tangentWidth+rect.tangentWidth)/2&&Math.abs(o.axial-rect.axial)<(o.axialLength+rect.axialLength)/2}))continue
      if(excluded.some(e=>Math.hypot(wrap(e.azimuth-bay.azimuth)*radius,e.axial-bay.axial)<8))continue
      const road=plan.roads.filter(r=>(r.axialLength>r.tangentWidth)===t&&r.kind!=='alley').map(r=>({r,across:front.side*(t?wrap(r.azimuth-bay.azimuth)*radius:r.axial-bay.axial),along:Math.abs(t?r.axial-bay.axial:wrap(r.azimuth-bay.azimuth)*radius)})).filter(v=>v.across>0&&v.along+3.3<(t?v.r.axialLength:v.r.tangentWidth)/2).sort((a,b)=>a.across-b.across)[0]
      if(!road)continue
      const driveway=road.across-(t?road.r.tangentWidth:road.r.axialLength)/2+.8
      if(driveway>12)continue
      return {...bay,driveway}
    }
  }
  return null
}

export function carShareBayCollider(bay:CarShareBay,radius:number):CityBuilding{
 const x=bay.signSide*.925,c=Math.cos(bay.heading),s=Math.sin(bay.heading)
 return {azimuth:bay.azimuth-c*x/radius,axial:bay.axial+s*x,width:4.35,depth:6.6,yaw:-bay.heading,height:bay.height??.2,baseHeight:0,groundMargin:0,collisionMargin:0,kind:'block',tone:.5}
}

export function carShareDrivewayQuads(bay:CarShareBay){
 if(!bay.driveway)return []
 const xs=[1.25,2,bay.driveway-.9,bay.driveway],hs=[bay.height??.13,.32,.32,.2]
 const quads=xs.slice(1).map((x,i)=>[
  [-bay.signSide*xs[i],hs[i],-3.3],[-bay.signSide*x,hs[i+1],-3.3],[-bay.signSide*x,hs[i+1],3.3],[-bay.signSide*xs[i],hs[i],3.3]
 ])
 // The existing sidewalk is visual paving over the zero-height habitat
 // contact floor. Buried side approaches prevent a new hard .32m edge.
 for(const side of [-1,1])for(let i=0;i<xs.length-1;i++)quads.push([
  [-bay.signSide*xs[i],0,side*4.3],[-bay.signSide*xs[i+1],0,side*4.3],[-bay.signSide*xs[i+1],hs[i+1],side*3.3],[-bay.signSide*xs[i],hs[i],side*3.3]
 ])
 return quads
}
export function carShareBayColliders(bay:CarShareBay,radius:number):CityBuilding[]{
 const c=Math.cos(bay.heading),s=Math.sin(bay.heading)
 return [carShareBayCollider(bay,radius),...carShareDrivewayQuads(bay).map(q=>{
  const points=[q[0],q[1],q[2],q[0],q[2],q[3]],vertices=points.flatMap(([x,h,z])=>[-c*x+s*z,s*x+c*z,h])
  const xs=points.map(([x,,z])=>Math.abs(-c*x+s*z)),ys=points.map(([x,,z])=>Math.abs(s*x+c*z))
  return {azimuth:bay.azimuth,axial:bay.axial,width:Math.max(...xs)*2,depth:Math.max(...ys)*2,height:.32,baseHeight:0,groundSurface:true,groundMargin:0,collisionMargin:0,kind:'block' as const,tone:.5,surfaceMesh:vertices}
 })]
}
export function carShareDrivewayRect(bay:CarShareBay,radius:number){
 const distance=bay.driveway??0,c=Math.cos(bay.heading),s=Math.sin(bay.heading),x=-bay.signSide*distance/2
 return {azimuth:bay.azimuth-c*x/radius,axial:bay.axial+s*x,tangentWidth:Math.abs(c)*distance+Math.abs(s)*6.6,axialLength:Math.abs(s)*distance+Math.abs(c)*6.6,kind:'local' as const}
}

export class CarShareStation {
  readonly group = new THREE.Group()
  bay: CarShareBay | null = null
  private sign: THREE.Group | null = null
  private readonly paving=new THREE.MeshStandardMaterial({color:0x555e59,roughness:.98,side:THREE.DoubleSide})
  private readonly paint = new THREE.MeshStandardMaterial({ color: 0xd6d2bb, roughness: .95 })

  configure(bay: CarShareBay | null, radius: number, label = 'Central square · 01') {
    this.clear(); this.bay = bay
    this.group.visible = !!bay
    if (!bay) return
    const c = Math.cos(bay.azimuth), s = Math.sin(bay.azimuth)
    const up = new THREE.Vector3(-c, 0, -s)
    const forward = new THREE.Vector3(-s * Math.sin(bay.heading), Math.cos(bay.heading), c * Math.sin(bay.heading))
    this.group.matrixAutoUpdate = false
    this.group.matrix.makeBasis(up.clone().cross(forward), up, forward)
      .setPosition(c * (radius - (bay.height??.2)), bay.axial, s * (radius - (bay.height??.2)))
    const paving=new THREE.Mesh(new THREE.BoxGeometry(4.35,.025,6.6),this.paving)
    paving.position.set(bay.signSide*.925,-.0125,0);this.group.add(paving)
    for(const q of carShareDrivewayQuads(bay)){
      const points=[q[0],q[1],q[2],q[0],q[2],q[3]].flatMap(([x,h,z])=>[x,h-(bay.height??.13),z])
      const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.computeVertexNormals()
      const mesh=new THREE.Mesh(geometry,this.paving);this.group.add(mesh)
    }
    for (const x of [-1.22, 1.22]) for (const z of [-3, 3]) {
      for (const [w, d, dx, dz] of [[.06, .8, 0, -Math.sign(z) * .4], [.6, .06, -Math.sign(x) * .3, 0]]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, .012, d), this.paint)
        mesh.position.set(x + dx, .008, z + dz); this.group.add(mesh)
      }
    }
    this.sign = civicSign('CAR SHARE', [label, 'Return to a marked bay'], .9)
    this.sign.position.set(bay.signSide * 2.5, .12, -2.6)
    this.sign.rotation.y = -bay.signSide * Math.PI / 2
    this.group.add(this.sign)
  }

  private clear() {
    this.sign?.userData.dispose(); this.sign = null
    for (const child of this.group.children) if (child instanceof THREE.Mesh) child.geometry.dispose()
    this.group.clear()
  }
  dispose() { this.clear(); this.paint.dispose();this.paving.dispose(); this.group.removeFromParent() }
}
