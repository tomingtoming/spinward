import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('wet river paving stays world-fixed and a controller walk leaves the dry bridge cover',async({page,xr},info)=>{
 const report={errors:[],frames:[]};page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(report.gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&rain&t=.42&m=g&a=.18054535455&ax=1449.18146&gh=1.2')
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.riverLayer?.group.userData.blenderReady);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();report.diagnostics=await xr.diagnostics();const id=report.diagnostics.session.id
 expect(report.diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(report.diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const tracking=await page.evaluate(()=>{const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],a=window.__spinward.azimuth;return camera.parent.worldToLocal(city.group.localToWorld(camera.position.clone().set(Math.cos(a)*(3200-1.2),1474,Math.sin(a)*(3200-1.2)))).toArray()})
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
 const probe=()=>page.evaluate(()=>{const c=window.__spinwardCity,s=window.__spinward;return{azimuth:s.azimuth,axial:s.axial,h:s.groundHeight,mode:s.mode,rain:s.rain,group:c.riverLayer.group.matrix.elements,materials:c.getPavementMaterials().map(m=>m.uuid),hooks:c.getPavementMaterials().map(m=>m.customProgramCacheKey().includes('wet-paving'))}})
 report.before=await probe();expect(report.before.rain.shelter).toBe(1);expect(report.before.rain.pavementWetness).toBe(1);expect(report.before.h).toBeCloseTo(1.2,2);expect(report.before.hooks.every(Boolean)).toBe(true)
 await xr.setControllerPose('left',{position:[-.5,.55,.1],quaternion:[0,0,0,1]});await xr.setControllerPose('right',{position:[.5,.55,.1],quaternion:[0,0,0,1]})
 for(const roll of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll*Math.PI/180)).toArray()});await xr.waitForFrames(2,{sessionId:id,timeout:5000})
  const state=await probe();expect(state.group).toEqual(report.before.group);expect(state.materials).toEqual(report.before.materials);expect(state.rain.shelter).toBe(1)
  const capture=await xr.screenshot(info.outputPath(`wet-paving-roll-${roll}.png`),{metadata:true,canvas:'canvas',timeout:5000});expect(capture.sessionId).toBe(id);expect([capture.width,capture.height]).toEqual([2560,960]);report.frames.push({roll,state,capture})
 }
 await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()});await xr.waitForFrames(2,{sessionId:id,timeout:5000});await xr.setAxes('left',0,-.7);await xr.settle(3500);await xr.setAxes('left',0,0);await xr.waitForFrames(2,{sessionId:id,timeout:5000})
 report.outside=await probe();expect(report.outside.axial-report.before.axial).toBeGreaterThan(5);expect(report.outside.mode).toBe('grounded');expect(report.outside.h).toBeCloseTo(1.2,2);expect(report.outside.rain.shelter).toBe(0);expect(report.outside.rain.pavementWetness).toBe(1)
 await xr.screenshot(info.outputPath('wet-paving-outside.png'),{metadata:true,canvas:'canvas',timeout:5000})
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(report.errors).toEqual([])
 await fs.writeFile(info.outputPath('wet-paving.json'),JSON.stringify(report,null,2))
})
