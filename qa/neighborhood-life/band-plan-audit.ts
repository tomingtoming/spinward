import { bandGraph, planBandStreets } from '../../src/objects/bandStreetPlan'
import { proposedBandLand } from '../../src/objects/bandLand'
import { planBandTransport } from '../../src/objects/bandExpressway'
import { proposedBandExpressway } from '../../src/objects/bandExpresswayLand'

const site=proposedBandLand(),times:number[]=[]
const transport=process.argv.includes('--transport')
const generate=()=>transport?planBandTransport(site,proposedBandExpressway()).surface:planBandStreets(site)
let plan=generate() // warm-up is excluded
for(let i=0;i<5;i++){const t=performance.now();plan=generate();times.push(performance.now()-t)}
const graph=bandGraph(plan.roads),angles:number[]=[]
for(const [i,edges] of graph.adjacency.entries())if(edges.length>=3){
  const p=graph.points[i],headings=edges.map(e=>Math.atan2(graph.points[e.to][1]-p[1],graph.points[e.to][0]-p[0])).sort((a,b)=>a-b)
  angles.push(Math.min(...headings.map((a,j)=>(headings[(j+1)%headings.length]-a+Math.PI*2)%(Math.PI*2)))*180/Math.PI)
}
const lengths=plan.roads.map(r=>Math.hypot(r.to[0]-r.from[0],r.to[1]-r.from[1]))
console.log(JSON.stringify({scope:'standalone planning CPU; excludes planCity, rendering and physical headset',
  transportReservations:transport,
  milliseconds:times,medianMs:[...times].sort((a,b)=>a-b)[2],segments:plan.roads.length,
  totalRoadMetres:lengths.reduce((a,b)=>a+b,0),smallestSegmentMetres:Math.min(...lengths),
  junctions:angles.length,junctionsBelow25Degrees:angles.filter(a=>a<25).length,minimumJunctionDegrees:Math.min(...angles),
  deadEnds:graph.degree.filter(n=>n===1).length,cycles:graph.cycles,components:graph.components,
  sampledDemand:plan.demand.length,unallocatedDemand:plan.unallocatedDemand,unconnected:plan.unconnected},null,2))
