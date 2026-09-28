/** Offline land parcels between saved buildings. The editable Blender scene
 * remains the runtime export source; this is not a runtime terrain generator. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { positivePolygon, polygonArea, subtractStreetPolygon, intersectStreetPolygons, type StreetPolygon } from '../../src/objects/streetPolygon'

const root = process.env.SPINWARD_AUTHORING_ROOT ?? path.resolve(import.meta.dir, '../..')
if (!path.isAbsolute(root)) throw new Error('Authoring root must be an absolute path')
const assets = path.join(root, 'assets/blender')
const neighbourhoodName = process.env.SPINWARD_CITY_FABRIC === '1' ? 'izma-city-neighbourhoods.json' : 'izma-neighbourhood-parcels.json'
const outputName = process.env.SPINWARD_CITY_FABRIC === '1' ? 'izma-city-land-use-layout.json' : 'izma-land-use-layout.json'
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(assets, name), 'utf8'))
const master = read('izma-colony-plan.json'), infill = read(neighbourhoodName)
const primary = read('izma-parcels.json'), publicRealm = read('izma-public-spaces.json'), rail = read('izma-rail.json')
const urban = read('izma-urban-plan.json'), streets = read('izma-urban-streets.json')
const completeBlocks = read('izma-block-parcels.json')
const retired = new Set(completeBlocks.blocks.flatMap((b:any) => b.retiredParcels))
const spacing = Math.PI * 6400 / 3
type Point = [number, number]
const poly = (p: number[][]): StreetPolygon => positivePolygon(p.map(([x,y]) => ({ x,y,u:x,v:y })))
const rectangle = (x:number,y:number,yaw:number,w:number,d:number) => poly([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v]) =>
  [x+Math.cos(yaw)*u-Math.sin(yaw)*v,y+Math.sin(yaw)*u+Math.cos(yaw)*v]))
const corridor = (a:number[],b:number[],width:number) => rectangle((a[0]+b[0])/2,(a[1]+b[1])/2,Math.atan2(b[1]-a[1],b[0]-a[0]),Math.hypot(b[0]-a[0],b[1]-a[1]),width)
const bounds = (p:StreetPolygon) => [Math.min(...p.map(v=>v.x)),Math.min(...p.map(v=>v.y)),Math.max(...p.map(v=>v.x)),Math.max(...p.map(v=>v.y))]
const touches = (a:number[],b:number[]) => a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3]
const obstacles: { polygon:StreetPolygon; bounds:number[]; kind:string; route?:string }[] = []
const reserve = (polygon:StreetPolygon,kind:string,route?:string) => obstacles.push({polygon,bounds:bounds(polygon),kind,route})
for (const block of completeBlocks.blocks) for (const sector of block.sectors) reserve(poly(sector),'complete-block')
if (infill.cityFabric) for (const p of read('izma-corner-blocks.json').parcels) {
  reserve(poly(p.outline), 'retained-corner')
  reserve(corridor(p.entrance.start,p.entrance.end,p.entrance.width+.1), 'corner-entrance')
}
for (const p of [...primary.parcels,...infill.parcels]) {
  if(retired.has(p.id))continue
  reserve(p.lot ? poly(p.lot.polygon) : rectangle(...p.position,p.yaw,p.size[0]+1.5,p.size[1]+1.5),'parcel')
  reserve(corridor(p.access.start,p.access.end,3),'entrance')
}
for (const p of publicRealm.places) {
  reserve(rectangle(...p.position,p.yaw,p.size[0]+1,p.size[1]+1),'public')
  reserve(corridor(p.entry,p.threshold,5),'public-access')
}
for (const p of rail.stations) for(let i=1;i<p.approach.length;i++) reserve(corridor(p.approach[i-1],p.approach[i],5),'station-access')
reserve(rectangle(0,0,0,700,860),'study')
const nodes=new Map<string,any>(master.nodes.map((n:any)=>[n.id,n]))
const roads:{a:Point;b:Point;width:number;band:number;id:string}[]=[]
for(const r of master.routes)for(let i=1;i<r.nodes.length;i++){
 const a=nodes.get(r.nodes[i-1]),b=nodes.get(r.nodes[i]);if(a.band!==b.band)continue
 const aa:Point=[a.xy[0]+a.band*spacing,a.xy[1]],bb:Point=[b.xy[0]+b.band*spacing,b.xy[1]]
 reserve(corridor(aa,bb,r.width+5),'transport',r.id)
 if(['local','arterial'].includes(r.kind))roads.push({a:aa,b:bb,width:r.width,band:a.band,id:r.id})
}
for(const r of infill.streets)for(let i=1;i<r.points.length;i++){
 const a=r.points[i-1],b=r.points[i];reserve(corridor(a,b,r.width+.5),'back-street',r.id)
 roads.push({a,b,width:r.width,band:r.band,id:r.id})
}
for(let band=0;band<3;band++){
 const w=master.water[band]
 for(let i=1;i<w.reach.length;i++)reserve(corridor([w.reach[i-1][0]+band*spacing,w.reach[i-1][1]],[w.reach[i][0]+band*spacing,w.reach[i][1]],w.bankWidth*2+5),'water')
}
const hull=(points:number[][])=>{
 const sorted=points.map(p=>[...p]).sort((a,b)=>a[0]-b[0]||a[1]-b[1])
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 const half=(ps:number[][])=>{const out:number[][]=[];for(const p of ps){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,p)<=0)out.pop();out.push(p)}return out.slice(0,-1)}
 return poly([...half(sorted),...half([...sorted].reverse())])
}
const zones:any[]=[]
const add=(id:string,district:any,use:string,outline:StreetPolygon)=>{
 const box=bounds(outline);let pieces=[outline]
 for(const o of obstacles)if(touches(box,o.bounds))pieces=pieces.flatMap(p=>subtractStreetPolygon(p,o.polygon))
 pieces=pieces.filter(p=>polygonArea(p)>.5)
 if(pieces.reduce((s,p)=>s+polygonArea(p),0)<80)return
 zones.push({id,district:district.id,band:district.band,use,outline:outline.map(p=>[p.x,p.y]),pieces:pieces.map(p=>p.map(v=>[v.x,v.y])),area:pieces.reduce((s,p)=>s+polygonArea(p),0)})
 reserve(outline,'assigned-land')
}
for(const s of infill.streets.filter((s:any)=>s.connections.length>1&&s.points.length>2)){
 const d=master.districts.find((d:any)=>d.id===s.district)
 add('court-'+s.id,d,s.character==='works'?'service-yard':s.character==='lanes'?'rear-gardens':'shared-garden',hull(s.points))
}
for(const d of master.districts){
 const region=streets.districts.find((r:any)=>r.id===d.id),spec=urban.districts[d.id]
 const [sx,sy]=region.station,[cx,cy]=region.centre,angle=Math.atan2(cy-sy,cx-sx)
 const length=Math.hypot(cx-sx,cy-sy),reach=region.reach
 // Reserve a visibly defined fringe beyond the back streets. Rural land uses
 // have larger, deliberately aligned parcels rather than an urban density.
 const rural=spec.character==='groves',extent=rural?260:Math.min(reach,340)
 const use=d.id==='c-fields'?'allotments':d.id==='c-orchards'?'orchard':d.id==='c-forest'?'woodland':spec.character==='works'?'service-yard':spec.character==='lanes'?'rear-gardens':'shared-garden'
 for(const side of [-1,1]){
  const along=Math.min(length*.6,reach*.75),offset=side*(rural?135:100),x=sx+Math.cos(angle)*along-Math.sin(angle)*offset,y=sy+Math.sin(angle)*along+Math.cos(angle)*offset
  const outline=rectangle(x,y,angle,extent,rural?180:130)
  if(outline.some(p=>p.y<=d.axial[0]||p.y>=d.axial[1]||Math.abs(p.x-d.band*spacing)>Math.PI*3200/6-master.edgeReserve))continue
  add('land-'+d.id+'-'+(side<0?'left':'right'),d,use,outline)
 }
}
const inputs=['izma-colony-plan.json','izma-parcels.json',neighbourhoodName,'izma-public-spaces.json','izma-rail.json','izma-urban-plan.json','izma-urban-streets.json','izma-block-parcels.json']
if (infill.cityFabric) inputs.push('izma-corner-blocks.json')
for(const z of zones){
 const candidates:any[]=[]
 for(const piece of [...z.pieces].sort((a,b)=>polygonArea(poly(b))-polygonArea(poly(a))).slice(0,12)){
  const centre:Point=[piece.reduce((s:number,p:number[])=>s+p[0],0)/piece.length,piece.reduce((s:number,p:number[])=>s+p[1],0)/piece.length]
  for(const r of roads.filter(r=>r.band===z.band)){
   const dx=r.b[0]-r.a[0],dy=r.b[1]-r.a[1],t=Math.max(0,Math.min(1,((centre[0]-r.a[0])*dx+(centre[1]-r.a[1])*dy)/(dx*dx+dy*dy)))
   const q:Point=[r.a[0]+dx*t,r.a[1]+dy*t],length=Math.hypot(centre[0]-q[0],centre[1]-q[1]),edge=r.width/2+(r.width>=10?2.1:0)
   if(length<edge+3||length>100)continue
   const start:Point=[q[0]+(centre[0]-q[0])*edge/length,q[1]+(centre[1]-q[1])*edge/length],shape=corridor(start,centre,2.6),box=bounds(shape)
   if(obstacles.some(o=>o.kind!=='assigned-land'&&o.route!==r.id&&touches(box,o.bounds)&&polygonArea(intersectStreetPolygons(shape,o.polygon))>.002))continue
   candidates.push({route:r.id,start,end:centre,width:2.4,length:length-edge})
  }
 }
 z.access=candidates.sort((a,b)=>a.length-b.length)[0]??null
 // A shared garden needs routes through its interior. Join visible centres
 // across the union of its free pieces; never cut across a reserved lot.
 z.walks=[]
 if(z.access && !['service-yard','allotments'].includes(z.use)){
  const pieces=z.pieces.map(poly),candidates:Point[]=[z.access.end,...[...pieces].sort((a,b)=>polygonArea(b)-polygonArea(a)).slice(0,18).map(p=>[p.reduce((s,v)=>s+v.x,0)/p.length,p.reduce((s,v)=>s+v.y,0)/p.length] as Point)]
  const centres=[...new Map(candidates.map(p=>[p.map(v=>v.toFixed(4)).join(':'),p])).values()]
  const reached=new Set([0]),available=new Set(centres.map((_,i)=>i).slice(1))
  while(available.size){
   const edges=[...reached].flatMap(a=>[...available].map(b=>({a,b,length:Math.hypot(centres[a][0]-centres[b][0],centres[a][1]-centres[b][1])}))).filter(e=>e.length>4&&e.length<160).sort((a,b)=>a.length-b.length)
   const edge=edges.find(e=>{
    const walk=corridor(centres[e.a],centres[e.b],2.4),box=bounds(walk),covered=pieces.reduce((s,p)=>s+(touches(box,bounds(p))?polygonArea(intersectStreetPolygons(walk,p)):0),0)
    return covered>polygonArea(walk)-.005
   })
   if(!edge)break
   z.walks.push([centres[edge.a],centres[edge.b]]);reached.add(edge.b);available.delete(edge.b)
  }
 }
}
const dependencies=Object.fromEntries(inputs.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]))
fs.writeFileSync(path.join(assets,outputName),JSON.stringify({origin:'ai',created:'2026-09-19',version:1,dependencies,zones},null,2)+'\n')
console.log(JSON.stringify({zones:zones.length,area:zones.reduce((s,z)=>s+z.area,0),districts:[...new Set(zones.map(z=>z.district))],uses:Object.fromEntries([...new Set(zones.map(z=>z.use))].map(use=>[use,zones.filter(z=>z.use===use).length]))},null,2))
