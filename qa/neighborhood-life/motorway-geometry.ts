/** Check the staged IC drawing through the app's bounded collision queries. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { readColonyDocument } from '../../src/worlds/colonyManifestDocument'
import { readColonyManifest, colonyColliders } from '../../src/worlds/authoredColony'
import { landscapeColliders } from '../../src/worlds/authoredLandscape'
import { ColonyCollisionCache } from '../../src/worlds/colonyCollisionCache'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../../src/objects/cityLayout'
import landscapeLibrary from '../../src/worlds/generated/worldLandscapes.json'
import { unpackLandscapeLibrary } from '../../src/worlds/landscapeData'

const root=process.env.SPINWARD_MOTORWAY_SOURCE
const routePath=process.env.SPINWARD_MOTORWAY_ROUTES
if(!root||!path.isAbsolute(root))throw Error('An absolute SPINWARD_MOTORWAY_SOURCE is required')
const header=JSON.parse(await fs.readFile(path.join(root,'src/worlds/generated/izmaColony.json'),'utf8'))
const raw:any=await readColonyDocument(header,{load:async url=>{
  const bytes=await fs.readFile(path.join(root,'public',url))
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
}})
const manifest=readColonyManifest(raw),cache=new ColonyCollisionCache()
const layers=[['base',manifest.base],...Object.entries(manifest).filter(([,v]:any)=>v?.fixed).map(([k,v]:any)=>[k,v.fixed])]
const identities=new Map<CityBuilding,unknown>()
const bodies=layers.flatMap(([name,packed]:any)=>cache.colliders(packed,3200).map((body,i)=>{
  identities.set(body,{layer:name,surface:i});return body
}))
const empty={vertices:[],meshes:{},surfaces:[]},solids:any={...manifest,base:empty}
for(const [name] of layers)if(name!=='base')solids[name]={...solids[name],fixed:empty}
bodies.push(...colonyColliders(solids))
const study=routePath?unpackLandscapeLibrary(landscapeLibrary).izma:null
if(study)bodies.push(...landscapeColliders(study,3200))
const index=buildCityCollisionIndex(bodies,3200,40000),near=new Set<CityBuilding>()
const drawing=new Map<string,number[]>()
const drawnLayers=routePath?layers.map(([,packed])=>packed):[raw.base,raw.motorway.fixed]
for(const packed of drawnLayers as any[])for(const material of routePath?Object.keys(packed.meshes).filter(m=>!/(mark|lamp)/.test(m)):['arterial','expressway','walk','motorway-road','motorway-walk']){
  const ids=packed.meshes[material]??[]
  for(let i=0;i<ids.length;i+=3){
    const points=ids.slice(i,i+3).map((j:number)=>packed.vertices.slice(j*3,j*3+3))
    const x=points.reduce((s:number,p:number[])=>s+p[0],0)/3,y=points.reduce((s:number,p:number[])=>s+p[1],0)/3
    const key=`${Math.floor(x/32)}:${Math.floor(y/32)}`
    if(!drawing.has(key))drawing.set(key,[])
    drawing.get(key)!.push(...points.flat())
  }
}
if(study)for(const [material,vertices] of Object.entries(study.lods[0])){
  if(/(mark|lamp)/.test(material))continue
  for(let i=0;i<vertices.length;i+=9){
    const key=`${Math.floor((vertices[i]+vertices[i+3]+vertices[i+6])/96)}:${Math.floor((vertices[i+1]+vertices[i+4]+vertices[i+7])/96)}`
    if(!drawing.has(key))drawing.set(key,[])
    drawing.get(key)!.push(...vertices.slice(i,i+9))
  }
}
const drawIndex=buildCityCollisionIndex(landscapeColliders({solids:[],surfaces:[...drawing.values()].map(vertices=>({
  vertices,bounds:[Math.min(...vertices.filter((_,i)=>i%3===0)),Math.min(...vertices.filter((_,i)=>i%3===1)),
    Math.max(...vertices.filter((_,i)=>i%3===0)),Math.max(...vertices.filter((_,i)=>i%3===1))] as [number,number,number,number]
}))},3200),3200,40000)
const report={origin:'ai',created:'2026-09-20',sourceSha256:header.sourceSha256,samples:0,
  drawingScope:routePath?'all fixed layers and actual Izma study':'base and motorway road decks',
  maximumDrawError:0,maximumProfileError:0,maxBodies:0,maxTriangles:0,
  supportFailures:[] as unknown[],costFailures:[] as unknown[],worst:null as unknown}
function sample(x:number,y:number,h:number,id:string){
  const drawn=getCityGroundHeight(drawIndex,3200,x/3200,y,h+.05,0)
  const physical=getCityGroundHeight(index,3200,x/3200,y,h+.05,0)
  const error=Math.abs(drawn-physical),profileError=Math.abs(h-drawn)
  report.samples++;report.maximumDrawError=Math.max(report.maximumDrawError,error)
  report.maximumProfileError=Math.max(report.maximumProfileError,profileError)
  if(error>.025||profileError>.05)report.supportFailures.push({id,x,y,h,drawn,physical})
  collectCityCollidersNear(index,x/3200,y,1,near)
  const triangles=[...near].reduce((n,b)=>n+(b.surfaceMesh?.length??0)/9,0)
  report.maxBodies=Math.max(report.maxBodies,near.size)
  if(triangles>report.maxTriangles){report.maxTriangles=triangles;report.worst={id,x,y,triangles,
    bodies:[...near].map(b=>({source:identities.get(b),triangles:(b.surfaceMesh?.length??0)/9}))}}
  if(near.size>32||triangles>4096)report.costFailures.push({id,x,y,bodies:near.size,triangles})
}
for(const ic of raw.motorway.interchanges){
  for(const road of ic.roads)for(let i=0;i<road.points.length-1;i++){
    const a=road.points[i],b=road.points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)
    for(const t of [.25,.75])for(const offset of [-road.width/2+.35,0,road.width/2-.35]){
      sample(a[0]+dx*t-dy/length*offset,a[1]+dy*t+dx/length*offset,a[2]+(b[2]-a[2])*t,road.id)
    }
  }
  for(let i=0;i<ic.mainline.length-1;i++){
    const a=ic.mainline[i],b=ic.mainline[i+1]
    for(const offset of [-8,-4,4,8])sample((a[0]+b[0])/2+offset,(a[1]+b[1])/2,(a[2]+b[2])/2,ic.id+'-retained-mainline')
  }
}
if(routePath){
  if(!path.isAbsolute(routePath))throw Error('An absolute route sidecar path is required')
  const routes=JSON.parse(await fs.readFile(routePath,'utf8'))
  if(routes.sourceSha256!==header.sourceSha256)throw Error('Routes belong to another source')
  for(const edge of routes.laneGraph.edges)for(let i=0;i<edge.points.length-1;i++){
    const a=edge.points[i],b=edge.points[i+1],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2))
    for(let j=0;j<=count;j++)sample(a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count,
      a[2]+(b[2]-a[2])*j/count,edge.id)
  }
}
await fs.writeFile(path.join(root,routePath?'motorway-route-full-drawing-audit.json':'motorway-geometry-audit.json'),JSON.stringify({...report,cache:cache.stats},null,2)+'\n')
console.log(JSON.stringify({...report,worst:undefined,supportFailures:report.supportFailures.length,costFailures:report.costFailures.length,cache:cache.stats}))
if(report.supportFailures.length||report.costFailures.length)throw Error('Integrated motorway geometry failed; inspect the saved report')
