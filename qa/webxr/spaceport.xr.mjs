import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {spaceportViews,spaceportPose} from '../neighborhood-life/spaceport-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('spaceport shuttle and metric docking collar stay attached through stereo head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${spaceportPose(spaceportViews[0])}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardScene.getObjectByName('spaceport')?.userData.collarAsset==='blender')
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const target=await page.evaluate(()=>{
  const port=window.__spinwardScene.getObjectByName('spaceport'),b=port.userData.berths[0],camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  return camera.parent.worldToLocal(port.localToWorld(camera.position.clone().set(b.x,b.y-7,b.z))).toArray()
 })
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
 let baseline
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(200)
  const probe=await page.evaluate(()=>{
   const port=window.__spinwardScene.getObjectByName('spaceport'),b=port.userData.berths[0],camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],lod=port.getObjectByName('docking-collar-0')
   return {matrix:lod.matrixWorld.elements,ships:port.getObjectByName('spaceport-docked-ships').matrixWorld.elements,level:lod.getCurrentLevel(),
    projected:port.localToWorld(camera.position.clone().set(b.x,b.y-2.4,b.z)).project(camera).toArray()}
  })
  if(!baseline)baseline=probe
  expect(probe.matrix).toEqual(baseline.matrix);expect(probe.ships).toEqual(baseline.ships);expect(probe.level).toBe(0)
  expect(Math.abs(probe.projected[0])).toBeLessThan(.9);expect(Math.abs(probe.projected[1])).toBeLessThan(.9)
  expect(probe.projected[2]).toBeGreaterThan(-1);expect(probe.projected[2]).toBeLessThan(1)
  const path=info.outputPath(`spaceport-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`spaceport-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,probe,capture})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end())
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('spaceport-evidence.json'),JSON.stringify({gpu,diagnostics,frames,errors},null,2))
})
