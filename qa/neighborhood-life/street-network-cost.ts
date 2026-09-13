import { planCity } from '../../src/objects/cityLayout'
import { planCurvedNeighborhood } from '../../src/objects/curvedNeighborhood'
import { legacyStreetPaths } from '../../src/objects/streetPath'
import { StreetNetwork } from '../../src/objects/streetNetwork'
import { writeFileSync } from 'node:fs'
const results=[]
for(const budget of [16000,18000,64000]){
 const plan=planCity({radius:3200,length:40000,maxBuildings:budget}),curve=planCurvedNeighborhood(plan,3200)!
 const samples=[];let network:StreetNetwork|null=null
 for(let run=0;run<5;run++){
  const start=performance.now()
  network=new StreetNetwork([...legacyStreetPaths(plan.roads),curve.street,...curve.streetLinks],3200)
  const ms=performance.now()-start;if(run)samples.push(ms)
 }
 samples.sort((a,b)=>a-b)
 const result={budget,roads:plan.roads.length,streets:network!.streets.length,segments:network!.segments.length,
  nodes:network!.nodes.length,edges:network!.edges.length,components:new Set(network!.components).size,
  generationMs:{samples,median:(samples[1]+samples[2])/2,max:samples.at(-1)},runtime:Bun.version}
 results.push(result);console.log(result)
}
writeFileSync(new URL('./street-network-cost.json',import.meta.url),JSON.stringify(results,null,2))
