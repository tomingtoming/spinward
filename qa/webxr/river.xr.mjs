import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { riverViews, riverPose } from '../neighborhood-life/river-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('river bank and bridge remain on screen and world-fixed through stereo head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${riverPose(riverViews[1])}`)
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.riverLayer.group.userData.blenderReady)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const tracking=await page.evaluate(()=>{const c=window.__spinwardCity,p=c.riverDistrict,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],a=p.azimuth+5/3200;
  return camera.parent.worldToLocal(c.group.localToWorld(camera.position.clone().set(Math.cos(a)*(3200-2.9),p.axial-3,Math.sin(a)*(3200-2.9)))).toArray()})
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
 const probe=()=>page.evaluate(()=>({matrix:window.__spinwardCity.riverLayer.group.matrix.elements,h:window.__spinward.groundHeight,ready:window.__spinwardCity.riverLayer.group.userData.blenderReady}))
 const before=await probe();expect(before.h).toBeCloseTo(1.2,2)
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(200)
  expect(await probe()).toEqual(before)
  const projected=await page.evaluate(()=>{const c=window.__spinwardCity,p=c.riverDistrict,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return [[0,0,4.6],[12,8,1.2]].map(([x,y,h])=>{const a=p.azimuth+x/3200,point=camera.position.clone().set(Math.cos(a)*(3200-h),p.axial+y,Math.sin(a)*(3200-h));return c.group.localToWorld(point).project(camera).toArray()})})
  for(const [x,y,z]of projected){expect(Math.abs(x)).toBeLessThan(.98);expect(Math.abs(y)).toBeLessThan(.98);expect(z).toBeGreaterThan(-1);expect(z).toBeLessThan(1)}
  const path=info.outputPath(`river-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);await info.attach(`river-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,capture,projected})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end());await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('river-evidence.json'),JSON.stringify({diagnostics,gpu,before,frames,errors},null,2))
})
