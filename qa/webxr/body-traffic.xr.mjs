import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('ambient car yields to the VR body and resumes after controller locomotion clears its lane',async({page,xr},info)=>{
 const report={errors:[],frames:[]};page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(report.gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const open=async pose=>{await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&${pose}`);await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked&&window.__spinwardCity.riverTraffic)}
 await open('m=g&a=.1763264639508575&ax=1445.8064516129052&gh=5.2')
 const person=await page.evaluate(()=>{const l=window.__spinwardCity.riverTraffic,p=l.points.find(p=>p.distance>=l.bridgeStart+110);return{azimuth:l.azimuth+p.x/l.radius,axial:l.axial+p.y,height:p.h}});report.person=person
 await open(`m=g&a=${person.azimuth}&ax=${person.axial}&gh=${person.height}`);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();report.diagnostics=await xr.diagnostics();const id=report.diagnostics.session.id
 expect(report.diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(report.diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 const probe=()=>page.evaluate(()=>{const c=window.__spinwardCity,i=c.trafficRoutes.findIndex(r=>r.id==='river-loop:0'),r=c.trafficRoutes[i],car=c.getTrafficPositions()[i],p=c.trafficPedestrian,x=(p.azimuth-car.azimuth)*c.radius,y=p.axial-car.axial;return{car,body:p,progress:r.motion.progress,along:x*Math.sin(car.heading)+y*Math.cos(car.heading),across:x*Math.cos(car.heading)-y*Math.sin(car.heading),mode:window.__spinward.mode,count:c.trafficRoutes.length,budget:c.maxTraffic}})
 await expect.poll(async()=>{const s=await probe();return s.car.speed<.02&&s.along>3.6&&s.along<4.05&&Math.abs(s.across)<.15},{timeout:60000}).toBe(true)
 report.stopped=await probe()
 // Keep the controller models by the hips for unobstructed scenery captures.
 await xr.setControllerPose('left',{position:[-.5,.55,.1],quaternion:[0,0,0,1]})
 await xr.setControllerPose('right',{position:[.5,.55,.1],quaternion:[0,0,0,1]})
 await xr.waitForFrames(2,{sessionId:id,timeout:5000})
 const tracking=await page.evaluate(()=>{const c=window.__spinwardCity,i=c.trafficRoutes.findIndex(r=>r.id==='river-loop:0'),v=c.getTrafficPositions()[i],camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return camera.parent.worldToLocal(c.group.localToWorld(camera.position.clone().set(Math.cos(v.azimuth)*(c.radius-v.height-.8),v.axial,Math.sin(v.azimuth)*(c.radius-v.height-.8)))).toArray()})
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
 for(const roll of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll*Math.PI/180)).toArray()});await xr.waitForFrames(2,{sessionId:id,timeout:5000})
  const state=await probe();expect(state.car.speed).toBeLessThan(.02)
  // The live grounded body settles by millimetres on the curved contact mesh.
  // A yielding car holds its clearance to that body, not a frozen world point.
  expect(Math.abs(state.along-report.stopped.along)).toBeLessThan(.02)
  expect(Math.hypot((state.body.azimuth-report.stopped.body.azimuth)*3200,state.body.axial-report.stopped.body.axial)).toBeLessThan(.05)
  expect(state.body.height).toBeCloseTo(5.2,2)
  const capture=await xr.screenshot(info.outputPath(`body-traffic-roll-${roll}.png`),{metadata:true,canvas:'canvas',timeout:5000});expect(capture.sessionId).toBe(id);expect([capture.width,capture.height]).toEqual([2560,960]);report.frames.push({roll,state,capture})
 }
 await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()});await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]});await xr.waitForFrames(2,{timeout:5000})
 await xr.setAxes('left',.7,0);await xr.settle(1300);await xr.setAxes('left',0,0)
 await expect.poll(async()=>{const s=await probe();return s.progress>report.stopped.progress+9&&s.car.speed>1},{timeout:12000}).toBe(true)
 report.cleared=await probe();expect(report.cleared.mode).toBe('grounded');expect(report.cleared.count).toBeLessThanOrEqual(report.cleared.budget)
 await xr.screenshot(info.outputPath('body-traffic-cleared.png'),{metadata:true,canvas:'canvas',timeout:5000})
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(report.errors).toEqual([])
 await fs.writeFile(info.outputPath('body-traffic.json'),JSON.stringify(report,null,2))
})
