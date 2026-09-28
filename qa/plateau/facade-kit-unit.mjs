import assert from 'node:assert/strict'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
import * as T from 'three'
import {composeFacades,PALETTE} from './facade-rules.js'
import {nativePartVertex,FacadeInstances} from './facade-instances.js'
import {WalkWorld} from './walking.js'

const root=fileURLToPath(new URL('../webxr/evidence/plateau-transfer-20260922/',import.meta.url)),dir=root+'derived/'
const json=path=>JSON.parse(fs.readFileSync(dir+path)),kit=json('facade-kit.json'),manifest=json('facade-sites.json'),sites=manifest.sites.map(s=>json(s.path)),study=json('study.json')
const station=composeFacades(sites[0].buildings),east=composeFacades(sites[1].buildings)
assert.equal(station.buildings.length,22);assert.equal(east.buildings.length,44)
assert.equal(station.parts.filter(p=>p.kind==='window').length,1065);assert.equal(station.parts.filter(p=>p.kind==='door').length,22)
assert.equal(new Set([...station.buildings,...east.buildings].map(b=>b.id)).size,66)

// Compare all expanded prototype corners with the previously accepted Blender export.
// This catches reversed normals/axes, wrong offsets, frame scaling, room colour changes,
// and repeated/suppressed windows independently of the newly ported recipe.
const expanded=new Map()
for(const p of station.parts){
  const k=kit.parts[p.kind]
  for(let start=0;start<k.positions.length;start+=24){
    const unique=new Map(),role=k.roles[start],c=role===1?PALETTE.frame:role===2?PALETTE.sill:p.colour
    for(let i=start;i<start+24;i++){const v=nativePartVertex(p,k.positions[i],k.stretch[i]);unique.set(v.join(','),v)}
    assert.equal(unique.size,8);if(!expanded.has(c))expanded.set(c,[]);expanded.get(c).push(...unique.values())
    // Check each box face normal points outward after parametric resizing.
    const centre=new T.Vector3();for(const v of unique.values())centre.add(new T.Vector3(...v));centre.multiplyScalar(1/8)
    for(let i=start;i<start+24;i+=4){const v=nativePartVertex(p,k.positions[i],k.stretch[i]),n=k.normals[i],normal=new T.Vector3(p.u[0]*n[0]-p.u[1]*n[1],p.u[1]*n[0]+p.u[0]*n[1],n[2]);assert.ok(new T.Vector3(...v).sub(centre).dot(normal)>0)}
  }
}
let comparedVertices=0,maxError=0
for(const m of json('tokyo/frontage.json').meshes.filter(m=>!m.name.match(/frontage-(plaster|brick|cladding)/))){
  const buffer=fs.readFileSync(dir+m.path+m.positions),old=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.length/4),actual=expanded.get(m.material)
  assert.equal(actual.length*3,old.length,m.name)
  // Spatial multiset, preserving duplicate corners from intersecting frame boxes.
  const grid=new Map(),key=v=>v.map(x=>Math.floor(x/.001)).join(',')
  for(const v of actual){const k=key(v);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(v)}
  for(let i=0;i<old.length;i+=3){const v=Array.from(old.slice(i,i+3)),cell=v.map(x=>Math.floor(x/.001));let found=null
    for(let x=-1;x<=1&&!found;x++)for(let y=-1;y<=1&&!found;y++)for(let z=-1;z<=1&&!found;z++){
      const bucket=grid.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));if(!bucket)continue
      const index=bucket.findIndex(a=>Math.hypot(...a.map((q,j)=>q-v[j]))<.0001)
      if(index>=0){found=bucket.splice(index,1)[0];maxError=Math.max(maxError,Math.hypot(...found.map((q,j)=>q-v[j])))}
    }
    assert.ok(found,`${m.name} unmatched corner ${v}`);comparedVertices++
  }
}
const world=new WalkWorld(json('tokyo/walk.json')),[a,b]=sites[1].arrival.route
let walker={...world.spawn(),x:a[0],y:a[1],h:world.ground(...a)},dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy)
for(let t=0;t<distance;t+=.10)walker=world.move(walker,dx/distance*Math.min(.10,distance-t),dy/distance*Math.min(.10,distance-t))
assert.equal(walker.rejected,0);assert.ok(Math.hypot(walker.x-b[0],walker.y-b[1])<.001)

const f=new FacadeInstances(kit,sites,study,study.samples[0]);f.group.updateWorldMatrix(true,true)
for(const c of f.chunks){
  const near=f.chunks.find(x=>x===c),origin=near.renderCentre.clone()
  const update=distance=>{f.updateLOD(origin.clone().add(new T.Vector3(distance+c.radius,0,0)));return c.level}
  assert.equal(update(90),'near');assert.equal(update(105),'near');assert.equal(update(120),'mid')
  assert.equal(update(105),'mid');assert.equal(update(90),'near');assert.equal(update(700),'far')
  assert.equal(update(610),'far');assert.equal(update(570),'mid')
}
const size=paths=>{const bs=paths.map(p=>fs.readFileSync(dir+p));return{rawBytes:bs.reduce((n,b)=>n+b.length,0),gzipBytes:bs.reduce((n,b)=>n+gzipSync(b).length,0)}}
const baked=json('tokyo/frontage.json').meshes.flatMap(m=>[m.path+m.positions,m.path+m.indices])
const report={origin:'ai',created:'2026-09-22',comparedVertices,maxCornerErrorM:maxError,station:{buildings:22,windows:1065,doors:22},east:{buildings:44,windows:east.parts.filter(p=>p.kind==='window').length,doors:east.parts.filter(p=>p.kind==='door').length,fullRouteM:distance},payload:{bakedStationIncludingDuplicateBodies:size(baked),bakedStationPartsOnly:size(baked.filter(p=>!p.match(/frontage-(plaster|brick|cladding)/))),sharedKitAndStationRecipe:size(['facade-kit.json',manifest.sites[0].path,'facade-sites.json']),additionalEastRecipe:size([manifest.sites[1].path])},prototypeVertices:f.diagnostics().prototypeVertices}
fs.writeFileSync(root+'kit-geometry-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
