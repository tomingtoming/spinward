// Exercise the actual band collision data, seams and navigation paths without
// a browser. Render/contact and UI checks remain separate GPU/XR gates.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {WalkStream} from './walk-stream.js'
import {BandWorld,TerrainTriangles} from './band-landscape.js'

const root=path.resolve(process.argv[2]),read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),study=read('study.json'),report=[]
const binary=(p,Type)=>{const b=fs.readFileSync(path.join(root,p));return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))}
for(const sample of study.samples){
  if(process.argv[3]&&sample.id!==process.argv[3])continue
  const data=read(sample.bandLandscape),mesh=data.meshes.find(m=>m.name==='band-terrain'),p=binary(mesh.path+mesh.positions,Float32Array),index=binary(mesh.path+mesh.indices,Uint32Array)
  const terrain=new TerrainTriangles(p,index),manifest=read(sample.walkTiles),core=new WalkStream(manifest,{fetchTile:async tile=>JSON.parse(gunzipSync(fs.readFileSync(path.join(root,tile.path))))}),world=new BandWorld(core,data,terrain)
  const [cx,cy]=sample.anchor.local,b=data.bounds
  assert(Math.abs(b[1]+cy+20000)<1e-6&&Math.abs(b[3]+cy-20000)<1e-6)
  assert(Math.abs(b[2]-b[0]-study.bandWidth)<1e-6)
  let maxStepAt=null;let area=0,maxSpanX=0,maxStep=0,totalMetres=0,steps=0,maxResident=0,maxBytes=0,seamChecks=0
  for(let i=0;i<index.length;i+=3){const a=index[i]*3,j=index[i+1]*3,k=index[i+2]*3;area+=Math.abs((p[j]-p[a])*(p[k+1]-p[a+1])-(p[j+1]-p[a+1])*(p[k]-p[a]))/2;maxSpanX=Math.max(maxSpanX,Math.max(p[a],p[j],p[k])-Math.min(p[a],p[j],p[k]))}
  const c=data.sourceBounds,expected=study.bandWidth*40000-(c[2]-c[0])*(c[3]-c[1]);assert(Math.abs(area-expected)<100,'Incomplete or overlapping outer terrain')
  assert(maxSpanX<=20.01,'Cylinder chord would exceed the walking contact budget')
  async function ready(x,y){world.update(x,y,{force:true,now:performance.now()});let attempts=0;while(!world.readyAt(x,y)){await new Promise(r=>setTimeout(r,1));assert(attempts++<1000,'Collision did not become ready')}
    const stats=world.diagnostics();maxResident=Math.max(maxResident,stats.resident.length);maxBytes=Math.max(maxBytes,stats.decodedBytes);assert(maxResident<=16&&maxBytes<=4*1024*1024)}
  for(const x of [c[0],c[2]])for(let y=c[1]+1;y<c[3];y+=23){await ready(x,y);const inside=core.terrain(x,y),outside=terrain.height(x+(x===c[0]?-.001:.001),y);assert(Number.isFinite(outside));assert(Math.abs(inside-outside)<.02,`${sample.id} side seam ${x},${y}: ${inside-outside}`);seamChecks++}
  for(const y of [c[1],c[3]])for(let x=c[0]+1;x<c[2];x+=23){await ready(x,y);const inside=core.terrain(x,y),outside=terrain.height(x,y+(y===c[1]?-.001:.001));assert(Number.isFinite(outside));assert(Math.abs(inside-outside)<.02,`${sample.id} end seam ${x},${y}: ${inside-outside}`);seamChecks++}
  const nav=read(sample.navigation)
  for(const stop of nav.destinations){await ready(...stop.point);assert(!world.blocked(...stop.point),`Blocked arrival ${sample.id}/${stop.id}`);assert(Math.abs(world.ground(...stop.point)-stop.ground)<.025,`Bad arrival height ${sample.id}/${stop.id}`)}
  const plan=JSON.parse(fs.readFileSync(path.join(root,'..',sample.id+'-band-routes.json')))
  const routes=[...plan.routes,...plan.connectors.map(v=>v.points),...data.routes.map(v=>v.points)]
  for(const route of routes){if(route.length<2)continue;await ready(...route[0]);let state={x:route[0][0],y:route[0][1],h:world.ground(...route[0]),yaw:0,pitch:0,rejected:0}
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(distance/.65));totalMetres+=distance
      for(let j=1;j<=count;j++){
        const x=a[0]+(b[0]-a[0])*j/count,y=a[1]+(b[1]-a[1])*j/count
        if(steps%40===0||!world.readyAt(x,y))await ready(x,y)
        const next=world.move(state,x-state.x,y-state.y);if(Math.abs(next.h-state.h)>maxStep){maxStep=Math.abs(next.h-state.h);maxStepAt={x,y,fromHeight:state.h,toHeight:next.h,dx:x-state.x,dy:y-state.y}};steps++
        assert(Math.hypot(next.x-x,next.y-y)<.003,`${sample.id} route ${i}/${j} blocked at ${x},${y}, ground ${next.h}`);assert(Number.isFinite(next.h));state=next
      }
    }
  }
  world.update(0,40000,{force:true});assert.equal(world.diagnostics().resident.length,0,'Core remains resident far outside city')
  report.push({id:sample.id,sourceBuildings:sample.buildingCount,outerAreaKm2:area/1e6,terrainTriangles:index.length/3,maxSpanX,seamChecks,destinations:nav.destinations.length,steps,walkedMetres:totalMetres,maxStep,maxStepAt,maxResident,maxBytes});world.dispose();console.log(report.at(-1))
}
fs.writeFileSync(path.join(root,'../bands-unit'+(process.argv[3]?'-'+process.argv[3]:'')+'.json'),JSON.stringify({passed:true,regions:report},null,2))
