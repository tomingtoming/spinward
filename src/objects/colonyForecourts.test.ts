import {expect,test} from 'bun:test'
import {planCity,resolveCitySurfaceCollision,type CityBuilding,type CityRoad} from './cityLayout'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {forecourtCollider,forecourtFootprint,planColonyForecourts} from './colonyForecourts'
import {SurfaceIndex} from './streetAccess'
import {FOOTPATH_WIDTH,getStreetProfile} from './streetProfile'

const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
function fixture(axis:'axial'|'tangent',side:1|-1,radius=3200,gap=getStreetProfile('arterial',radius).sidewalk){
 const tangent=axis==='tangent',a=Math.PI-.001,ax=20,half=tangent?12:10
 const b:CityBuilding={azimuth:a,axial:ax,width:24,depth:20,height:24,tone:.5,kind:'block',front:{axis,side},streetKind:'arterial',access:{roadIndex:0,roadId:'road-0',width:2,length:gap,entrance:{azimuth:a+(tangent?side*half/radius:0),axial:ax+(tangent?0:side*half)},roadEdge:{azimuth:a+(tangent?side*(half+gap)/radius:0),axial:ax+(tangent?0:side*(half+gap))}}}
 const road:CityRoad={azimuth:a+(tangent?side*(half+gap+9.75)/radius:0),axial:ax+(tangent?0:side*(half+gap+9.75)),kind:'arterial',tangentWidth:tangent?19.5:120,axialLength:tangent?120:19.5}
 const design=colonyBuildingDesign(b);design.use.primary='office';design.use.ground='lobby';design.use.groundHeight=4.8
 return {b,road,source:{spec:colonyBuildingSpec(b),design,interior:false}}
}
test('all frontage directions place solid pots on the sidewalk while keeping entrances and kerb routes walkable',()=>{
 for(const radius of [250,3200])for(const axis of ['axial','tangent'] as const)for(const side of [-1,1] as const){
  const {b,road,source}=fixture(axis,side,radius),pots=planColonyForecourts([source],[b],[road],radius).get(b)!
  expect(pots.length).toBe(2)
  const colliders=pots.map(p=>forecourtCollider(b,p))
  for(const p of pots){
   const position={azimuth:p.azimuth,axialPosition:p.axial}
   expect(resolveCitySurfaceCollision(position,colliders,radius)).toBe(true)
   expect(Math.hypot(wrap(position.azimuth-p.azimuth)*radius,position.axialPosition-p.axial)).toBeGreaterThan(.4)
  }
  for(const t of [0,.25,.5,.75,1]){
   const {entrance,roadEdge}=b.access!,position={azimuth:entrance.azimuth+wrap(roadEdge.azimuth-entrance.azimuth)*t,axialPosition:entrance.axial+(roadEdge.axial-entrance.axial)*t}
   expect(resolveCitySurfaceCollision(position,colliders,radius)).toBe(false)
  }
  const edge=b.access!.roadEdge,tangent=axis==='tangent'
  // A person can stand 0.8m in front of the office's intercom (x=-2.5),
  // with the same 0.45m body clearance used by surface walking.
  const panelX=-2.5,panelZ=(tangent?b.width:b.depth)/2+.8
  const atIntercom={azimuth:b.azimuth+side*(tangent?panelZ:-panelX)/radius,axialPosition:b.axial+side*(tangent?panelX:panelZ)}
  expect(resolveCitySurfaceCollision(atIntercom,colliders,radius)).toBe(false)
  for(let x=-8;x<=8;x+=.5){
   const position={azimuth:edge.azimuth+side*(tangent?-1:-x)/radius,axialPosition:edge.axial+side*(tangent?x:-1)}
   expect(resolveCitySurfaceCollision(position,colliders,radius)).toBe(false)
  }
 }
})
test('narrow pavements, crossing roads, other entrances and nearby buildings veto placement',()=>{
 const radius=3200,{b,road,source}=fixture('axial',1,radius)
 const original=planColonyForecourts([source],[b],[road],radius).get(b)!,pot=original[0]
 expect(planColonyForecourts([source],[b],[{...road,kind:'local'}],radius).size).toBe(0)
 expect(planColonyForecourts([{...source,interior:true}],[b],[road],radius).size).toBe(0)
 const other:CityBuilding={...b,azimuth:pot.azimuth,axial:pot.axial,width:1.5,depth:1.5,access:undefined}
 expect(planColonyForecourts([source],[b,other],[road],radius).get(b)!.length).toBe(1)
 const crossing:CityRoad={azimuth:pot.azimuth,axial:pot.axial,tangentWidth:1.5,axialLength:40,kind:'alley'}
 expect(planColonyForecourts([source],[b],[road,crossing],radius).get(b)!.length).toBe(1)
 const neighbour:CityBuilding={...other,axial:pot.axial+10,depth:1,access:{...b.access!,length:12,entrance:{azimuth:pot.azimuth,axial:pot.axial+10},roadEdge:{azimuth:pot.azimuth,axial:pot.axial-2}}}
 expect(planColonyForecourts([source],[b,neighbour],[road],radius).get(b)!.length).toBe(1)
})
test('generated layouts keep pots outside actual carriageways and preserve the two metre walking strip',()=>{
 for(const radius of [250,3200]){
  const plan=planCity({radius,length:radius===250?2000:40000,maxBuildings:radius===250?16000:64000})
  const sources=plan.buildings.map(b=>({spec:colonyBuildingSpec(b),design:colonyBuildingDesign(b),interior:false}))
  const start=performance.now(),placements=planColonyForecourts(sources,plan.buildings,plan.roads,radius)
  const roads=new SurfaceIndex(radius);plan.roads.forEach((r,i)=>roads.insert(r,i));let count=0
  for(const [b,pots] of placements){
   expect(pots.length).toBeLessThanOrEqual(2)
   const tangent=b.front!.axis==='tangent',side=b.front!.side,road=plan.roads[b.access!.roadIndex]
   const curb=side*(tangent?wrap(b.access!.roadEdge.azimuth-b.azimuth)*radius:b.access!.roadEdge.axial-b.axial)
   for(const p of pots){
    count++;expect(curb-p.z-p.depth/2).toBeGreaterThanOrEqual(FOOTPATH_WIDTH)
    expect(p.z-p.depth/2).toBeGreaterThan(curb-getStreetProfile(road.kind,radius).sidewalk)
    expect(Math.abs(p.x)-p.width/2).toBeGreaterThan(b.access!.width/2)
    const f=forecourtFootprint(b,p)
    for(const i of roads.query(f)){
     const r=plan.roads[i],dx=Math.abs(wrap(f.azimuth-r.azimuth))*radius,dz=Math.abs(f.axial-r.axial)
     expect(dx>=(f.tangentWidth+r.tangentWidth)/2||dz>=(f.axialLength+r.axialLength)/2).toBe(true)
    }
   }
  }
  // The small habitat may have no spare frontage after the walking strip;
  // furnishing it is optional, preserving circulation is not.
  if(radius===3200)expect(count).toBeGreaterThan(100)
  console.info('Forecourts',JSON.stringify({radius,buildings:placements.size,pots:count,ms:performance.now()-start}))
 }
})
