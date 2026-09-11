import type {CityBuilding,CityRoad} from './cityLayout'
import type {BlockSpec,BlockVolume} from './authoredCityBlockPlan'
import type {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBuildingSeed} from './colonyBuildingUse'
import {colonyGroundHeight} from './colonyBuildingFrontage'
import {colonyWindowGrid} from './colonyBuildingPlan'
import {SurfaceIndex} from './streetAccess'

type Source={spec:BlockSpec;design:ReturnType<typeof colonyBuildingDesign>;interior:boolean}
type Rect={azimuth:number;axial:number;tangentWidth:number;axialLength:number}
export type ColonyStair={kind:'external'|'enclosed';wall:BlockVolume;x:number;z:number;width:number;levels:number[];base:number}
export type StairPart=BlockVolume&{kind:'metal'|'flight'|'door'|'wall';yaw?:number;tilt?:number}
export const STAIR_BUILDING_LIMIT=4
export const STAIR_CORE_LIMIT=6
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
const overlap=(a:Rect,b:Rect,r:number,gap=0)=>Math.abs(wrap(a.azimuth-b.azimuth))*r<(a.tangentWidth+b.tangentWidth)/2+gap&&Math.abs(a.axial-b.axial)<(a.axialLength+b.axialLength)/2+gap
const footprint=(b:CityBuilding):Rect=>({azimuth:b.azimuth,axial:b.axial,tangentWidth:b.width,axialLength:b.depth})
export function stairSiteRect(b:CityBuilding,r:number,x:number,z:number,w:number,d:number):Rect{
 const tangent=b.front!.axis==='tangent',side=b.front!.side
 return {azimuth:b.azimuth+side*(tangent?z:-x)/r,axial:b.axial+side*(tangent?x:z),tangentWidth:tangent?d:w,axialLength:tangent?w:d}
}

/** Select rear stairwells. Exterior stairs additionally require their own lot
 * and a clear ground route along the building side to the existing street. */
export function planColonyStairs(sources:Source[],buildings:CityBuilding[],roads:CityRoad[],radius:number){
 const result=new Map<CityBuilding,ColonyStair>(),lots=new SurfaceIndex(radius),streets=new SurfaceIndex(radius),accesses=new SurfaceIndex(radius),occupied=new SurfaceIndex(radius)
 const paths:Rect[]=[],placed:Rect[]=[]
 buildings.forEach((b,i)=>{
  lots.insert(footprint(b),i)
  if(!b.access||!b.front)return
  const a=b.access,t=b.front.axis==='tangent',rect={azimuth:a.entrance.azimuth+wrap(a.roadEdge.azimuth-a.entrance.azimuth)/2,axial:(a.entrance.axial+a.roadEdge.axial)/2,tangentWidth:t?a.length:a.width,axialLength:t?a.width:a.length}
  accesses.insert(rect,paths.length);paths.push(rect)
 })
 roads.forEach((road,i)=>streets.insert(road,i))
 for(const {spec,design,interior} of sources){
  const b=spec.building,seed=colonyBuildingSeed(b)
  if(interior||!b.front||!b.parcel||!b.access||b.height<10||['house','industrial'].includes(design.use.primary)||(seed>>>17)%4!==0)continue
  const wall=spec.volumes.filter(v=>v.y-v.h/2<.01&&v.h>=b.height*.7&&v.w>=8).sort((a,b)=>(a.z-a.d/2)-(b.z-b.d/2))[0]
  if(!wall)continue
  const ground=colonyGroundHeight(wall,design),upper=wall.h-ground,grid=colonyWindowGrid({...wall,h:upper},design.profile),pitch=wall.w/grid.columnsX
  const span=Math.min(grid.columnsX,Math.max(1,Math.ceil(2.2/pitch))),width=span*pitch-.1
  const x=wall.x+wall.w/2-span*pitch/2,z=wall.z-wall.d/2
  const lowerFloors=Math.ceil(ground/4.2)
  const levels=[0,...Array.from({length:lowerFloors},(_,i)=>(i+1)*ground/lowerFloors),...Array.from({length:grid.floors-1},(_,i)=>ground+(i+1)*upper/grid.floors)]
  const stair:ColonyStair={kind:'enclosed',wall,x,z,width,levels,base:0}
  result.set(b,stair)
  if(radius<800||b.height>34||design.use.primary==='office'||wall.w>40||wall.d>50||(!(seed&1)&&(b.oldTown??0)<.5))continue
  const tangent=b.front.axis==='tangent',side=b.front.side,parcel=b.parcel
  const pw=tangent?parcel.axialExtent:parcel.tangentExtent,pd=tangent?parcel.tangentExtent:parcel.axialExtent
  const px=side*(tangent?parcel.axialOffset:-parcel.tangentOffset),pz=side*(tangent?parcel.tangentOffset:parcel.axialOffset)
  const bw=tangent?b.depth:b.width
  const sx=x-2.45,sz=z-1.36,routeX=bw/2+.75
  const curb=side*(tangent?wrap(b.access.roadEdge.azimuth-b.azimuth)*radius:b.access.roadEdge.axial-b.axial)
  // Reserve a 1.2m side route, connecting at pavement before the carriageway.
  const shapes=[{x:sx,z:sz,w:6.4,d:2.8},{x:routeX,z:(sz+curb-.4)/2,w:1.2,d:curb-.4-sz},{x:(sx+3.2+routeX)/2,z:sz,w:routeX-sx-3.2+.1,d:1.2}]
  if(shapes.some(s=>s.w<=0||s.d<=0||Math.abs(s.x-px)+s.w/2>pw/2-.05||Math.abs(s.z-pz)+s.d/2>pd/2-.05))continue
  const rects=shapes.map(s=>stairSiteRect(b,radius,s.x,s.z,s.w,s.d))
  if(rects.some(rect=>{
   const query={...rect,tangentWidth:rect.tangentWidth+.4,axialLength:rect.axialLength+.4}
   return [...lots.query(query)].some(i=>buildings[i]!==b&&overlap(rect,footprint(buildings[i]),radius,.1))||[...streets.query(query)].some(i=>overlap(rect,roads[i],radius,.1))||[...accesses.query(query)].some(i=>overlap(rect,paths[i],radius,.1))||[...occupied.query(query)].some(i=>overlap(rect,placed[i],radius,.1))
  }))continue
  // The base plinth spans the curved ground without leaving its corners buried.
  const extent=tangent?Math.max(Math.abs(sz-1.4),Math.abs(sz+1.4)):Math.max(Math.abs(sx-3.2),Math.abs(sx+3.2))
  const base=radius-Math.sqrt(radius*radius-extent*extent)+.12
  if(levels[1]-base<2.2)continue
  stair.kind='external';stair.base=base;stair.levels[0]=base
  for(const rect of rects){occupied.insert(rect,placed.length);placed.push(rect)}
 }
 return result
}

/** Metric treads, landings, posts and guards. Only the stair rise scales;
 * handrails remain 1.05m above each flight and landing. */
export function colonyStairParts(stair:ColonyStair):StairPart[]{
 const parts:StairPart[]=[],{wall,x,z,width,levels}=stair
 const box=(kind:StairPart['kind'],x:number,y:number,z:number,w:number,h:number,d:number,yaw=0,tilt=0)=>parts.push({kind,x,y,z,w,h,d,yaw,tilt})
 box('wall',x,wall.y,z-.09,width,wall.h-.08,.2)
 for(const [i,y] of levels.entries()){
  if(stair.kind==='external'||y===0){
   box('door',x,y+1.05,z-.205,1.05,2.1,.035)
   for(const sign of [-1,1])box('metal',x+sign*.56,y+1.08,z-.235,.055,2.16,.065)
   box('metal',x,y+2.16,z-.235,1.18,.07,.065)
  }else{
   // Half-storey stairwell glazing differs from the surrounding occupied rooms.
   const mid=(levels[i-1]+y)/2+.7
   box('door',x,mid,z-.205,.48,.65,.035)
   box('metal',x,mid-.34,z-.23,.62,.06,.1)
  }
 }
 if(stair.kind==='enclosed')return parts
 const cx=x-2.45,cz=z-1.36
 const local=(kind:StairPart['kind'],u:number,y:number,v:number,w:number,h:number,d:number,yaw=0,tilt=0)=>box(kind,cx-u,y,cz-v,w,h,d,Math.PI+yaw,tilt)
 // Solid ground plinth and a closed ground gate: an exterior model, like the
 // non-enterable building it serves, rather than an advertised playable stair.
 box('wall',cx,stair.base/2,cz,6.4,stair.base,2.8)
 for(const u of [-3.12,3.12])for(const v of [-1.3,1.3]){
  const top=(u<0?levels.at(-1)!:(levels.at(-1)!+levels.at(-2)!)/2)+1.05
  local('metal',u,top/2,v,.095,top,.095)
 }
 const beam=(u:number,y:number,v:number,rise:number)=>local('metal',u,y,v,Math.hypot(3.4,rise),.06,.055,0,Math.atan2(rise,3.4))
 for(let i=1;i<levels.length;i++){
  const low=levels[i-1],high=levels[i],rise=(high-low)/2,mid=(low+high)/2
  local('flight',0,low,-.7,3.4,rise,1.15)
  local('flight',0,mid,.7,3.4,rise,1.15,Math.PI)
  for(const v of [-1.29,-.11]){beam(0,low+rise/2-.09,v,rise);beam(0,low+rise/2+1.05,v,rise)}
  for(const v of [.11,1.29]){beam(0,mid+rise/2-.09,v,-rise);beam(0,mid+rise/2+1.05,v,-rise)}
  for(const [u,y] of [[-2.45,high],[2.45,mid]]){
   local('metal',u,y-.065,0,1.5,.13,2.7)
   local('metal',u+(u<0?-.69:.69),y+1.05,0,.055,.06,2.7)
   for(const v of [-1.32,1.32])local('metal',u,y+1.05,v,1.5,.06,.055)
  }
  // Vertical guard supports meet the sloping rails, with no scaled handrail height.
  for(const u of [-1.65,0,1.65]){
   for(const v of [-1.29,-.11])local('metal',u,low+(u/3.4+.5)*rise+.51,v,.055,1.05,.055)
   for(const v of [.11,1.29])local('metal',u,mid+(.5-u/3.4)*rise+.51,v,.055,1.05,.055)
  }
 }
 // A ground guard/gate bounds the inaccessible lower stair enclosure.
 local('metal',-3.13,stair.base+.55,0,.09,1.1,2.65)
 for(const [u,v,w,d] of [[0,1.32,6.3,.055],[3.13,0,.055,2.65]]){
  local('metal',u,stair.base+1.05,v,w,.06,d)
  local('metal',u,stair.base+.18,v,w,.06,d)
 }
 for(let j=0;j<12;j++)local('metal',-2.85+j*.52,stair.base+.6,1.32,.04,.9,.04)
 for(let j=0;j<5;j++)local('metal',3.13,stair.base+.6,-1+j*.5,.04,.9,.04)
 return parts
}

/** Permanent coarse envelope, as for other non-enterable building volumes. */
export function colonyStairCollider(b:CityBuilding,s:ColonyStair,radius:number):CityBuilding{
 const rect=stairSiteRect(b,radius,s.x-2.45,s.z-1.36,6.4,2.8)
 return {...b,azimuth:rect.azimuth,axial:rect.axial,width:rect.tangentWidth,depth:rect.axialLength,height:s.levels.at(-1)!+1.1,baseHeight:0,collisionMargin:0}
}
