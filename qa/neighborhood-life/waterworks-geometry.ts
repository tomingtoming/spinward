/** Exercise the real broad/narrow phase around an isolated waterworks package. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { readColonyDocument } from '../../src/worlds/colonyManifestDocument'
import { readColonyManifest, colonyColliders } from '../../src/worlds/authoredColony'
import { ColonyCollisionCache } from '../../src/worlds/colonyCollisionCache'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../../src/objects/cityLayout'

const root = process.env.SPINWARD_WATERWORKS_SOURCE
if (!root || !path.isAbsolute(root)) throw Error('An absolute SPINWARD_WATERWORKS_SOURCE is required')
const header = JSON.parse(await fs.readFile(path.join(root,'src/worlds/generated/izmaColony.json'),'utf8'))
const raw = await readColonyDocument(header, { load: async url => {
  const bytes = await fs.readFile(path.join(root,'public',url))
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
} })
const manifest = readColonyManifest(raw)
const facilities = (raw as any).waterworks.facilities as { id: string; band: number; role: string; position: number[]; floor: number;
  serviceAccess: { profile: number[][] } }[]
if (facilities.length !== 6 || new Set(facilities.map(f=>f.id)).size !== 6) throw Error('Expected six distinct facilities')
const cache = new ColonyCollisionCache(), identities = new Map<CityBuilding,unknown>()
const layers = [['base',manifest.base], ...Object.entries(manifest).filter(([,v]:any)=>v?.fixed).map(([k,v]:any)=>[k,v.fixed])]
const bodies = layers.flatMap(([name,packed]:any)=>cache.colliders(packed,3200).map((b,i)=>{
  identities.set(b,{name,surface:i});return b
}))
// Reuse only the solid part of the ordinary manifest path. Passing empty fixed
// layers prevents decoding the entire colony a second time.
const empty = { vertices: [], meshes: {}, surfaces: [] }
const solids = { ...manifest, base: empty }
for (const [name] of layers) if (name !== 'base') (solids as any)[name] = { ...(solids as any)[name], fixed: empty }
bodies.push(...colonyColliders(solids))
const index = buildCityCollisionIndex(bodies,3200,40000), near = new Set<CityBuilding>()
const report = { origin:'ai',created:'2026-09-20',sourceSha256:header.sourceSha256,samples:0,maxBodies:0,maxTriangles:0,
  worst: null as unknown, costFailures:[] as unknown[],supportFailures:[] as unknown[],facilities: facilities.map(f=>f.id) }
function check(x:number,y:number,id:string) {
  collectCityCollidersNear(index,x/3200,y,1,near)
  const triangles = [...near].reduce((sum,b)=>sum+(b.surfaceMesh?.length??0)/9,0)
  report.samples++;report.maxBodies=Math.max(report.maxBodies,near.size)
  if (triangles>report.maxTriangles) {
    report.maxTriangles=triangles
    report.worst={id,x,y,triangles,bodies:[...near].map(b=>({source:identities.get(b),triangles:(b.surfaceMesh?.length??0)/9}))}
  }
  if (near.size>32||triangles>4096) report.costFailures.push({id,x,y,bodies:near.size,triangles})
}
function support(x:number,y:number,height:number,id:string) {
  const actual = getCityGroundHeight(index,3200,x/3200,y,height+.04,0)
  if (Math.abs(actual-height)>.025) report.supportFailures.push({id,x,y,height,actual})
  check(x,y,id)
}
for (const f of facilities) {
  const [x,y]=f.position
  for(let dx=-85;dx<=85;dx+=4)for(let dy=-115;dy<=115;dy+=4)check(x+dx,y+dy,f.id)
  for(const p of f.serviceAccess.profile) support(p[0],p[1],p[2],f.id+' service')
  // Interior samples avoid step edges, where both heights legitimately exist.
  for(let step=0;step<22;step++) support(x+12,y+9-step*.3,f.floor+(step+1)*3.38/22,f.id+' stair '+step)
  support(x+12,y+1,f.floor+3.38,f.id+' landing')
  if(f.role==='recovery') for(const dy of [-48,-30,-10,0,10,30,48]) support(x-6,y+dy,f.floor+3.38,f.id+' gallery')
}
await fs.writeFile(path.join(root,'waterworks-geometry-audit.json'),JSON.stringify({...report,cache:cache.stats},null,2)+'\n')
console.log(JSON.stringify({...report,worst:undefined,costFailures:report.costFailures.length,supportFailures:report.supportFailures.length,cache:cache.stats}))
if(report.costFailures.length||report.supportFailures.length)throw Error('Waterworks geometry audit failed; see report')
