import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
const left={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()},right=[.22,1.38,-.2]
async function press(page,xr,id){
 const p=await page.evaluate(id=>{const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id);if(!b)throw Error('Missing '+id);const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return{u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}},id)
 const matrix=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel)),target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(matrix).toArray()
 await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)});await xr.waitForFrames(2,{timeout:5000})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id);await xr.pressButton('right','trigger')
}
import {signalPose} from '../neighborhood-life/signal-views.mjs'
import {nativeDistrictViews} from '../neighborhood-life/native-district-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
for(const viewName of ['arrival-core-crossing','arrival-local-west','arrival-local-south','spine','t-approach','corridor-seam','park-walk','settlement-walk','settlement-boundary','arrival-street','arrival-north-street','arrival-south-street','arrival-core-frontage','arrival-core-park','arrival-seam-walk','arrival-east-cafe','arrival-east-apartment','arrival-east-shops'])test(`native district ${viewName} remains connected while walking and using the wrist in stereo`,async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank');const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(nativeDistrictViews.find(v=>v.name===viewName))}`)
 await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 const state=()=>page.evaluate(()=>{
  const city=window.__spinwardCity,p=city.getCityPlan(),poses=city.getTrafficPositions(),routes=city.trafficRoutes
  return{azimuth:window.__spinward.azimuth,axial:window.__spinward.axial,ground:window.__spinward.groundHeight,mode:window.__spinward.mode,
   districts:p.nativeDistricts.map(d=>({id:d.id,centres:d.centres,buildings:d.buildings.length,axial:d.axial,length:d.length,growth:d.growth,localLinks:d.localLinks,infill:d.infill?{buildings:d.infill.buildings,parcels:d.infill.land.reduce((n,l)=>n+l.parcels.length,0)}:undefined,
    land:d.land?{blocks:d.land.blocks.length,parcels:d.land.parcels.length,built:d.buildings.filter(b=>!b.nativeParcel?.includes(':infill:')).map(b=>({id:b.nativeParcel,road:b.access?.roadId}))}:undefined})),
   junctions:p.streetMarkings.junctions.filter(j=>j.arms.some(a=>p.streetNetwork.streets[a.street].id.includes(':link-'))).map(j=>({node:j.node,arms:j.arms.length})),
   traffic:routes.flatMap((r,i)=>r.native?[{id:r.id,path:r.native.source.path.id,paths:r.native.sources.map(s=>s.path.id),...poses[i],onRoad:p.streetNetwork.query(poses[i].azimuth,poses[i].axial,0,0).some(s=>{
    const path=p.streetNetwork.streets[s.street],a=s.start,b=s.end,dx=b.x-a.x,dy=b.y-a.y,x=Math.atan2(Math.sin(poses[i].azimuth-path.azimuth),Math.cos(poses[i].azimuth-path.azimuth))*3200-a.x,y=poses[i].axial-path.axial-a.y
    const t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy)))
    return Math.hypot(x-t*dx,y-t*dy)<path.width/2-.4
   })}]:[]),
   walkers:window.__spinwardWalkers.group.userData,
   roadMatrices:window.__spinwardScene.getObjectsByProperty('isMesh',true).filter(m=>m.name.startsWith('street-surface-')).map(m=>({name:m.name,matrix:m.matrixWorld.elements,triangles:m.geometry.index.count/3}))}
 })
 await page.waitForFunction(view=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id.startsWith('native:')&&a.visible&&(view!=='t-approach'||a.id.includes(':link-0:'))),viewName)
 const before=await state();expect(before.districts).toHaveLength(16);expect(before.traffic.length).toBeGreaterThan(0);expect(before.walkers.people).toBeLessThanOrEqual(4)
 if(viewName==='arrival-core-crossing'){
  const topology=await page.evaluate(()=>{const p=window.__spinwardCity.getCityPlan(),m=p.streetMarkings,j=m.junctions.find(j=>j.arms.some(a=>p.streetNetwork.streets[a.street].id==='district-arrival-core:band-164'));return{civic:m.junctionCrossings(j).length,link:m.crossings(-50/3200,-17,80).filter(c=>c.source.id==='district-arrival-core:band-159').length}})
  expect(topology).toEqual({civic:4,link:2})
 }
 if(viewName.startsWith('arrival-')){
  const id=viewName.startsWith('arrival-east-')?'district-arrival-east':viewName.startsWith('arrival-core-')?'district-arrival-core':(viewName==='arrival-street'||viewName==='arrival-seam-walk'||viewName==='arrival-local-west')?'district-arrival-west':viewName==='arrival-north-street'?'district-arrival-north':'district-arrival-south'
  expect(before.districts.find(d=>d.id===id).land.built.length).toBeGreaterThan(id==='district-arrival-east'?0:20)
  const cars=before.traffic.filter(v=>v.paths.some(p=>p.startsWith(`${id}:`)))
  expect(cars.length).toBeGreaterThan(0);expect(cars.every(v=>v.onRoad)).toBe(true)
  expect(before.walkers.actors.some(a=>a.id.startsWith(`native:${id}:`)&&a.visible)).toBe(true)
  if(viewName.startsWith('arrival-local-')){
   expect(before.districts.flatMap(d=>d.localLinks??[])).toHaveLength(4)
   expect(before.districts.reduce((n,d)=>n+(d.infill?.buildings??0),0)).toBe(64)
   expect(before.districts.find(d=>d.id===id).infill.buildings).toBe(id==='district-arrival-west'?44:20)
   expect(before.districts.find(d=>d.id===id).localLinks).toHaveLength(2)
   expect(cars.some(v=>v.paths.some(p=>p.includes(':local-link-')))).toBe(true)
  }
 }
 const growth=before.districts.find(d=>d.growth).growth
 expect(growth.deferredLinks).toEqual([]);expect(growth.links.some(l=>l.added&&l.before>l.after*1.8)).toBe(true)
 const land=before.districts.find(d=>d.land).land
 expect(land.blocks).toBeGreaterThan(2);expect(land.parcels).toBeGreaterThan(land.built.length);expect(land.built.every(b=>b.id&&b.road)).toBe(true)
 const settlement=before.districts.find(d=>d.id==='district-settlement')
 expect(settlement.centres.map(c=>c.character)).toEqual(['centre','residential'])
 expect(settlement.land.built.length).toBe(139);expect(settlement.land.built.every(b=>b.id&&b.road)).toBe(true)
 expect(settlement.growth.links.some(l=>l.id==='market-connection'&&l.added)).toBe(true)
 expect(before.junctions).toHaveLength(54);expect(before.junctions.every(j=>j.arms===3)).toBe(true)
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.2,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(2,{timeout:5000})
 await press(page,xr,'nav-places');await page.waitForFunction(()=>window.__spinwardWatch.screen==='places')
 await xr.screenshot(info.outputPath('district-wrist.png'),{canvas:'canvas',metadata:true,timeout:5000});await press(page,xr,'nav-home')
 await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const head=new Quaternion()
 if(viewName==='corridor-seam'||viewName==='park-walk'||viewName.startsWith('settlement-')||viewName.startsWith('arrival-')){
  const tracking=await page.evaluate(([azimuth,axial,height])=>{const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],point=camera.position.clone().set(Math.cos(azimuth)*(3200-height),axial,Math.sin(azimuth)*(3200-height));return camera.parent.worldToLocal(city.group.localToWorld(point)).toArray()},nativeDistrictViews.find(v=>v.name===viewName).aim)
  head.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
 }
 for(const roll of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll*Math.PI/180)).toArray()});await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
  const probe=await state();expect(probe.roadMatrices).toEqual(before.roadMatrices)
  const capture=await xr.screenshot(info.outputPath(`district-roll-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);frames.push(capture)
  // Optional visual diagnosis: distinguish a near lamp's binocular occlusion
  // from a missing road/eye. Restore the scene before continuing the walk.
  if(process.env.CHECK_LAMP_OCCLUSION==='1'&&viewName==='arrival-east-shops'){
   const visible=await page.evaluate(()=>{const m=window.__spinwardStreetLamps.posts.mesh,old=m.visible;m.visible=false;return old})
   try{await xr.waitForFrames(2,{timeout:5000});await xr.screenshot(info.outputPath(`district-roll-${roll}-without-lamp-posts.png`),{canvas:'canvas',metadata:true,timeout:5000})}
   finally{await page.evaluate(v=>{window.__spinwardStreetLamps.posts.mesh.visible=v},visible);await xr.waitForFrames(2,{timeout:5000})}
  }
 }
 await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()})
 const rampSamples=[];let seamTraffic=null
 await xr.setAxes('left',0,(viewName==='corridor-seam'||viewName==='arrival-seam-walk')?-.9:-.45)
 const entranceId={'arrival-core-park':'arrival-park','arrival-east-cafe':'arrival-cafe','arrival-east-apartment':'arrival-apartment'}[viewName]
 if(entranceId){
  const {entrance,landing}=await page.evaluate(id=>{const w=window.__spinwardCity.getCityPlan().entranceWalks.find(w=>w.id===id);return{entrance:w.entrance,landing:w.landing}},entranceId)
  const length=Math.hypot(landing.x-entrance.x,landing.y-entrance.y),nx=(landing.x-entrance.x)/length,ny=(landing.y-entrance.y)/length
  const progress=p=>(p.x-entrance.x)*nx+(p.y-entrance.y)*ny
  const until=Date.now()+15000
  while(Date.now()<until){
   await xr.settle(150)
   const p=await page.evaluate(()=>({x:window.__spinward.azimuth*3200,y:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode}))
   rampSamples.push(p)
   if(progress(p)>=length)break
  }
  await xr.setAxes('left',0,0)
  expect(progress(rampSamples.at(-1))).toBeGreaterThanOrEqual(length)
  expect(progress(rampSamples.at(-1))).toBeLessThan(length+1)
  expect(rampSamples.every(p=>p.mode==='grounded'&&Math.abs((p.x-entrance.x)*ny-(p.y-entrance.y)*nx)<.7&&p.h>=0&&p.h<.35)).toBe(true)
  expect(Math.max(...rampSamples.map(p=>p.h))).toBeGreaterThan(.27)
  await xr.screenshot(info.outputPath(entranceId==='arrival-park'?'park-after-ramp.png':'entrance-after-ramp.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }else if(viewName==='arrival-seam-walk'){
  await xr.settle(9000);await xr.setAxes('left',0,0)
  // The car can pass during wrist/roll captures, before the walking sample
  // starts. Observe its next real passage without extending the player's walk.
  seamTraffic=await page.evaluate(async()=>{
   const city=window.__spinwardCity,previous=new Map(),crossings=[],seen=new Set(),until=performance.now()+45000,boundary=-449.9957477141951
   let samples=0,maxStep=0
   while(performance.now()<until&&!crossings.length){
    samples++;const poses=city.getTrafficPositions()
    city.trafficRoutes.forEach((r,i)=>{
     if(!r.native?.sources.some(s=>s.path.id.endsWith(':band-627')))return
     const p={x:poses[i].azimuth*3200,y:poses[i].axial},old=previous.get(r.id);seen.add(r.id)
     if(old){const step=Math.hypot(p.x-old.x,p.y-old.y);maxStep=Math.max(maxStep,step);if((old.x-boundary)*(p.x-boundary)<0&&step<10)crossings.push({id:r.id,from:old,to:p,paths:r.native.sources.map(s=>s.path.id)})}
     previous.set(r.id,p)
    });await new Promise(r=>setTimeout(r,100))
   }
   return{samples,cars:seen.size,crossings,maxStep,boundary}
  })
  await fs.writeFile(info.outputPath('seam-traffic.json'),JSON.stringify(seamTraffic,null,2))
  expect(seamTraffic.crossings.length).toBeGreaterThan(0)
  expect(seamTraffic.crossings.every(c=>c.paths.length===2)).toBe(true)
 }else if(viewName==='arrival-core-crossing'){
  const v=nativeDistrictViews.find(v=>v.name===viewName),dx=(v.aim[0]-v.at[0])*3200,dy=v.aim[1]-v.at[1],length=Math.hypot(dx,dy)
  for(let i=0;i<60;i++){
   await xr.settle(150)
   const p=await page.evaluate(()=>({x:window.__spinward.azimuth*3200,y:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode}))
   rampSamples.push(p)
   if(((p.x-v.at[0]*3200)*dx+(p.y-v.at[1])*dy)/length>=length)break
  }
  await xr.setAxes('left',0,0)
  expect(rampSamples.every(p=>p.mode==='grounded'&&Math.abs(p.h)<.05&&Math.abs((p.x-v.at[0]*3200)*dy-(p.y-v.at[1])*dx)/length<.6)).toBe(true)
  const last=rampSamples.at(-1)
  expect(((last.x-v.at[0]*3200)*dx+(last.y-v.at[1])*dy)/length).toBeGreaterThanOrEqual(length)
  expect(Math.hypot(last.x-v.aim[0]*3200,last.y-v.aim[1])).toBeLessThan(1.2)
  await xr.screenshot(info.outputPath('crossing-after-walk.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }else if(viewName.startsWith('arrival-local-')){
  for(let i=0;i<20;i++){
   await xr.settle(150)
   rampSamples.push(await page.evaluate(()=>({x:window.__spinward.azimuth*3200,y:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode})))
  }
  await xr.setAxes('left',0,0)
  const v=nativeDistrictViews.find(v=>v.name===viewName),dx=(v.aim[0]-v.at[0])*3200,dy=v.aim[1]-v.at[1],length=Math.hypot(dx,dy)
  expect(rampSamples.every(p=>p.mode==='grounded'&&Math.abs(p.h)<.05&&Math.abs((p.x-v.at[0]*3200)*dy-(p.y-v.at[1])*dx)/length<.7)).toBe(true)
  expect(Math.hypot(rampSamples.at(-1).x-v.at[0]*3200,rampSamples.at(-1).y-v.at[1])).toBeGreaterThan(8)
  await xr.screenshot(info.outputPath('local-after-walk.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }else{
  await xr.settle(viewName==='corridor-seam'?7500:viewName==='settlement-boundary'?7500:viewName==='settlement-walk'||viewName==='park-walk'?3500:viewName.startsWith('arrival-')?1500:viewName==='spine'?1000:350)
  await xr.setAxes('left',0,0)
 }
 const after=await state();expect(Math.hypot((after.azimuth-before.azimuth)*3200,after.axial-before.axial)).toBeGreaterThan(.3);expect(after.mode).toBe('grounded');expect(Math.abs(after.ground)).toBeLessThan(entranceId?.35:.05)
 if(viewName==='arrival-seam-walk'){
  expect(before.azimuth*3200).toBeLessThan(-460);expect(after.azimuth*3200).toBeGreaterThan(-440)
  await xr.screenshot(info.outputPath('arrival-after-seam.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }
 if(viewName==='settlement-boundary'){
  const edge=settlement.axial-settlement.length/2
  expect(before.axial).toBeLessThan(edge-10);expect(after.axial).toBeGreaterThan(edge+5)
  await xr.screenshot(info.outputPath('settlement-after-boundary.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }
 if(viewName==='corridor-seam'){
  const next=before.districts.find(d=>d.id==='district-0-region-1'),boundary=next.axial-next.length/2
  expect(before.axial).toBeLessThan(boundary-12);expect(after.axial).toBeGreaterThan(boundary+12)
  await xr.screenshot(info.outputPath('district-after-crossing.png'),{canvas:'canvas',metadata:true,timeout:5000})
 }
 expect(after.traffic.some(v=>{const b=before.traffic.find(b=>b.id===v.id);return b&&Math.hypot((v.azimuth-b.azimuth)*3200,v.axial-b.axial)>1})).toBe(true)
 expect(after.walkers.actors.some(a=>{const b=before.walkers.actors.find(b=>b.id===a.id);return a.id.startsWith('native:')&&b&&Math.hypot((a.azimuth-b.azimuth)*3200,a.axial-b.axial)>.1})).toBe(true)
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('district-evidence.json'),JSON.stringify({gpu,diagnostics,before,after,rampSamples,seamTraffic,frames,errors},null,2))
})

// Ground-level approach captures can hide the junction behind the curve.
// Aim the headset at the actual connection, then require it to stay in frame.
test('native T junction stays on screen and connected through stereo head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(nativeDistrictViews.find(v=>v.name==='t-overview'))}`)
 await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const target=await page.evaluate(()=>{
  const city=window.__spinwardCity,p=city.getCityPlan(),n=p.streetNetwork,j=p.streetMarkings.junctions.find(j=>j.arms.some(a=>n.streets[a.street].id==='district-0:link-0')&&j.arms.some(a=>n.streets[a.street].kind==='arterial')),node=n.nodes[j.node]
  const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],world=city.group.localToWorld(camera.position.clone().set(Math.cos(node.azimuth)*3199.68,node.axial,Math.sin(node.azimuth)*3199.68))
  return{tracking:camera.parent.worldToLocal(world.clone()).toArray(),world:world.toArray(),arms:j.arms.length}
 })
 expect(target.arms).toBe(3)
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target.tracking),new Vector3(0,1,0)))
 const surfaces=()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('isMesh',true).filter(m=>m.name.startsWith('street-surface-')).map(m=>({name:m.name,matrix:m.matrixWorld.elements,triangles:m.geometry.index.count/3})))
 const before=await surfaces()
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
  expect(await surfaces()).toEqual(before)
  const projected=await page.evaluate(world=>{const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return camera.position.clone().fromArray(world).project(camera).toArray()},target.world)
  expect(Math.abs(projected[0])).toBeLessThan(.9);expect(Math.abs(projected[1])).toBeLessThan(.9);expect(projected[2]).toBeGreaterThan(-1);expect(projected[2]).toBeLessThan(1)
  const capture=await xr.screenshot(info.outputPath(`junction-roll-${degrees}.png`),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);frames.push({degrees,projected,capture})
 }
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('junction-evidence.json'),JSON.stringify({gpu,diagnostics,target,before,frames,errors},null,2))
})
