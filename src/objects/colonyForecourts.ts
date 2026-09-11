import type {CityBuilding,CityRoad} from './cityLayout'
import type {BlockSpec} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyGroundHeight,colonyShopBays} from './colonyBuildingFrontage'
import {SurfaceIndex} from './streetAccess'
import {FOOTPATH_WIDTH,SIDEWALK_LIFT,getStreetProfile} from './streetProfile'

type Source={spec:BlockSpec;design:ReturnType<typeof colonyBuildingDesign>;interior:boolean}
type Rect={azimuth:number;axial:number;tangentWidth:number;axialLength:number}
export type ForecourtPlanter={x:number;z:number;width:number;depth:number;height:number;leafHeight:number;azimuth:number;axial:number;lift:number;tint:number}
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const overlap=(a:Rect,b:Rect,radius:number,gap=0)=>Math.abs(wrap(a.azimuth-b.azimuth))*radius<(a.tangentWidth+b.tangentWidth)/2+gap&&Math.abs(a.axial-b.axial)<(a.axialLength+b.axialLength)/2+gap
const footprint=(b:CityBuilding):Rect=>({azimuth:b.azimuth,axial:b.axial,tangentWidth:b.width,axialLength:b.depth})
export const forecourtFootprint=(b:CityBuilding,p:ForecourtPlanter):Rect=>({azimuth:p.azimuth,axial:p.axial,tangentWidth:b.front?.axis==='tangent'?p.depth:p.width,axialLength:b.front?.axis==='tangent'?p.width:p.depth})

/** Permanent layout shared by close rendering and collision. Never furnish a
 * certified access path, carriageway, neighbouring lot or the through-walking strip. */
export function planColonyForecourts(sources:Source[],buildings:CityBuilding[],roads:CityRoad[],radius:number){
 const result=new Map<CityBuilding,ForecourtPlanter[]>()
 const roadIndex=new SurfaceIndex(radius),buildingIndex=new SurfaceIndex(radius),pathIndex=new SurfaceIndex(radius),placedIndex=new SurfaceIndex(radius)
 const paths:Rect[]=[],placed:Rect[]=[]
 roads.forEach((road,i)=>roadIndex.insert(road,i))
 buildings.forEach((b,i)=>{
  buildingIndex.insert(footprint(b),i)
  if(!b.access||!b.front)return
  const {entrance,roadEdge,width,length}=b.access,tangent=b.front.axis==='tangent'
  const path={azimuth:entrance.azimuth+wrap(roadEdge.azimuth-entrance.azimuth)/2,axial:(entrance.axial+roadEdge.axial)/2,tangentWidth:tangent?length:width,axialLength:tangent?width:length}
  pathIndex.insert(path,paths.length);paths.push(path)
 })
 for(const {spec,design,interior} of sources){
  const b=spec.building,{access,front}=b,use=design.use.primary
  if(interior||!access||!front||use==='house'||use==='industrial'||b.height<6)continue
  const road=roads[access.roadIndex],tangent=front.axis==='tangent',side=front.side
  if(!road||tangent!==(road.axialLength>road.tangentWidth))continue
  const pavement=getStreetProfile(road.kind,radius).sidewalk
  if(pavement<FOOTPATH_WIDTH+.4)continue
  const curb=side*(tangent?wrap(access.roadEdge.azimuth-b.azimuth)*radius:access.roadEdge.axial-b.axial)
  const v=spec.volumes.find(v=>Math.abs(v.x)<v.w/2&&v.y-v.h/2<.01)
  if(!v||v.w<9)continue
  const candidates:Array<{x:number;z:number;width:number;height:number;tint:number}>=[]
  const retail=design.use.ground==='retail'&&colonyGroundHeight(v,design)>0
  if(retail){
   for(const bay of colonyShopBays(v)){
    const tenant=(bay.index+Math.floor(design.seed*31))%8
    if(![0,1,3,7].includes(tenant))continue
    const doorSide=tenant%2?1:-1
    candidates.push({x:bay.x-doorSide*bay.width*.22,z:v.z+v.d/2+.245,width:.76,height:.46,tint:tenant===3?1:0})
   }
  }else{
   const office=use==='office'||use==='commercial'
   for(const side of [-1,1])candidates.push({x:v.x+side*(office?3.7:2.85),z:v.z+v.d/2+.245,width:office?1.25:.8,height:office?.6:.52,tint:office?2:Math.floor(design.seed*3)%2})
  }
  candidates.sort((a,b)=>Math.abs(a.x-v.x)-Math.abs(b.x-v.x))
  for(const c of candidates){
   if((result.get(b)?.length??0)>=2)break
   const depth=.38
   // Keep the entire pot on the existing pavement and at least two metres
   // between its outer edge and the kerb. Do not grow the pavement to fit it.
   if(c.z-depth/2<curb-pavement+.025||curb-c.z-depth/2<FOOTPATH_WIDTH+.04)continue
   if(Math.abs(c.x-v.x)+c.width/2>v.w/2-.4)continue
   if(spec.volumes.some(o=>Math.abs(c.x-o.x)<(c.width+o.w)/2+.04&&Math.abs(c.z-o.z)<(depth+o.d)/2+.04))continue
   const p:ForecourtPlanter={...c,depth,leafHeight:use==='office'?.46:.34,azimuth:b.azimuth+side*(tangent?c.z:-c.x)/radius,axial:b.axial+side*(tangent?c.x:c.z),lift:SIDEWALK_LIFT+(tangent?0:.01)}
   const rect=forecourtFootprint(b,p),query={...rect,tangentWidth:rect.tangentWidth+.5,axialLength:rect.axialLength+.5}
   // Endpoints and side streets need full rectangles, not just distance to
   // the assigned road. Query the original plan, including authored lots.
   const along=tangent?Math.abs(p.axial-road.axial):Math.abs(wrap(p.azimuth-road.azimuth))*radius
   if(along+(tangent?rect.axialLength:rect.tangentWidth)/2+FOOTPATH_WIDTH>(tangent?road.axialLength:road.tangentWidth)/2)continue
   if([...roadIndex.query(query)].some(i=>overlap(rect,roads[i],radius,.15)))continue
   if([...buildingIndex.query(query)].some(i=>buildings[i]!==b&&overlap(rect,footprint(buildings[i]),radius,.15)))continue
   if([...pathIndex.query(query)].some(i=>overlap(rect,paths[i],radius,.15)))continue
   if([...placedIndex.query(query)].some(i=>overlap(rect,placed[i],radius,.15)))continue
   const list=result.get(b)??[];list.push(p);result.set(b,list)
   placedIndex.insert(rect,placed.length);placed.push(rect)
  }
 }
 return result
}

/** The solid pot blocks movement; soft foliage above it does not. */
export function forecourtCollider(b:CityBuilding,p:ForecourtPlanter):CityBuilding{
 const f=forecourtFootprint(b,p)
 return {...b,azimuth:f.azimuth,axial:f.axial,width:f.tangentWidth,depth:f.axialLength,height:p.height,baseHeight:p.lift,collisionMargin:0}
}
