import {planCity} from '../../src/objects/cityLayout'
import {legacyStreetPaths} from '../../src/objects/streetPath'
import {StreetSurfacePlan} from '../../src/objects/streetSurfacePlan'
import {compileRoadNetwork} from '../../src/objects/roadNetwork'
import {buildStreetSurfaceGeometry} from '../../src/objects/streetSurfaceGeometry'
import {buildRoadSurfaceGeometry} from '../../src/objects/roadSurfaceGeometry'
import {getArcSegments} from '../../src/objects/cityscape'
import {planSidewalkSegments} from '../../src/objects/sidewalks'
import {writeFileSync} from 'node:fs'
const city=planCity({radius:3200,length:40000,maxBuildings:18000}),paths=legacyStreetPaths(city.roads),runs=[]
for(let i=0;i<4;i++){
 const start=performance.now(),old=compileRoadNetwork(city.roads,3200),oldWalk=planSidewalkSegments(city.roads,city.intersections,3200,3,()=>false),oldMs=performance.now()-start
 const from=performance.now(),native=new StreetSurfacePlan(paths,3200),walk=native.sidewalks(),roads=native.roadSurfaces(),newMs=performance.now()-from
 const roadBefore=buildRoadSurfaceGeometry(old.surfaces,3200,16)!,road=buildStreetSurfaceGeometry(roads,3200,16)!,foot=buildStreetSurfaceGeometry(walk,3200,5)!
 const result={oldMs,newMs,oldRoadPieces:old.surfaces.length,roadPieces:roads.length,oldWalkPieces:oldWalk.length,walkPieces:walk.length,
  oldWalkTriangles:oldWalk.reduce((n,s)=>n+2*getArcSegments(s.tangentExtent/3200,3200),0),oldRoadTriangles:roadBefore.index!.count/3,roadTriangles:road.index!.count/3,walkTriangles:foot.index!.count/3}
 roadBefore.dispose();road.dispose();foot.dispose();if(i)runs.push(result)
 console.log(result)
}
writeFileSync(new URL('./street-surfaces-cost.json',import.meta.url),JSON.stringify({runtime:Bun.version,runs},null,2))
