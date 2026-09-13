import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { type CityBuilding, type CityPlan, planCity } from './cityLayout'
import { StreetNetwork } from './streetNetwork'
import { type StreetPath, sampleStreetPath } from './streetPath'
import { certifyStreetAccess, buildingFootprint, streetAccessPolygons } from './streetFrontage'
import { polygonArea, intersectStreetPolygons } from './streetPolygon'
import { streetPathSurfaces } from './streetSurfacePlan'
import { StreetAccessLayer } from './streetAccessLayer'
import { planCurvedNeighborhood } from './curvedNeighborhood'
const R=100
const building=(p:Partial<CityBuilding>={}):CityBuilding=>({azimuth:0,axial:0,width:4,depth:4,height:10,kind:'block',tone:.5,front:{axis:'axial',side:1},...p})
const street=(p:Partial<StreetPath>={}):StreetPath=>({id:'main',azimuth:0,axial:6,width:4,kind:'arterial',level:0,groundHeight:0,knots:[{point:[-10,0],tangent:[20,0]},{point:[10,0],tangent:[20,0]}],...p})
const certify=(b:CityBuilding[],s:StreetPath[],gap=4,radius=R)=>certifyStreetAccess(b,new StreetNetwork(s,radius),radius,gap)
const rotate=(x:number,y:number,yaw:number)=>({x:x*Math.cos(yaw)-y*Math.sin(yaw),y:x*Math.sin(yaw)+y*Math.cos(yaw)})

test('rotated parcels certify and render invariant metric corridors through the cylinder seam',()=>{
 for(const yaw of [0,.37,1.2,Math.PI/2,2.7,-.8])for(const origin of [0,Math.PI-.015]){
  const p=rotate(0,6,yaw),a=rotate(-10,0,yaw),b=rotate(10,0,yaw),d=rotate(20,0,yaw)
  const s=street({azimuth:origin+p.x/R,axial:p.y,knots:[{point:[a.x,a.y],tangent:[d.x,d.y]},{point:[b.x,b.y],tangent:[d.x,d.y]}]})
  const result=certify([building({azimuth:origin,yaw})],[s]);expect(result.rejected).toHaveLength(0)
  const access=result.buildings[0].access,offset=rotate(0,2,yaw)
  expect(access.entrance.azimuth-origin).toBeCloseTo(offset.x/R,10);expect(access.entrance.axial).toBeCloseTo(offset.y,10)
  expect(access.length).toBeCloseTo(2,9);expect(access.roadId).toBe('main')
  expect(streetAccessPolygons(access,R).reduce((n,p)=>n+polygonArea(p),0)).toBeCloseTo(4,7)
  const group=new THREE.Group(),layer=new StreetAccessLayer(group)
  layer.rebuild({buildings:result.buildings} as CityPlan,R,origin,0)
  const mesh=group.getObjectByName('street-access-corridors') as THREE.Mesh
  expect(mesh).toBeDefined()
  const positions=mesh.geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++)expect(Math.hypot(positions.getX(i),positions.getZ(i))).toBeCloseTo(R-.12,4)
  layer.dispose();expect(group.children).toHaveLength(0)
 }
})

test('a skew curb terminates both sides exactly without paving over the carriageway',()=>{
 const s=street({knots:[{point:[-10,-2],tangent:[20,4]},{point:[10,2],tangent:[20,4]}]})
 const result=certify([building()],[s]);expect(result.rejected).toHaveLength(0)
 const access=result.buildings[0].access,pieces=streetAccessPolygons(access,R),road=streetPathSurfaces(s,R)[0].polygon.map(v=>({...v,x:v.x,y:v.y+6-2}))
 expect(access.corridor).toBeDefined()
 for(const p of pieces)expect(polygonArea(intersectStreetPolygons(p,road))).toBeLessThan(1e-7)
 const ends=pieces.flat().filter(v=>v.y>.1);expect(Math.max(...ends.map(v=>v.y))-Math.min(...ends.map(v=>v.y))).toBeCloseTo(.4,7)
 // Both ends lie on the same analytic kerb y=.2*x+6-2*sqrt(1.04).
 for(const v of ends)expect(v.y+2).toBeCloseTo(.2*v.x+6-2*Math.sqrt(1.04),7)
})

test('curved boundaries spanning multiple ribbon segments preserve full-width access',()=>{
 const s=street({width:3,knots:[{point:[-10,0],tangent:[20,6]},{point:[10,0],tangent:[20,-6]}]})
 const result=certify([building()],[s],7);expect(result.rejected).toHaveLength(0)
 const access=result.buildings[0].access,pieces=streetAccessPolygons(access,R)
 expect(pieces.length).toBeGreaterThan(1)
 for(let i=0;i<51;i++){
  const x=-1+2*(i+.5)/51
  expect(pieces.some(p=>Math.min(...p.map(v=>v.x))<=x&&Math.max(...p.map(v=>v.x))>=x)).toBe(true)
 }
 for(const road of streetPathSurfaces(s,R))for(const p of pieces){
  const polygon=road.polygon.map(v=>({...v,x:v.x,y:v.y+s.axial-access.entrance.axial}))
  expect(polygonArea(intersectStreetPolygons(p,polygon))).toBeLessThan(1e-7)
 }
})

test('a road reaching the centre and both shoulders still fails if the width contains a gap',()=>{
 // A remote connecting loop has three fingers towards the entrance. All
 // fingers belong to one connected component, but leave two gaps in the door width.
 const points=[[-3,4],[-1,4],[-1,12],[0,12],[0,4],[0,12],[1,12],[1,4],[3,4]]
 const paths=points.slice(1).map((p,i)=>{const a=points[i],d:[number,number]=[p[0]-a[0],p[1]-a[1]];return street({id:`finger-${i}`,axial:0,width:.1,knots:[{point:[a[0],a[1]],tangent:d},{point:[p[0],p[1]],tangent:d}]})})
 expect(certify([building()],paths,4).buildings).toHaveLength(0)
})

test('rotated obstacles use footprints rather than bounding boxes, and different decks stay separate',()=>{
 const obstacle=building({azimuth:1.4/R,axial:4.5,width:.2,depth:2,yaw:.5,front:undefined})
 expect(certify([building(),obstacle],[street()]).buildings).toHaveLength(1)
 const blocked=certify([building(),{...obstacle,azimuth:.7/R,axial:3}],[street()]);expect(blocked.rejected[0].reason).toBe('blocked-path')
 expect(certify([building()],[street({level:1})]).buildings).toHaveLength(0)
 expect(certify([building()],[street({groundHeight:5})]).buildings).toHaveLength(0)
 expect(certify([building({streetLevel:1,baseHeight:5})],[street({level:1,groundHeight:5})]).buildings).toHaveLength(1)
 const low=street({id:'under',axial:0,level:0}),high=street({id:'upper',level:1,groundHeight:5})
 expect(certify([building({streetLevel:1,baseHeight:5})],[low,high]).buildings).toHaveLength(1)
})

test('a diagonal road bounding box does not erase a parcel outside its actual ribbon',()=>{
 const s=street({axial:0,width:2,knots:[{point:[-10,-10],tangent:[20,20]},{point:[10,10],tangent:[20,20]}]})
 const b=building({azimuth:0,axial:6,front:{axis:'axial',side:-1},width:2,depth:2})
 expect(certify([b],[s],7).rejected).toHaveLength(0)
 expect(polygonArea(buildingFootprint({...b,yaw:.8}))).toBeCloseTo(4,8)
})

test('all eight existing Garden buildings connect to the real curved arterial component',()=>{
 const radius=3200,city=planCity({radius,length:40000,maxBuildings:18000}),g=planCurvedNeighborhood(city,radius)!
 const network=new StreetNetwork([...city.streetNetwork!.streets,g.street,...g.streetLinks],radius)
 const result=certifyStreetAccess(g.buildings,network,radius,10)
 expect(result.rejected).toHaveLength(0);expect(result.buildings).toHaveLength(8)
 for(const b of result.buildings){expect(b.access.roadId).toBe('garden');expect(b.access.length).toBeGreaterThan(8.4);expect(b.access.length).toBeLessThan(8.6)}
 // A same-sized road without its two avenue links is disconnected.
 const isolated=new StreetNetwork([...city.streetNetwork!.streets,g.street],radius)
 expect(certifyStreetAccess(g.buildings,isolated,radius,10).buildings).toHaveLength(0)
 expect(sampleStreetPath(g.street,.3).heading).toBeGreaterThan(.3)
})
