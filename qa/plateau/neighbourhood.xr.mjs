import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'
import * as T from 'three'
function watch(page){const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));return{errors,requests}}
async function ready(page,url='/?world=colony&walk=1'){
 await page.goto(url);await page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady)
 const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'});expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
async function probe(page,eyeHeight=1.65){
 const p=await page.evaluate(()=>{const w=window.__plateau,s=w.walk,world=w.walkWorlds.get(w.state.selected),cam=w.renderer.xr.isPresenting?w.renderer.xr.getCamera():w.camera
  return{walk:s,region:w.state.selected,eye:cam.getWorldPosition(cam.position.clone()).toArray(),ground:world.ground(s.x,s.y),blocked:world.blocked(s.x,s.y),collision:world.diagnostics(),base:[...w.baseTiles].map(([id,b])=>({id,...b.diagnostics()})),facades:w.streams.get('tokyo').diagnostics(),memory:w.renderer.info.memory,draw:w.renderer.info.render,
   floors:w.visibleMeshes(w.state.selected,['terrain','roads','footways','park-path']).filter(m=>m.userData.level==='near').map(m=>({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array.slice(0,Math.min(m.geometry.drawRange.count,m.geometry.index.count)))}))}
 })
 expect(p.blocked).toBe(false);expect(p.walk.h).toBeCloseTo(p.ground,5)
 const eye=new T.Vector3(...p.eye),up=new T.Vector3(-eye.x,-eye.y,0).normalize(),ray=new T.Raycaster(eye,up.negate(),0,4),hits=[]
 for(const f of p.floors){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(f.p,3));g.setIndex(f.i);const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));hits.push(...ray.intersectObject(m));g.dispose();m.material.dispose()}
 expect(hits.length).toBeGreaterThan(0);p.contactErrorM=Math.abs(Math.min(...hits.map(h=>h.distance))-eyeHeight);expect(p.contactErrorM).toBeLessThan(.05);delete p.floors
 expect(p.collision.decodedBytes).toBeLessThanOrEqual(4*1024*1024);expect(p.collision.resident.length).toBeLessThanOrEqual(16)
 for(const b of p.base){expect(b.nearDecodedBytes).toBeLessThanOrEqual(12*1024*1024);expect(b.far.decodedBytes).toBeLessThanOrEqual(48*1024*1024)}return p
}
test('neighbourhood: complete exploration with streamed collision and visible landmarks',async({page},info)=>{
 test.setTimeout(240000);const seen=watch(page),gpu=await ready(page),probes=[]
 const route=await page.evaluate(()=>window.__plateau.exploration);expect(route.length).toBeGreaterThan(2000);expect(route.length).toBeLessThan(3000)
 // Accelerated traversal calls the same capped/sub-stepped player movement. Each
 // asynchronous stream must catch up; the unit oracle separately covers every 10cm.
 const walk=await page.evaluate(async()=>{
  const w=window.__plateau,points=w.exploration.points;let steps=0,waits=0,maxStepError=0;const times=[];let last=performance.now()
  for(const target of points.slice(1)){
   let attempts=0
   while(Math.hypot(target[0]-w.walk.x,target[1]-w.walk.y)>.001){
    if(++attempts>1000)throw Error('Exploration stalled')
    await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now
    const dx=target[0]-w.walk.x,dy=target[1]-w.walk.y,d=Math.hypot(dx,dy),length=Math.min(4,d),before={...w.walk},after=w.advanceWalk(dx/d*length,dy/d*length)
    if(w.walkWorlds.get('tokyo').waiting){waits++;continue}
    const error=Math.abs(Math.hypot(after.x-before.x,after.y-before.y)-length);maxStepError=Math.max(maxStepError,error);if(error>.001||after.rejected)throw Error('Blocked route');steps++
   }
  }
  return{steps,waits,maxStepError,times,collision:w.walkWorlds.get('tokyo').diagnostics(),base:w.baseTiles.get('tokyo').diagnostics()}
 })
 expect(walk.collision.evictions).toBeGreaterThan(5);expect(walk.base.far.evictions).toBeGreaterThan(0)
 for(const stop of route.stops){await page.selectOption('#landmark',stop.id);await page.waitForFunction(()=>window.__plateau.detailsReady);probes.push(await probe(page));await page.screenshot({path:info.outputPath(stop.id+'.png')})}
 await page.selectOption('#landmark','arrival');await page.waitForFunction(()=>window.__plateau.detailsReady);const before=await probe(page)
 await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>16,[before.walk.x,before.walk.y],{timeout:15000});await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');probes.push(await probe(page))
 await page.mouse.move(1100,600);await page.mouse.down();await page.mouse.move(1100,240,{steps:8});await page.mouse.up();await page.waitForFunction(()=>window.__plateau.detailsReady);await page.screenshot({path:info.outputPath('overhead.png')})
 const overhead=await page.evaluate(()=>{const w=window.__plateau;return ['tama','azumino'].map(id=>({id,buildings:w.visibleMeshes(id,['buildings']).length,far:w.baseTiles.get(id).farStream.diagnostics()}))});expect(overhead.some(v=>v.buildings>0)).toBe(true)
 expect(seen.requests.filter(p=>p.endsWith('/walk.json')||p.endsWith('.positions.bin')||p.endsWith('.indices.bin'))).toEqual([]);expect(seen.errors).toEqual([])
 await fs.writeFile(info.outputPath('exploration.json'),JSON.stringify({gpu,walk,probes,overhead,requests:seen.requests,errors:seen.errors},null,2))
})
test('neighbourhood: missing collision stops movement and retry restores it',async({page},info)=>{
 const seen=watch(page);await page.route('**/walk-tiles/tokyo-7-7.json.gz',r=>r.fulfill({status:503,body:'offline'}))
 await page.goto('/?world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.rendered)
 await page.waitForFunction(()=>{const e=window.__plateau.walkWorlds.get('tokyo').entries.get('7-7');return e.status==='failed'&&e.attempts===3})
 const before=await page.evaluate(()=>({...window.__plateau.walk}));await page.keyboard.down('KeyW');await page.waitForTimeout(400);await page.keyboard.up('KeyW');const after=await page.evaluate(()=>({...window.__plateau.walk}));expect(after.x).toBe(before.x);expect(after.y).toBe(before.y);expect(Number.isFinite(after.h)).toBe(true)
 await expect(page.locator('#detail-status')).toContainText('移動を一時停止');await page.screenshot({path:info.outputPath('collision-failure.png')})
 await page.unroute('**/walk-tiles/tokyo-7-7.json.gz');await page.click('#retry-details');await page.waitForFunction(()=>window.__plateau.detailsReady);await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.__plateau.walk.x>.5);await page.keyboard.up('KeyW');const restored=await probe(page);expect(seen.errors).toEqual([])
 await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({before,after,restored,errors:seen.errors},null,2))
})
test('neighbourhood: mobile park and residential exploration',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});const seen=watch(page),gpu=await ready(page,'/?world=colony&stop=park&walk=1');const before=await probe(page);await page.screenshot({path:info.outputPath('park-mobile.png')})
 await page.selectOption('#landmark','residential');await page.waitForFunction(()=>window.__plateau.detailsReady);await page.locator('[aria-label="前へ"]').dispatchEvent('pointerdown',{pointerId:1});await page.waitForTimeout(700);await page.locator('[aria-label="前へ"]').dispatchEvent('pointerup',{pointerId:1});await page.screenshot({path:info.outputPath('residential-mobile.png')});expect(seen.errors).toEqual([]);await fs.writeFile(info.outputPath('mobile.json'),JSON.stringify({gpu,before,after:await probe(page),errors:seen.errors},null,2))
})
test.describe('neighbourhood stereo',()=>{
 test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
 test('neighbourhood: VR head, walking and wrist travel across the three walls',async({page,xr},info)=>{
  const seen=watch(page),gpu=await ready(page),probes=[];await xr.enterVR();await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(5)
  for(const id of ['tokyo','tama','azumino']){
   if(id!=='tokyo'){
    await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]});await xr.waitForFrames(4)
    const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),id),origin=[.2,1.35,-.15];await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(3);expect(await page.evaluate(()=>window.__plateau.wrist.hover)).toBe(id)
    await xr.screenshot(info.outputPath('wrist-'+id+'.png'),{canvas:'canvas',metadata:true});await xr.pressButton('right','trigger');await xr.waitForFrames(5)
   }
   await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(4);await page.waitForFunction(()=>window.__plateau.detailsReady);const before=await probe(page,1.685)
   await xr.setAxes('left',0,-.8);await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>2,[before.walk.x,before.walk.y],{timeout:10000});await xr.setAxes('left',0,0);await xr.waitForFrames(4);const after=await probe(page,1.685);expect(after.walk.rejected).toBe(0);probes.push({before,after});await xr.screenshot(info.outputPath(id+'-stereo.png'),{canvas:'canvas',metadata:true})
  }
  const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0');await xr.endSession();expect(seen.errors).toEqual([]);await fs.writeFile(info.outputPath('vr.json'),JSON.stringify({gpu,probes,diagnostic,errors:seen.errors},null,2))
 })
})

test('neighbourhood: far failure recovery and repeated residency release',async({page},info)=>{
 test.setTimeout(120000);const seen=watch(page);await page.route('**/base-tiles/tokyo-far-3-2.bin.gz',r=>r.fulfill({status:503,body:'offline'}));await page.goto('/?world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.rendered)
 await page.waitForFunction(()=>{const e=window.__plateau.baseTiles.get('tokyo').farStream.entries.get('3-2');return e.status==='failed'&&e.attempts===3})
 await expect(page.locator('#detail-status')).toContainText('遠景');const fallback=await probe(page)
 await page.unroute('**/base-tiles/tokyo-far-3-2.bin.gz');await page.click('#retry-details');await page.waitForFunction(()=>window.__plateau.detailsReady);const snapshots=[]
 for(let i=0;i<4;i++)for(const id of ['tama','tokyo']){
  await page.locator(`[data-region=${id}]`).click();await page.waitForFunction(()=>window.__plateau.detailsReady);await page.waitForTimeout(3300);await page.waitForFunction(()=>window.__plateau.detailsReady)
  snapshots.push(await page.evaluate(()=>{const w=window.__plateau;return{region:w.state.selected,gpu:w.renderer.info.memory.geometries,walk:[...w.walkWorlds].map(([id,b])=>({id,...b.diagnostics()})),base:[...w.baseTiles].map(([id,b])=>({id,...b.diagnostics()})),facade:w.streams.get('tokyo').diagnostics()}}))
 }
 for(const id of ['tama','tokyo']){const values=snapshots.filter(v=>v.region===id).slice(1).map(v=>v.gpu);expect(Math.max(...values)-Math.min(...values)).toBeLessThanOrEqual(1)}
 for(const v of snapshots){for(const w of v.walk.filter(b=>b.id!==v.region))expect(w.decodedBytes).toBe(0);if(v.region==='tama')expect(v.facade.recipeBytes).toBe(0)}
 expect(seen.errors).toEqual([]);await fs.writeFile(info.outputPath('far-recovery.json'),JSON.stringify({fallback,snapshots,errors:seen.errors},null,2))
})
