import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { planCity } from '../../src/objects/cityLayout'
import { planCurvedNeighborhood } from '../../src/objects/curvedNeighborhood'
import { certifyStreetAccess } from '../../src/objects/streetFrontage'
import { StreetNetwork } from '../../src/objects/streetNetwork'
const directory=new URL('../webxr/evidence/street-frontage-20260913/',import.meta.url)
await fs.mkdir(directory,{recursive:true})
const previous=process.env.BASELINE_LAYOUT?await import(process.env.BASELINE_LAYOUT):null
const median=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return(s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2}
const key=(b:{azimuth:number;axial:number})=>`${b.azimuth},${b.axial}`
const sourceHash=(p:ReturnType<typeof planCity>)=>createHash('sha256').update(JSON.stringify([p.buildings.map(({access,streetKind,...b})=>b),p.roads,p.patches])).digest('hex')
const rows=[]
for(const maxBuildings of [16000,18000,64000]){
 const options={radius:3200,length:40000,maxBuildings},p=planCity(options),before=previous?.planCity(options) as ReturnType<typeof planCity>|undefined
 let maxDelta=0,identityChanges=0,sourcePreserved:boolean|null=null
 if(before){
  sourcePreserved=sourceHash(p)===sourceHash(before)
  const old=new Map(before.buildings.map(b=>[key(b),b]))
  for(const b of p.buildings){const a=old.get(key(b))?.access,v=b.access!
   if(!a||a.roadId!==v.roadId||a.roadIndex!==v.roadIndex){identityChanges++;continue}
   maxDelta=Math.max(maxDelta,Math.abs(a.length-v.length),Math.abs(a.width-v.width),
    Math.abs(a.entrance.azimuth-v.entrance.azimuth)*3200,Math.abs(a.entrance.axial-v.entrance.axial),
    Math.abs(a.roadEdge.azimuth-v.roadEdge.azimuth)*3200,Math.abs(a.roadEdge.axial-v.roadEdge.axial))
  }
  if(!sourcePreserved||identityChanges||maxDelta>1e-8)throw Error('Existing parcel/access geometry changed')
 }
 const timings:Record<string,number[]>={native:[],previous:[]}
 for(const [name,generate] of [['native',planCity],['previous',previous?.planCity]] as const){
  if(!generate)continue
  for(let i=0;i<5;i++){const start=performance.now();generate(options);const ms=performance.now()-start;if(i)timings[name].push(ms)}
 }
 const garden=planCurvedNeighborhood(p,3200)!,network=new StreetNetwork([...p.streetNetwork!.streets,garden.street,...garden.streetLinks],3200)
 const certified=certifyStreetAccess(garden.buildings,network,3200,10)
 if(certified.rejected.length||certified.buildings.length!==8)throw Error('Garden frontage rejected')
 rows.push({maxBuildings,buildings:p.buildings.length,rejected:p.accessRejected?.length,sourcePreserved,identityChanges,maxAccessDeltaMeters:maxDelta,
  storedStraightPolygons:p.buildings.reduce((n,b)=>n+(b.access?.corridor?.length??0),0),
  nativeMedianMs:median(timings.native),previousMedianMs:previous?median(timings.previous):null,timings,
  garden:certified.buildings.map(b=>({road:b.access.roadId,length:b.access.length,pieces:b.access.corridor?.length??0}))})
}
const report={runtime:process.versions,before:previous?'435ba44 module replay with unchanged dependencies':null,
 scope:'planCity CPU only, four warm samples; rendering, whole boot and physical Quest performance unmeasured',rows}
await fs.writeFile(new URL('audit.json',directory),JSON.stringify(report,null,2));console.log(JSON.stringify(rows))
