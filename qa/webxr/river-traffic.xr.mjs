import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {riverViews,riverPose} from '../neighborhood-life/river-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('river traffic moves on the bridge through both eyes and head roll',async({page,xr},info)=>{
 const evidence={frames:[],errors:[]};page.on('pageerror',e=>evidence.errors.push(e.message))
 await page.goto('about:blank')
 evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(evidence.gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${riverPose(riverViews[2])}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked&&window.__spinwardCity.trafficRoutes.some(r=>r.path))
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();evidence.diagnostics=diagnostics
 expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const tracking=await page.evaluate(()=>{
   const c=window.__spinwardCity,p=c.riverDistrict,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],a=p.azimuth+5/c.radius
   return camera.parent.worldToLocal(c.group.localToWorld(camera.position.clone().set(Math.cos(a)*(c.radius-5.8),p.axial+2,Math.sin(a)*(c.radius-5.8)))).toArray()
 })
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
 // Observe ordinary progression. Do not relocate the car or advance its clock.
 await page.waitForFunction(()=>{const c=window.__spinwardCity,r=c.trafficRoutes.find(r=>r.id==='river-loop:0');return r&&r.motion.progress>r.path.bridgeStart+85&&r.motion.progress<r.path.bridgeStart+170},null,{timeout:60000})
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(200)
  const probe=await page.evaluate(()=>{
    const c=window.__spinwardCity,r=c.trafficRoutes.find(r=>r.id==='river-loop:0'),i=c.trafficRoutes.indexOf(r),p=c.getTrafficPositions()[i]
    const variant=r.variant%c.trafficMeshes.length,slot=c.trafficRoutes.slice(0,i).filter(o=>o.variant%c.trafficMeshes.length===variant).length
    const mesh=c.trafficMeshes[variant],m=mesh.matrix.clone();mesh.getMatrixAt(slot,m)
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    const center=c.group.localToWorld(camera.position.clone().set(0,.7,0).applyMatrix4(m)),projected=center.project(camera).toArray()
    return {progress:r.motion.progress,speed:r.motion.speed,p,matrix:m.elements,determinant:m.determinant(),projected,total:c.trafficRoutes.length,budget:c.maxTraffic,ground:window.__spinward.groundHeight}
  })
  expect(probe.total).toBeLessThanOrEqual(probe.budget);expect(probe.ground).toBeCloseTo(5.34,2)
  expect(probe.p.height).toBeCloseTo(5.2,2);expect(probe.determinant).toBeCloseTo(1,5)
  const expected=[Math.cos(probe.p.azimuth)*(3200-probe.p.height),probe.p.axial,Math.sin(probe.p.azimuth)*(3200-probe.p.height)]
  expect(Math.hypot(...expected.map((v,j)=>v-probe.matrix[12+j]))).toBeLessThan(.001)
  expect(Math.abs(probe.projected[0])).toBeLessThan(.95);expect(Math.abs(probe.projected[1])).toBeLessThan(.95)
  expect(probe.projected[2]).toBeGreaterThan(-1);expect(probe.projected[2]).toBeLessThan(1)
  const path=info.outputPath(`traffic-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`traffic-roll-${degrees}`,{path,contentType:'image/png'});evidence.frames.push({degrees,probe,capture})
 }
 expect(evidence.frames.at(-1).probe.progress-evidence.frames[0].probe.progress).toBeGreaterThan(.5)
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end())
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(evidence.errors).toEqual([])
 await fs.writeFile(info.outputPath('river-traffic-evidence.json'),JSON.stringify(evidence,null,2))
})
