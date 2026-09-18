import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import raw from '../../qa/neighborhood-life/colony-source'
import land from '../../assets/blender/izma-land-use.json'
import primary from '../../assets/blender/izma-parcels.json'
import neighbourhoods from '../../assets/blender/izma-neighbourhood-parcels.json'
import { readColonyManifest, colonyColliders, decodeColonyMesh } from './authoredColony'
import { landscapeColliders } from './authoredLandscape'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { positivePolygon, polygonArea, intersectStreetPolygons } from '../objects/streetPolygon'

const m=readColonyManifest(raw),physics=buildCityCollisionIndex(colonyColliders(m),3200,40000)
const drawn=decodeColonyMesh(m.landUse!.fixed,false).meshes
const index=(positions:number[])=>{
 const buckets=new Map<string,number[]>()
 for(let i=0;i<positions.length;i+=9){const key=`${Math.floor(positions[i]/64)}:${Math.floor(positions[i+1]/64)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key)!.push(...positions.slice(i,i+9))}
 return buildCityCollisionIndex(landscapeColliders({solids:[],surfaces:[...buckets.values()].map(vertices=>{
  const xs=vertices.filter((_,i)=>i%3===0),ys=vertices.filter((_,i)=>i%3===1)
  return {vertices,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]as[number,number,number,number]}
 })},3200),3200,40000)
}
test('land use retains current reservations, all districts and distinct productive landscapes',async()=>{
 for(const [name,digest]of Object.entries(land.dependencies))expect(createHash('sha256').update(new Uint8Array(await Bun.file(new URL('../../assets/blender/'+name,import.meta.url)).arrayBuffer())).digest('hex'),name).toBe(digest)
 expect(new Set(land.zones.map(z=>z.district)).size).toBe(18)
 for(const [district,use]of [['c-fields','allotments'],['c-orchards','orchard'],['c-forest','woodland']])expect(land.zones.some(z=>z.district===district&&z.use===use)).toBe(true)
 expect(m.landUse!.counts.zones).toBe(land.zones.length)
 for(const tile of m.tiles.filter(t=>t.landUse)){
  const file=Bun.file(new URL('../../public'+tile.url,import.meta.url));expect(file.size).toBeLessThan(4*1024*1024)
  const packed=await file.json();expect(Object.keys(decodeColonyMesh(packed).meshes).length).toBeGreaterThan(0);expect(Object.keys(decodeColonyMesh(packed.mid).meshes).length).toBeGreaterThan(0)
  expect(tile.proxyParts!.length).toBeGreaterThan(0)
 }
})
test('planted and working ground stays outside saved building plots',()=>{
 const poly=(p:number[][])=>positivePolygon(p.map(([x,y])=>({x,y,u:0,v:0})))
 const lots=[...neighbourhoods.parcels.map(p=>poly(p.lot.polygon)),...primary.parcels.map(p=>poly([[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{
  const x=u*(p.size[0]+1)/2,y=v*(p.size[1]+1)/2
  return[p.position[0]+Math.cos(p.yaw)*x-Math.sin(p.yaw)*y,p.position[1]+Math.sin(p.yaw)*x+Math.cos(p.yaw)*y]
 })))]
 const bounds=(p:{x:number;y:number}[])=>[Math.min(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.x)),Math.max(...p.map(p=>p.y))]
 const boxes=lots.map(bounds)
 for(const zone of land.zones)for(const piece of zone.pieces){
  const p=poly(piece),b=bounds(p)
  lots.forEach((q,i)=>{const a=boxes[i];if(a[0]>=b[2]||b[0]>=a[2]||a[1]>=b[3]||b[1]>=a[3])return
   expect(polygonArea(intersectStreetPolygons(p,q)),zone.id).toBeLessThan(.0001)
  })
 }
})
test('terrain overlays remain supported and every accepted path matches native physical floors',()=>{
 const terrain=index(decodeColonyMesh(m.base,false).meshes.earth)
 for(const [material,positions]of Object.entries(drawn)){
  if(material==='land-path'||material==='land-plinth')continue
  const overlay=index(positions)
  for(let i=0;i<positions.length;i+=27){
   const x=(positions[i]+positions[i+3]+positions[i+6])/3,y=(positions[i+1]+positions[i+4]+positions[i+7])/3,h=(positions[i+2]+positions[i+5]+positions[i+8])/3
   const ground=getCityGroundHeight(terrain,3200,x/3200,y,h+3,0)
   const visible=getCityGroundHeight(overlay,3200,x/3200,y,h+3,0)
   expect(Math.abs(visible-ground),material).toBeLessThan(.04)
  }
 }
 const walk=index(drawn['land-path'])
 for(const z of land.zones){
  if(!z.access){expect(m.visits['land-'+z.id]).toBeUndefined();continue}
  expect(m.visits['land-'+z.id]).toBeDefined()
  for(const rows of [z.access.profile,...z.walkProfiles])for(let i=1;i<rows.length;i++){
   const a=rows[i-1],b=rows[i],x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,h=(a[2]+b[2])/2
   const visible=getCityGroundHeight(walk,3200,x/3200,y,h+.2,0)
   // Profiles average both edges. A triangulated quad's centre can differ
   // at a terrain crease or the 14 cm street crossfall. The decisive check
   // below compares actual visible and physical triangles within 2 cm.
   expect(Math.abs(visible-h),z.id).toBeLessThan(.18)
   expect(Math.abs(getCityGroundHeight(physics,3200,x/3200,y,visible+.03,0)-visible),z.id).toBeLessThan(.02)
  }
 }
})
