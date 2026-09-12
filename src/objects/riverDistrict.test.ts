import { sampleCitySurface } from './citySurfaceMesh'
import { planSidewalkSegments } from './sidewalks'
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity, buildCityCollisionIndex, getCityGroundHeight, resolveCitySurfaceCollision, type CityBuilding } from './cityLayout'
import { planRiverDistrict, riverCentre, riverWalkHeight, sampleRiverRoad } from './riverDistrictPlan'
import { cityBlockCollision } from './authoredCityBlockPlan'
import { colonyBuildingSpec } from './colonyBuildingPlan'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { createUnitsContext } from '../units/units'
import { collideSphereWithBuildings } from '../sim/cityCollision'
const R=3200,L=40000
const city=planCity({radius:R,length:L,maxBuildings:64000}),p=planRiverDistrict(city,R)!

test('river district occupies an empty block and joins the same roads across quality tiers',()=>{
 expect(p).not.toBeNull()
 for(const budget of [18000,16000]){
  const other=planRiverDistrict(planCity({radius:R,length:L,maxBuildings:budget}),R)!
  expect([other.azimuth,other.axial,other.width,other.length]).toEqual([p.azimuth,p.axial,p.width,p.length])
 }
 expect(planRiverDistrict({...city,patches:[]},R)).toBeNull()
 expect(planRiverDistrict(city,100)).toBeNull()
 const walks=planSidewalkSegments(city.roads,city.intersections,R,3,()=>false,p.sidewalkCuts)
 for(const cut of p.sidewalkCuts)for(const dx of [-1,0,1])expect(walks.some(w=>Math.abs((w.azimuth-cut.azimuth)*R-dx)<w.tangentExtent/2&&Math.abs(w.axial-cut.axial)<w.axialExtent/2)).toBe(false)
 expect(p.buildings).toHaveLength(8)
 expect(p.surfaces.reduce((n,s)=>n+s.collider.surfaceMesh!.length/9,0)).toBeLessThan(26000)
 expect(p.colliders.length).toBeLessThan(1400)
 for(const road of p.connections){
  const x=(road.azimuth-p.azimuth)*R+(road.azimuth<p.azimuth?1:-1)*(road.tangentWidth/2+.1)
  expect(sampleRiverRoad(p,R,p.azimuth+x/R,p.axial+.25*x)).toBeLessThan(.23)
  expect(sampleRiverRoad(p,R,p.azimuth+x/R,p.axial+.25*x)).toBeGreaterThan(.19)
 }
})

test('upper street, lower promenade, ramps and the bridge underside remain distinct physical levels',()=>{
 const index=buildCityCollisionIndex(p.colliders,R,L)
 for(const side of [-1,1])for(let y=-100;y<=100;y+=.73){
  const x=riverCentre(y)+side*13.5,expected=riverWalkHeight(y)
  expect(getCityGroundHeight(index,R,p.azimuth+x/R,p.axial+y,expected)).toBeCloseTo(expected,2)
 }
 expect(getCityGroundHeight(index,R,p.azimuth,p.axial,5.2)).toBeCloseTo(5.2)
 expect(getCityGroundHeight(index,R,p.azimuth,p.axial,.12,.1)).toBeCloseTo(.12)
 // A jump beneath the arch must not treat the underside as a landing floor.
 expect(getCityGroundHeight(index,R,p.azimuth+13/ R,p.axial+2,3.2,1.5)).toBeCloseTo(1.2)
 // Building front doors have an unobstructed pavement/ground approach, and
 // their rotated physical footprints stay off the diagonal carriageway.
 for(const b of p.buildings){
  const boxes=cityBlockCollision(b,colonyBuildingSpec(b),R)
  expect(boxes.every(c=>(c.baseHeight??0)>=5.34-1e-9)).toBe(true)
  const x=(b.azimuth-p.azimuth)*R
  expect(resolveCitySurfaceCollision({azimuth:p.azimuth+x/R,axialPosition:p.axial+.25*x},boxes,R,1,5.2)).toBe(false)
 }
})

test('rotated thin walls agree in broad phase, analytic sphere contact and Rapier',async()=>{
 const b:CityBuilding={azimuth:.13,axial:1375,width:60,depth:.2,height:3,baseHeight:5,yaw:Math.PI/4,kind:'block',tone:.5,groundMargin:0}
 const index=buildCityCollisionIndex([b],R,L),dx=20*Math.cos(b.yaw!),dy=20*Math.sin(b.yaw!)
 expect(getCityGroundHeight(index,R,b.azimuth+dx/R,b.axial+dy,8)).toBe(8)
 const a=b.azimuth+dx/R
 const sphere=new THREE.Vector3(Math.cos(a)*(R-6),b.axial+dy+.1,Math.sin(a)*(R-6)),velocity=new THREE.Vector3()
 expect(collideSphereWithBuildings(sphere,velocity,index,{habitatRadius:R,sphereRadius:.3,restitution:0})).toBe(true)
 const rapier=await initRapier(),world=new rapier.World({x:0,y:0,z:0})
 const stream=createRotatingCityColliders(rapier,world,{radius:R,index,omega:0,units:createUnitsContext(1)})
 try{
  stream.update(a,b.axial+dy);world.step()
  const origin={x:Math.cos(a)*(R-10),y:b.axial+dy,z:Math.sin(a)*(R-10)}
  const hit=world.castRay(new rapier.Ray(origin,{x:Math.cos(a),y:0,z:Math.sin(a)}),10,true)
  expect(hit).not.toBeNull();expect(hit!.timeOfImpact).toBeCloseTo(2,0)
 }finally{stream.dispose();world.free()}
})

test('streamed terrain contact uses real sloped triangles with a spin-axis COM',async()=>{
 const rapier=await initRapier(),world=new rapier.World({x:0,y:0,z:0}),index=buildCityCollisionIndex(p.colliders,R,L)
 const stream=createRotatingCityColliders(rapier,world,{radius:R,index,omega:0,units:createUnitsContext(1)})
 try{
  const y=76,x=riverCentre(y)+13.5,a=p.azimuth+x/R,h=riverWalkHeight(y)
  stream.update(a,p.axial+y);world.step()
  const hit=world.castRay(new rapier.Ray({x:Math.cos(a)*(R-8),y:p.axial+y,z:Math.sin(a)*(R-8)},{x:Math.cos(a),y:0,z:Math.sin(a)}),10,true)
  expect(hit).not.toBeNull();expect(8-hit!.timeOfImpact).toBeCloseTo(h,2)
  expect(Math.hypot(stream.body.localCom().x,stream.body.localCom().y,stream.body.localCom().z)).toBeLessThan(1e-6)
  stream.update(-2,-10000);expect(stream.activeCount()).toBe(0)
 }finally{stream.dispose();world.free()}
})

test('carriageway stays above the supporting earth along both curved approaches',()=>{
 const earth=p.surfaces.filter(s=>s.material==='earth').map(s=>s.collider)
 for(const s of p.surfaces.filter(s=>s.material==='road')){
   const b=s.collider,m=b.surfaceMesh!
   for(let i=0;i<m.length;i+=3){const a=b.azimuth+m[i]/R,ax=b.axial+m[i+1];let land=0
     for(const e of earth)land=Math.max(land,sampleCitySurface(e.surfaceMesh!,(a-e.azimuth)*R,ax-e.axial))
     expect(m[i+2]-land).toBeGreaterThan(.03)
   }
 }
})
