import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {type RoadKnot} from './roadCurve'
import {sampleStreetPath,streetRibbon,type StreetPath} from './streetPath'
import {citySurfaceVertices} from './citySurfaceMesh'
import {cityBlockCollision} from './authoredCityBlockPlan'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {ColonyBuildings} from './colonyBuildings'
import type {CityPlan,CityBuilding,CityRoad} from './cityLayout'

type Surface={kind:'road'|'walk'|'paint';collider:CityBuilding}
export type CurvedWalkConnection={side:number;end:number;t:number;points:[number,number,number][]}
export type CurvedNeighborhood={azimuth:number;axial:number;patch:CityPlan['patches'][number];knots:RoadKnot[];street:StreetPath;streetLinks:StreetPath[];surfaces:Surface[];buildings:CityBuilding[];colliders:CityBuilding[];sidewalkCuts:CityRoad[];walkConnections:CurvedWalkConnection[]}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
export function curvedStreetPoint(p:CurvedNeighborhood,t:number,offset=0){
 return sampleStreetPath(p.street,t,offset)
}
export function curvedFootwayHeight(p:CurvedNeighborhood,t:number){
 const span=p.knots[2].point[0]-p.knots[0].point[0]
 return .2+.14*Math.min(1,Math.min(t,1-t)*span/4)
}
/** One clear district, bounded and deterministic across city budgets. Its
 * centreline is independent of the rectangular arterial parcel generator. */
export function planCurvedNeighborhood(city:CityPlan,radius:number):CurvedNeighborhood|null{
 if(radius<2000)return null
 const patch=city.patches.filter(p=>p.kind==='park'&&p.tangentExtent>205&&p.tangentExtent<230&&p.axialExtent>300&&p.axialExtent<330&&p.azimuth*radius>750&&p.azimuth*radius<1100&&p.axial>300&&p.axial<900).sort((a,b)=>a.axial-b.axial)[0]
 if(!patch)return null
 const {azimuth,axial}=patch
 const overlaps=(b:{azimuth:number;axial:number},w:number,d:number)=>Math.abs(wrap(b.azimuth-azimuth))*radius<(w+patch.tangentExtent)/2&&Math.abs(b.axial-axial)<(d+patch.axialExtent)/2
 if(city.buildings.some(b=>overlaps(b,b.width,b.depth))||city.roads.some(b=>overlaps(b,b.tangentWidth,b.axialLength)))return null
 const avenues=city.roads.filter(r=>r.axialLength>r.tangentWidth&&Math.abs(r.axial-axial)+85<r.axialLength/2)
 const nearest=(sign:number)=>avenues.filter(r=>sign*wrap(r.azimuth-azimuth)>0).sort((a,b)=>Math.abs(wrap(a.azimuth-azimuth))-Math.abs(wrap(b.azimuth-azimuth)))[0]
 const west=nearest(-1),east=nearest(1);if(!west||!east)return null
 const left=wrap(west.azimuth-azimuth)*radius+west.tangentWidth/2,right=wrap(east.azimuth-azimuth)*radius-east.tangentWidth/2
 if(left< -135||right>135)return null
 const span=(right-left)/2
 const knots:RoadKnot[]=[{point:[left,-45],tangent:[span,0]},{point:[(left+right)/2,12],tangent:[span,28]},{point:[right,38],tangent:[span,0]}]
 const street:StreetPath={id:'garden',azimuth,axial,knots,width:6,kind:'local',level:0,groundHeight:.2}
 // The shared junction connection runs from each avenue centre to the curve's
 // edge. This portion already has the avenue's visible and physical road.
 const streetLinks=[west,east].map((road,i)=>{
  const end=knots[i===0?0:2].point,start:[number,number]=[wrap(road.azimuth-azimuth)*radius,end[1]],tangent:[number,number]=[end[0]-start[0],0]
  return{...street,id:`garden-link-${i}`,groundHeight:0,knots:[{point:start,tangent},{point:end,tangent}]} as StreetPath
 })
 const p:CurvedNeighborhood={azimuth,axial,patch,knots,street,streetLinks,surfaces:[],buildings:[],colliders:[],sidewalkCuts:[],walkConnections:[]}
 const surface=(kind:Surface['kind'],points:number[][],solid=true,visible=true)=>{
  const xs=points.map(v=>v[0]),ys=points.map(v=>v[1]),hs=points.map(v=>v[2]),x=(Math.min(...xs)+Math.max(...xs))/2,y=(Math.min(...ys)+Math.max(...ys))/2
  const b:CityBuilding={azimuth:azimuth+x/radius,axial:axial+y,width:Math.max(...xs)-Math.min(...xs),depth:Math.max(...ys)-Math.min(...ys),height:Math.max(...hs)-Math.min(...hs),baseHeight:Math.min(...hs),groundSurface:true,groundMargin:0,collisionMargin:0,kind:'block',tone:.5,surfaceMesh:points.flatMap(v=>[v[0]-x,v[1]-y,v[2]])}
  if(visible)p.surfaces.push({kind,collider:b});if(solid)p.colliders.push(b)
 }
 const count=Math.ceil((right-left)/1.5)
 for(let i=0;i<count;i++){
  const strip=(kind:Surface['kind'],lo:number,hi:number,h:number,solid=true)=>{
   const [a,b,c,d]=streetRibbon(street,i/count,(i+1)/count,lo,hi).map((v,j)=>[v.x,v.y,kind==='walk'?curvedFootwayHeight(p,(j===0||j===3?i:i+1)/count):h])
   surface(kind,[a,b,c,a,c,d],solid)
  }
  strip('road',-3,3,.2)
  // Two-metre footways taper to carriageway height at each junction.
  for(const side of [-1,1])strip('walk',side*3,side*5,.34)
  if(i%6<3)strip('paint',-.045,.045,.225,false)
 }
 for(const t of [0,1]){
  const v=curvedStreetPoint(p,t),sign=t===0?1:-1
  p.sidewalkCuts.push({azimuth:azimuth+(v.x+sign*2)/radius,axial:axial+v.y,tangentWidth:4.4,axialLength:10,kind:'local'})
  // Legacy streets render at .2m but use the habitat's zero-height contact
  // floor. A buried approach under their asphalt joins that floor smoothly.
  for(const [kind,lo,hi] of [['road',-3,3],['walk',-5,-3],['walk',3,5]] as const){
   const a=[v.x-sign*2,v.y+lo,0],b=[v.x,v.y+lo,.2],c=[v.x,v.y+hi,.2],d=[v.x-sign*2,v.y+hi,0]
   surface(kind,[a,b,c,a,c,d])
  }
 }
 // Join each curved footway to the adjacent two-metre avenue pavement, a
 // metre inside its kerb. Legacy pavement uses zero-height physical contact;
 // buried bevels provide that transition without drawing overlapping paving.
 for(const end of [0,1])for(const side of [-1,1]){
  const origin=curvedStreetPoint(p,end),sign=end===0?1:-1
  const atX=(x:number)=>{let lo=0,hi=1;for(let i=0;i<35;i++){const t=(lo+hi)/2;if(curvedStreetPoint(p,t,side*4).x<x)lo=t;else hi=t}return(lo+hi)/2}
  const x=origin.x+sign,t=atX(x),a=curvedStreetPoint(p,t,side*4),b=curvedStreetPoint(p,t,side*5)
  const h=curvedFootwayHeight(p,t),y=origin.y+side*7
  const corners=[x-.8,x+.8].map(x=>{const u=atX(x),v=curvedStreetPoint(p,u,side*5);return[v.x,v.y,curvedFootwayHeight(p,u)]})
  const [c,d]=corners,e=[d[0],y,0],f=[c[0],y,0]
  surface('walk',[c,d,e,c,e,f],true,false)
  p.walkConnections.push({side,end,t,points:[[a.x,a.y,h],[b.x,b.y,h],[b.x,y,0]]})
 }
 for(const side of [-1,1] as const)for(const [i,t]of [.19,.39,.61,.81].entries()){
  const v=curvedStreetPoint(p,t,side*18),b:CityBuilding={azimuth:azimuth+v.x/radius,axial:axial+v.y,width:[12,15,13,16][i],depth:13,height:[12,19,15,10][(i+(side>0?1:0))%4],baseHeight:.34,yaw:v.heading,kind:i%2?'setback':'block',front:{axis:'axial',side:side>0?-1:1},streetKind:'local',urban:.45,oldTown:.25,tone:.2+i*.15}
  p.buildings.push(b)
  const front=curvedStreetPoint(p,t,side*5),back=curvedStreetPoint(p,t,side*12),dx=Math.cos(v.heading)*b.width/2,dy=Math.sin(v.heading)*b.width/2
  const a=[front.x-dx,front.y-dy,.34],bb=[front.x+dx,front.y+dy,.34],c=[back.x+dx,back.y+dy,.34],d=[back.x-dx,back.y-dy,.34]
  surface('walk',[a,bb,c,a,c,d])
  // Solid low foundation closes the space below the raised entrance paving.
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>[v.x+Math.cos(v.heading)*sx*b.width/2-Math.sin(v.heading)*sy*b.depth/2,v.y+Math.sin(v.heading)*sx*b.width/2+Math.cos(v.heading)*sy*b.depth/2,.34])
  surface('walk',[corners[0],corners[1],corners[2],corners[0],corners[2],corners[3]])
  for(let j=0;j<4;j++){const a=corners[j],c=corners[(j+1)%4],b=[a[0],a[1],0],d=[c[0],c[1],0];surface('walk',[a,b,c,b,d,c])}
  p.colliders.push(...cityBlockCollision(b,colonyBuildingSpec(b),radius))
 }
 return p
}
export class CurvedNeighborhoodLayer{
 readonly group=new THREE.Group()
 readonly buildings=new ColonyBuildings(this.group)
 plan:CurvedNeighborhood|null=null
 private materials={road:new THREE.MeshStandardMaterial({color:'#454d4b',roughness:.97,side:THREE.DoubleSide}),walk:new THREE.MeshStandardMaterial({color:'#a3aa9d',roughness:.95,side:THREE.DoubleSide}),paint:new THREE.MeshStandardMaterial({color:'#c5c9b9',roughness:.95,side:THREE.DoubleSide})}
 private meshes:THREE.Mesh[]=[]
 constructor(parent:THREE.Group){this.group.name='curved-neighborhood';parent.add(this.group)}
 getPavementMaterials(){return Object.values(this.materials)}
 rebuild(plan:CurvedNeighborhood|null,radius:number){
  for(const mesh of this.meshes){mesh.removeFromParent();mesh.geometry.dispose()}this.meshes=[];this.plan=plan
  this.buildings.rebuild(plan?.buildings??[],radius,new Map(),[],false)
  if(!plan)return
  for(const kind of ['road','walk','paint'] as const){
   const pieces=plan.surfaces.filter(s=>s.kind===kind).map(({collider:b})=>{const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(citySurfaceVertices(b.surfaceMesh!,radius),3));g.rotateY(-b.azimuth);g.translate(Math.cos(b.azimuth)*radius,b.axial,Math.sin(b.azimuth)*radius);g.computeVertexNormals();return g})
   const g=mergeGeometries(pieces);pieces.forEach(p=>p.dispose());if(!g)continue
   const mesh=new THREE.Mesh(g,this.materials[kind]);mesh.receiveShadow=true;this.group.add(mesh);this.meshes.push(mesh)
  }
  this.group.userData={azimuth:plan.azimuth,axial:plan.axial,buildings:plan.buildings.length,triangles:plan.surfaces.reduce((n,s)=>n+s.collider.surfaceMesh!.length/9,0)}
 }
 dispose(){this.rebuild(null,1);this.buildings.dispose();Object.values(this.materials).forEach(m=>m.dispose());this.group.removeFromParent()}
}
