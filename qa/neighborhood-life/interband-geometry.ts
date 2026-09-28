/** Audit the staged bridge drawing and the real bounded collision path. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { readColonyDocument } from '../../src/worlds/colonyManifestDocument'
import { readColonyManifest, colonyColliders } from '../../src/worlds/authoredColony'
import { landscapeColliders } from '../../src/worlds/authoredLandscape'
import { ColonyCollisionCache } from '../../src/worlds/colonyCollisionCache'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../../src/objects/cityLayout'

const root=process.env.SPINWARD_INTERBAND_SOURCE
if(!root||!path.isAbsolute(root))throw Error('An absolute SPINWARD_INTERBAND_SOURCE is required')
const header=JSON.parse(await fs.readFile(path.join(root,'src/worlds/generated/izmaColony.json'),'utf8'))
const raw=await readColonyDocument(header,{load:async url=>{
  const bytes=await fs.readFile(path.join(root,'public',url))
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
}})
const manifest=readColonyManifest(raw),interband=(raw as any).interband
if(interband.rings.length!==2||interband.approaches.length!==6)throw Error('Both ends must join all three bands')
const cache=new ColonyCollisionCache(),identities=new Map<CityBuilding,unknown>()
const layers=[['base',manifest.base],...Object.entries(manifest).filter(([,v]:any)=>v?.fixed).map(([k,v]:any)=>[k,v.fixed])]
const bodies=layers.flatMap(([name,packed]:any)=>cache.colliders(packed,3200).map((body,i)=>{
  identities.set(body,{layer:name,surface:i});return body
}))
const empty={vertices:[],meshes:{},surfaces:[]},solids={...manifest,base:empty}
for(const [name] of layers)if(name!=='base')(solids as any)[name]={...(solids as any)[name],fixed:empty}
bodies.push(...colonyColliders(solids))
const index=buildCityCollisionIndex(bodies,3200,40000),near=new Set<CityBuilding>()
const drawing=new Map<string,number[]>(),packed=interband.fixed
for(const material of ['interband-road','interband-walk']){
  const indices=packed.meshes[material]
  for(let i=0;i<indices.length;i+=3){
    const points=indices.slice(i,i+3).map((j:number)=>packed.vertices.slice(j*3,j*3+3))
    const x=points.reduce((s:number,p:number[])=>s+p[0],0)/3,y=points.reduce((s:number,p:number[])=>s+p[1],0)/3
    const key=`${Math.floor(x/32)}:${Math.floor(y/32)}`
    if(!drawing.has(key))drawing.set(key,[])
    drawing.get(key)!.push(...points.flat())
  }
}
const drawIndex=buildCityCollisionIndex(landscapeColliders({solids:[],surfaces:[...drawing.values()].map(vertices=>({
  vertices,bounds:[Math.min(...vertices.filter((_,i)=>i%3===0)),Math.min(...vertices.filter((_,i)=>i%3===1)),
    Math.max(...vertices.filter((_,i)=>i%3===0)),Math.max(...vertices.filter((_,i)=>i%3===1))] as [number,number,number,number]
}))},3200),3200,40000)
const report={origin:'ai',created:'2026-09-20',sourceSha256:header.sourceSha256,samples:0,
  maximumDrawError:0,maximumProfileError:0,maxBodies:0,maxTriangles:0,
  supportFailures:[] as unknown[],costFailures:[] as unknown[],worst:null as unknown}
function sample(x:number,y:number,h:number,id:string){
  const drawn=getCityGroundHeight(drawIndex,3200,x/3200,y,h+.045,0)
  const physical=getCityGroundHeight(index,3200,x/3200,y,h+.045,0)
  const error=Math.abs(drawn-physical),profileError=Math.abs(h-drawn)
  report.samples++;report.maximumDrawError=Math.max(report.maximumDrawError,error)
  report.maximumProfileError=Math.max(report.maximumProfileError,profileError)
  if(error>.025||profileError>.025)report.supportFailures.push({id,x,y,h,drawn,physical})
  collectCityCollidersNear(index,x/3200,y,1,near)
  const triangles=[...near].reduce((n,b)=>n+(b.surfaceMesh?.length??0)/9,0)
  report.maxBodies=Math.max(report.maxBodies,near.size)
  if(triangles>report.maxTriangles){report.maxTriangles=triangles;report.worst={id,x,y,triangles,
    bodies:[...near].map(b=>({source:identities.get(b),triangles:(b.surfaceMesh?.length??0)/9}))}}
  if(near.size>32||triangles>4096)report.costFailures.push({id,x,y,bodies:near.size,triangles})
}
for(const ring of interband.rings){
  const gates=interband.approaches.filter((g:any)=>ring.gates.includes(g.id)),p=ring.profile
  for(let i=0;i<p.length-1;i++)for(const t of [.25,.75]){
    const [x,y,h]=p[i].map((v:number,k:number)=>v+(p[i+1][k]-v)*t)
    for(const side of [-1,0,1]){
      const mouth=side===-ring.sign&&gates.some((g:any)=>Math.abs(x-g.x)<10)
      sample(x,y+side*10.8,h+(side && !mouth ? .14 : 0),ring.id)
    }
  }
}
for(const gate of interband.approaches){
  const p=gate.profile
  for(let i=0;i<p.length-1;i++)for(const t of [.1,.5,.9]){
    const [x,y,h]=p[i].map((v:number,k:number)=>v+(p[i+1][k]-v)*t)
    for(const side of [-1,0,1])sample(x+side*11.1,y,h+(side ? .14 : 0),gate.id)
  }
  // Inspect both margins at the T joint: perspective can hide one narrow path.
  // These probes span 1.5 m of clear width inside each 2.2 m native footway.
  const ring=interband.rings.find((r:any)=>r.gates.includes(gate.id))
  const footEnd=ring.axial-ring.sign*13.4,h=p.at(-1)[2]
  for(const side of [-1,1])for(const across of [10.3,11.1,11.8])
    for(const along of [-8,-4,-1,-.25,.25,1,4])
      sample(gate.x+side*across,footEnd+ring.sign*along,h+.14,gate.id+'-footway-width')
}
await fs.writeFile(path.join(root,'interband-geometry-audit.json'),JSON.stringify({...report,cache:cache.stats},null,2)+'\n')
console.log(JSON.stringify({...report,worst:undefined,supportFailures:report.supportFailures.length,costFailures:report.costFailures.length,cache:cache.stats}))
if(report.supportFailures.length||report.costFailures.length)throw Error('Interband geometry failed; inspect the saved report')
