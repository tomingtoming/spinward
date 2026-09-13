import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {signalPose} from '../neighborhood-life/signal-views.mjs'
import {streetSignalViews} from '../neighborhood-life/street-signal-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('signal hoods and support stay attached through stereo head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(streetSignalViews[1])}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardIntersections.group.getObjectByName('intersection-signal-visors')?.userData.asset==='blender')
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const target=await page.evaluate(()=>{
  const heads=window.__spinwardIntersections.group.getObjectByName('intersection-signal-heads'),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  const m=heads.matrix.clone(), selected=heads.userData.nativeApproaches.findIndex(a=>a.street==='road-7'&&a.sign===-1&&Math.abs(window.__spinwardCity.getCityPlan().streetNetwork.nodes[a.node].axial-321.29)<1)
  if(selected<0)throw Error('Expected native incoming signal not rendered')
  heads.userData.qaSelectedHead=selected;heads.getMatrixAt(selected,m)
  return camera.parent.worldToLocal(heads.localToWorld(camera.position.clone().setFromMatrixPosition(m))).toArray()
 })
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
 let baseline
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.waitForFrames(2,{timeout:5000})
  const probe=await page.evaluate(()=>{
   const group=window.__spinwardIntersections.group,heads=group.getObjectByName('intersection-signal-heads'),visors=group.getObjectByName('intersection-signal-visors'),lod=visors.getObjectByName('signal-visors-lod0'),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],m=heads.matrix.clone()
   heads.getMatrixAt(heads.userData.qaSelectedHead,m)
   const control=heads.userData.nativeApproaches[heads.userData.qaSelectedHead],plan=window.__spinwardCity.getCityPlan(),node=plan.streetNetwork.nodes[control.node]
   return {control,legacyFallbackAtSelected:plan.streetSignals.legacyFallbacks.some(c=>Math.hypot(Math.atan2(Math.sin(c.azimuth-node.azimuth),Math.cos(c.azimuth-node.azimuth))*3200,c.axial-node.axial)<.01),nativeJunctionHeads:heads.userData.nativeApproaches.filter(a=>a.node===control.node).length,legacyStops:group.getObjectByName('crosswalk-stripes').count,stopLines:group.getObjectByName('street-junction-markings').userData.stopLines,head:m.elements,headWorld:heads.matrixWorld.elements,visorWorld:lod.matrixWorld.elements,instances:Array.from(lod.instanceMatrix.array.slice(0,lod.count*16)),counts:visors.userData.counts,asset:visors.userData.asset,
    projected:[-.6,0,.6].map(y=>heads.localToWorld(camera.position.clone().set(0,y,.2).applyMatrix4(m)).project(camera).toArray())}
  })
  if(!baseline)baseline=probe
  for(const key of ['head','headWorld','visorWorld','instances'])expect(probe[key]).toEqual(baseline[key])
  expect(probe.control.street).toBe('road-7');expect(probe.legacyFallbackAtSelected).toBe(false);expect(probe.nativeJunctionHeads).toBe(4);expect(probe.stopLines).toBeGreaterThan(0)
  expect(probe.asset).toBe('blender');expect(probe.counts[0]).toBeGreaterThan(0)
  for(const p of probe.projected){expect(Math.abs(p[0])).toBeLessThan(.9);expect(Math.abs(p[1])).toBeLessThan(.9);expect(p[2]).toBeGreaterThan(-1);expect(p[2]).toBeLessThan(1)}
  const path=info.outputPath(`signals-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`signals-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,probe,capture})
 }
 const after=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000})
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('signals-evidence.json'),JSON.stringify({gpu,diagnostics,frames,errors},null,2))
})
