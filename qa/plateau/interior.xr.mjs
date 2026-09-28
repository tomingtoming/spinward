import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'
import * as T from 'three'

function watch(page){const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>requests.push(new URL(r.url()).pathname));return{errors,requests}}
async function ready(page,url='/'){
 await page.goto(url);await page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady)
 const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'});expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
async function contact(page,eyeHeight=1.65){
 const p=await page.evaluate(()=>{
  const w=window.__plateau,s=w.walk,world=w.walkWorlds.get(w.state.selected),cam=w.renderer.xr.isPresenting?w.renderer.xr.getCamera():w.camera
  return{state:s,region:w.state.selected,mode:w.state.mode,camera:cam.getWorldPosition(cam.position.clone()).toArray(),radius:w.study.radius,ground:world.ground(s.x,s.y),blocked:world.blocked(s.x,s.y),
   floors:w.visibleMeshes(w.state.selected,['terrain','roads','footways']).map(m=>({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array.slice(0,Math.min(m.geometry.drawRange.count,m.geometry.index.count)))}))}
 })
 expect(p.mode).toBe('colony');expect(p.blocked).toBe(false);expect(p.state.h).toBeCloseTo(p.ground,5)
 const eye=new T.Vector3(...p.camera),up=new T.Vector3(-eye.x,-eye.y,0).normalize()
 expect(p.radius-Math.hypot(eye.x,eye.y)-p.state.h).toBeCloseTo(eyeHeight,2)
 const ray=new T.Raycaster(eye.clone().addScaledVector(up,5),up.negate(),0,10),hits=[]
 for(const f of p.floors){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(f.p,3));g.setIndex(f.i);const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));hits.push(...ray.intersectObject(m));g.dispose();m.material.dispose()}
 expect(hits.length).toBeGreaterThan(0);p.contactErrorM=Math.abs(Math.min(...hits.map(h=>h.distance))-(5+eyeHeight));expect(p.contactErrorM).toBeLessThan(.04);delete p.floors;return p
}

test('streaming: distant start, bounded residency and repeatable GPU release',async({page},info)=>{
 const seen=watch(page),gpu=await ready(page);expect(seen.requests.filter(p=>p.includes('/facade-site-'))).toEqual([])
 // Warm the fixed base geometry before measuring incremental facade residency.
 for(const id of ['tama','azumino','tokyo'])await page.locator(`[data-region=${id}]`).click()
 await page.locator('#walk').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
 const snapshots=[]
 for(let i=0;i<5;i++){
  await page.locator('[data-region=tama]').click();await page.waitForFunction(()=>window.__plateau.streams.get('tokyo').diagnostics().resident.length===0&&window.__plateau.detailsReady)
  snapshots.push(await page.evaluate(()=>({phase:'away',gpu:window.__plateau.renderer.info.memory.geometries,stream:window.__plateau.streams.get('tokyo').diagnostics(),meshes:window.__plateau.facades.get('tokyo').group.children.length})))
  await page.locator('[data-region=tokyo]').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
  snapshots.push(await page.evaluate(()=>({phase:'back',gpu:window.__plateau.renderer.info.memory.geometries,stream:window.__plateau.streams.get('tokyo').diagnostics(),buildings:window.__plateau.facades.get('tokyo').design.buildings.length})))
 }
 for(const s of snapshots.filter(s=>s.phase==='away')){expect(s.stream.recipeBytes).toBe(0);expect(s.meshes).toBe(0)}
 for(const s of snapshots.filter(s=>s.phase==='back'))expect(s.buildings).toBe(66)
 const away=snapshots.filter(s=>s.phase==='away').map(s=>s.gpu),back=snapshots.filter(s=>s.phase==='back').map(s=>s.gpu)
 expect(Math.max(...away)-Math.min(...away)).toBeLessThanOrEqual(1);expect(Math.max(...back.slice(1))-Math.min(...back.slice(1))).toBeLessThanOrEqual(1)
 await page.screenshot({path:info.outputPath('reloaded.png')});expect(seen.errors).toEqual([])
 await fs.writeFile(info.outputPath('streaming.json'),JSON.stringify({gpu,snapshots,requests:seen.requests.filter(p=>p.includes('/facade-site-')),errors:seen.errors},null,2))
})

test('inside three bands: PC contact, native walking, overhead view and local return',async({page},info)=>{
 const seen=watch(page),gpu=await ready(page,'/?region=tokyo&site=east&world=colony&walk=1'),probes=[]
 for(const id of ['tokyo','tama','azumino']){
  await page.locator(`[data-region=${id}]`).click();await page.waitForFunction(()=>window.__plateau.detailsReady)
  const before=await contact(page);await page.screenshot({path:info.outputPath(`${id}-arrival.png`)})
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft')
  await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>=12,[before.state.x,before.state.y],{timeout:20000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');const after=await contact(page);expect(after.state.rejected).toBe(0);probes.push({before,after})
 }
 await page.locator('[data-region=tokyo]').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
 await page.mouse.move(1000,600);await page.mouse.down();await page.mouse.move(1000,260,{steps:8});await page.mouse.up()
 await page.screenshot({path:info.outputPath('overhead.png')})
 const otherInView=await page.evaluate(()=>{const w=window.__plateau;return w.groups.slice(1).map(g=>{let visible=0;for(const m of w.visibleMeshes(g.name,['buildings'])){const a=m.geometry.attributes.position,idx=m.geometry.index;for(let j=0;j<Math.min(idx.count,m.geometry.drawRange.count);j+=3){const p=w.camera.position.clone().fromBufferAttribute(a,idx.array[j]).project(w.camera);if(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1&&p.z>0)visible++}}return{region:g.name,verticesInView:visible}})})
 expect(otherInView.some(r=>r.verticesInView>100)).toBe(true)
 await page.locator('#interior').click();expect(await page.evaluate(()=>window.__plateau.state.mode)).toBe('curved')
 await page.locator('#walk').click();expect(await page.evaluate(()=>window.__plateau.walk.active)).toBe(false)
 expect(seen.errors).toEqual([]);await fs.writeFile(info.outputPath('interior.json'),JSON.stringify({gpu,probes,otherInView,errors:seen.errors},null,2))
})

test('stream failure: base buildings and walking survive, revisiting recovers',async({page},info)=>{
 const seen=watch(page)
 await page.route('**/facade-site-east.json',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}))
 await page.goto('/?region=tokyo&site=east&world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.rendered)
 await page.waitForFunction(()=>{const e=window.__plateau.streams.get('tokyo').entries.get('east');return e.status==='failed'&&e.attempts===3})
 await expect(page.locator('#detail-status')).toContainText('建物と道路は引き続き表示')
 const before=await contact(page)
 const body=await page.evaluate(()=>{const meshes=window.__plateau.visibleMeshes('tokyo',['buildings']);return{visible:meshes.length>0,indices:meshes.reduce((n,g)=>n+Math.min(g.geometry.drawRange.count,g.geometry.index.count),0),colours:Array.from(meshes[0].geometry.attributes.color.array.slice(0,30))}})
 expect(body.visible).toBe(true);expect(body.indices).toBeGreaterThan(100000)
 await page.keyboard.down('KeyW');await page.waitForFunction(x=>window.__plateau.walk.x>x+.5,before.state.x);await page.keyboard.up('KeyW');await contact(page)
 await page.screenshot({path:info.outputPath('fallback.png')})
 await page.unroute('**/facade-site-east.json');await page.locator('[data-region=tama]').click();await page.locator('[data-region=tokyo]').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
 await expect(page.locator('#detail-status')).toBeEmpty()
 expect(await page.evaluate(()=>window.__plateau.facades.get('tokyo').design.buildings.length)).toBe(66)
 await page.screenshot({path:info.outputPath('recovered.png')})
 expect(seen.errors.filter(e=>!e.includes('503'))).toEqual([])
 await fs.writeFile(info.outputPath('fallback.json'),JSON.stringify({attempts:3,bodySurvived:body.visible,walked:true,recoveredBuildings:66,intentionalHttpErrors:seen.errors},null,2))
})

test.describe('interior stereo',()=>{
 test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
 test('walk and wrist transport retain gravity on each of the three walls',async({page,xr},info)=>{
  const seen=watch(page),gpu=await ready(page,'/?region=tokyo&world=colony&walk=1'),probes=[],captures=[]
  await xr.enterVR();await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(5)
  for(const id of ['tokyo','tama','azumino']){
   if(id!=='tokyo'){
    await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]});await xr.waitForFrames(4)
    const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),id),origin=[.2,1.35,-.15]
    await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(3);expect(await page.evaluate(()=>window.__plateau.wrist.hover)).toBe(id)
    captures.push(await xr.screenshot(info.outputPath(`wrist-${id}.png`),{canvas:'canvas',metadata:true}));await xr.pressButton('right','trigger');await xr.waitForFrames(5)
    expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe(id)
   }
   await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(4);await page.waitForFunction(()=>window.__plateau.detailsReady);const before=await contact(page,1.685)
   await xr.setAxes('left',0,-.8);await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>2,[before.state.x,before.state.y],{timeout:10000});await xr.setAxes('left',0,0);await xr.waitForFrames(4)
   const after=await contact(page,1.685);expect(after.state.rejected).toBe(0)
   const dx=after.state.x-before.state.x,dy=after.state.y-before.state.y
   expect((dx*-Math.sin(before.state.yaw)+dy*Math.cos(before.state.yaw))/Math.hypot(dx,dy),'stick forward follows the head and local gravity frame').toBeGreaterThan(.995)
   const residency=await page.evaluate(()=>{const w=window.__plateau,f=w.facades.get('tokyo');return{tracking:w.tracking,stream:w.streams.get('tokyo').diagnostics(),visibleWindows:f.group.children.filter(m=>m.visible&&m.name.endsWith('-window')).reduce((n,m)=>n+m.count,0)}})
   expect(Math.hypot(...residency.tracking.eyeWorld.map((v,i)=>v-after.camera[i]))).toBeLessThan(.10)
   if(id==='tokyo'){expect(residency.stream.resident.sort()).toEqual(['east','station']);expect(residency.visibleWindows).toBeGreaterThan(100)}
   probes.push({before,after,residency});captures.push(await xr.screenshot(info.outputPath(`${id}-stereo.png`),{canvas:'canvas',metadata:true}))
  }
  await xr.setHeadPose({position:[0,1.65,0],euler:[.9,0,.25]});await xr.waitForFrames(4);captures.push(await xr.screenshot(info.outputPath('up-roll-stereo.png'),{canvas:'canvas',metadata:true}))
  const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0');await xr.endSession();expect(seen.errors).toEqual([])
  await fs.writeFile(info.outputPath('xr-interior.json'),JSON.stringify({gpu,probes,diagnostic,captures,errors:seen.errors},null,2))
 })
})
