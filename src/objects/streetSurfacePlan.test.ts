import {test,expect} from 'bun:test'
import {StreetSurfacePlan,streetSurfaceEnvelope,relativeStreetPolygon,type StreetSurface} from './streetSurfacePlan'
import {polygonArea,intersectStreetPolygons,positivePolygon,subtractStreetPolygon,type StreetPolygon} from './streetPolygon'
import {buildStreetSurfaceGeometry} from './streetSurfaceGeometry'
import {legacyStreetPaths,type StreetPath} from './streetPath'
import {planCity} from './cityLayout'
import {compileRoadNetwork} from './roadNetwork'
import {SurfaceIndex} from './streetAccess'
const R=3200
const line=(id:string,a:[number,number],b:[number,number],width=6,level=0):StreetPath=>{
 const tangent:[number,number]=[b[0]-a[0],b[1]-a[1]]
 return{id,azimuth:0,axial:0,kind:'local',width,groundHeight:0,level,knots:[{point:a,tangent},{point:b,tangent}]}
}
const area=(surfaces:StreetSurface[])=>surfaces.reduce((n,s)=>n+polygonArea(s.polygon),0)
function overlaps(a:StreetSurface[],b=a){
 const index=new SurfaceIndex(R);let count=0,max=0
 const same=a===b
 if(!same)b.forEach((s,i)=>index.insert(streetSurfaceEnvelope(s,R),i))
 a.forEach((s,i)=>{
  for(const j of index.query(streetSurfaceEnvelope(s,R))){
   if(b[j].source.level!==s.source.level)continue
   const overlap=polygonArea(intersectStreetPolygons(s.polygon,relativeStreetPolygon(b[j],s.source,R)))
   if(overlap>1e-5){count++;max=Math.max(max,overlap)}
  }
  if(same)index.insert(streetSurfaceEnvelope(s,R),i)
 })
 return{count,max}
}
test('polygon clipping conserves area and interpolated texture coordinates',()=>{
 const polygon:StreetPolygon=[{x:-10,y:-10,u:0,v:0},{x:10,y:-10,u:1,v:0},{x:10,y:10,u:1,v:1},{x:-10,y:10,u:0,v:1}]
 const clip=positivePolygon([{x:-15,y:0,u:0,v:0},{x:0,y:-15,u:0,v:0},{x:15,y:0,u:0,v:0},{x:0,y:15,u:0,v:0}])
 const inside=intersectStreetPolygons(polygon,clip),outside=subtractStreetPolygon(polygon,clip)
 expect(polygonArea(inside)).toBeCloseTo(350,7);expect(outside).toHaveLength(4)
 expect(outside.reduce((n,p)=>n+polygonArea(p),polygonArea(inside))).toBeCloseTo(400,7)
 for(const p of [...inside,...outside.flat()]){expect(p.u).toBeCloseTo((p.x+10)/20,8);expect(p.v).toBeCloseTo((p.y+10)/20,8)}
})
test('skew crossings have one junction owner with the analytic road-union area',()=>{
 for(const angle of [.31,.7,Math.PI/2,2.1]){
  const x=Math.cos(angle)*60,y=Math.sin(angle)*60
  const plan=new StreetSurfacePlan([line('a',[-60,0],[60,0]),line('b',[-x,-y],[x,y],12)],R)
  expect(area(plan.roadSurfaces())).toBeCloseTo(120*18-72/Math.abs(Math.sin(angle)),5)
  expect(plan.roadSurfaces().some(s=>s.junction)).toBe(true);expect(overlaps(plan.roadSurfaces()).count).toBe(0)
  const walks=plan.sidewalks();expect(walks.length).toBeGreaterThan(4)
  expect(overlaps(walks).count).toBe(0);expect(overlaps(walks,plan.roadSurfaces()).count).toBe(0)
 }
})
test('T and multiway junctions, duplicates and disconnected decks retain their surface union',()=>{
 const paths=[line('main',[-60,0],[60,0]),line('tee',[0,0],[30,50]),line('branch',[0,0],[-30,50])]
 const plan=new StreetSurfacePlan(paths,R),duplicate=new StreetSurfacePlan([...paths,{...paths[0],id:'copy'}],R)
 expect(area(duplicate.roadSurfaces())).toBeCloseTo(area(plan.roadSurfaces()),6)
 expect(area(duplicate.sidewalks())).toBeCloseTo(area(plan.sidewalks()),6)
 for(const p of [plan,duplicate]){expect(overlaps(p.roadSurfaces()).count).toBe(0);expect(overlaps(p.sidewalks()).count).toBe(0);expect(overlaps(p.sidewalks(),p.roadSurfaces()).count).toBe(0)}
 const decks=new StreetSurfacePlan([line('low',[-20,0],[20,0]),line('high',[0,-20],[0,20],6,1)],R)
 expect(decks.roadSurfaces().every(s=>!s.junction)).toBe(true);expect(area(decks.roadSurfaces())).toBeCloseTo(480,7)
})
test('curves, parallel roads and the cylindrical seam are clipped in metric space',()=>{
 const curve={...line('curve',[-40,0],[40,0]),knots:[{point:[-40,0],tangent:[80,50]},{point:[40,0],tangent:[80,50]}]} as StreetPath
 for(const seam of [0,Math.PI]){
  const paths=[{...curve,azimuth:seam},{...line('cross',[0,-30],[0,30]),azimuth:seam===0?0:-Math.PI}]
  const p=new StreetSurfacePlan(paths,R),walk=p.sidewalks()
  expect(overlaps(p.roadSurfaces()).count).toBe(0);expect(overlaps(walk).count).toBe(0);expect(overlaps(walk,p.roadSurfaces()).count).toBe(0)
  expect(p.roadSurfaces().some(s=>s.junction)).toBe(true)
 }
 const parallel=new StreetSurfacePlan([line('a',[-20,0],[20,0]),line('b',[-20,10],[20,10])],R)
 expect(area(parallel.roadSurfaces())).toBeCloseTo(480,7);expect(parallel.roadSurfaces().every(s=>!s.junction)).toBe(true)
})
test('driveway cuts and open squares remove pavement without altering the roadway',()=>{
 const p=new StreetSurfacePlan([line('road',[0,-40],[0,40])],R)
 const cut={azimuth:5/R,axial:0,tangentWidth:8,axialLength:6,kind:'local' as const}
 const walks=p.sidewalks(()=>false,[cut]),uncut=p.sidewalks()
 expect(area(walks)).toBeCloseTo(area(uncut)-12,6)
 expect(p.sidewalks(()=>true)).toHaveLength(0)
 expect(area(p.roadSurfaces())).toBeCloseTo(480,7)
})
test('native surface meshes bound cylinder sagitta and retain UVs and outward winding',()=>{
 const p=new StreetSurfacePlan([line('long',[-150,-40],[150,40],20)],R)
 const g=buildStreetSurfaceGeometry(p.roadSurfaces(),R,16)!,v=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv'),indices=g.index!
 for(let i=0;i<v.count;i++){expect(Math.hypot(v.getX(i),v.getZ(i))).toBeCloseTo(R-.2,3);expect(Number.isFinite(uv.getX(i)+uv.getY(i))).toBe(true)}
 for(let i=0;i<indices.count;i+=3){
  const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2)
  const centre=[0,1,2].map(k=>(v.array[a*3+k]+v.array[b*3+k]+v.array[c*3+k])/3)
  expect(R-.2-Math.hypot(centre[0],centre[2])).toBeLessThan(.0202)
  const ab=[0,1,2].map(k=>v.array[b*3+k]-v.array[a*3+k]),ac=[0,1,2].map(k=>v.array[c*3+k]-v.array[a*3+k])
  expect((ab[1]*ac[2]-ab[2]*ac[1])*n.getX(a)+(ab[0]*ac[1]-ab[1]*ac[0])*n.getZ(a)).toBeGreaterThan(0)
 }
 g.dispose()
})
test('the complete city road union survives the generic compiler with disjoint sidewalks',()=>{
 const city=planCity({radius:R,length:40000,maxBuildings:18000}),p=new StreetSurfacePlan(legacyStreetPaths(city.roads),R)
 const old=compileRoadNetwork(city.roads,R).surfaces.reduce((n,s)=>n+s.tangentWidth*s.axialLength,0)
 const roads=p.roadSurfaces()
 expect(area(roads)).toBeCloseTo(old,2)
 expect(overlaps(roads)).toEqual({count:0,max:0})
 const walks=p.sidewalks()
 expect(walks.length).toBeGreaterThan(1000)
 expect(overlaps(walks)).toEqual({count:0,max:0});expect(overlaps(walks,roads)).toEqual({count:0,max:0})
},30000)
