import { planCity } from '../../src/objects/cityLayout'
import { rebuildNativeDistricts } from '../../src/objects/nativeDistricts'
import { StreetMarkingPlan } from '../../src/objects/streetMarkings'
import { StreetSignalPlan } from '../../src/objects/streetSignals'
import { planDistrictWalkerRoutes } from '../../src/objects/districtWalkerRoutes'
import { planDistrictLampSpots } from '../../src/objects/streetLamps'
import { sampleStreetPath } from '../../src/objects/streetPath'

const median=(a:number[])=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]
const report=[]
for(const maxBuildings of [16000,18000,64000]){
 const samples:number[]=[],walkerSamples:number[]=[];let walkerColdMs=0
 let p=planCity({radius:3200,length:40000,maxBuildings})
 // One warm-up followed by five complete replacements. Base city generation
 // is outside the timer; this is added generation work, not FPS or load time.
 for(let run=0;run<6;run++){
  if(run)p=planCity({radius:3200,length:40000,maxBuildings})
  const t=performance.now();rebuildNativeDistricts(p,3200)
  if(run)samples.push(performance.now()-t)
 }
 const network=p.streetNetwork!,markings=new StreetMarkingPlan(network)
 p.streetMarkings=markings;p.streetSignals=new StreetSignalPlan(markings,p.intersections)
 const paths=p.nativeDistricts!,street=paths[0].streets[1],v=sampleStreetPath(street,.12,11.3)
 const focus={azimuth:street.azimuth+v.x/3200,axial:street.axial+v.y,range:110}
 for(let i=0;i<31;i++){
  const t=performance.now();planDistrictWalkerRoutes(p,focus);const ms=performance.now()-t;if(i)walkerSamples.push(ms);else walkerColdMs=ms
 }
 const ids=new Set(network.streets.map(s=>s.id)),junctions=markings.junctions.filter(j=>j.arms.some(a=>network.streets[a.street].id.startsWith('district-')))
 report.push({maxBuildings,buildings:p.buildings.length,districts:paths.map(d=>({id:d.id,width:d.width,length:d.length,buildings:d.buildings.length,replacedBuildings:d.replacedBuildings,roads:d.streets.length})),
  graphComponents:new Set(network.components).size,junctions:junctions.length,
  missingAccess:p.buildings.filter(b=>!b.access||!ids.has(b.access.roadId)).length,
  missingCrossingArms:junctions.reduce((sum,j)=>sum+j.arms.length-markings.junctionCrossings(j).length,0),
  unprotectedArterials:junctions.filter(j=>j.arms.some(a=>network.streets[a.street].kind==='arterial')&&!p.streetSignals!.controlsJunction(network.nodes[j.node].azimuth,network.nodes[j.node].axial)).length,
  lampSpots:planDistrictLampSpots(paths,3200,markings).length,
  extraGenerationMs:median(samples),generationSamples:samples,walkerColdMs,nearbyWalkerPlanMs:median(walkerSamples),walkerPlanSamples:walkerSamples,
  nearbyWalkerRoutes:planDistrictWalkerRoutes(p,focus).length})
}
console.log(JSON.stringify(report,null,2))
