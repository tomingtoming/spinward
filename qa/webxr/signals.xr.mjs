import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {signalViews,signalPose} from '../neighborhood-life/signal-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('signal hoods and support stay attached through stereo head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(signalViews[1])}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardIntersections.group.getObjectByName('intersection-signal-visors')?.userData.asset==='blender')
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const target=await page.evaluate(()=>{
  const heads=window.__spinwardIntersections.group.getObjectByName('intersection-signal-heads'),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  const m=heads.matrix.clone();let selected=0,best=Infinity
  for(let i=0;i<heads.count;i++){heads.getMatrixAt(i,m);const d=Math.abs(m.elements[13]-317.39)+Math.abs(Math.atan2(m.elements[14],m.elements[12])*3200+7.25);if(d<best){best=d;selected=i}}
  heads.userData.qaSelectedHead=selected;heads.getMatrixAt(selected,m)
  return camera.parent.worldToLocal(heads.localToWorld(camera.position.clone().setFromMatrixPosition(m))).toArray()
 })
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
 let baseline
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(200)
  const probe=await page.evaluate(()=>{
   const group=window.__spinwardIntersections.group,heads=group.getObjectByName('intersection-signal-heads'),visors=group.getObjectByName('intersection-signal-visors'),lod=visors.getObjectByName('signal-visors-lod0'),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],m=heads.matrix.clone()
   heads.getMatrixAt(heads.userData.qaSelectedHead,m)
   return {head:m.elements,headWorld:heads.matrixWorld.elements,visorWorld:lod.matrixWorld.elements,instances:Array.from(lod.instanceMatrix.array.slice(0,lod.count*16)),counts:visors.userData.counts,asset:visors.userData.asset,
    projected:[-.6,0,.6].map(y=>heads.localToWorld(camera.position.clone().set(0,y,.2).applyMatrix4(m)).project(camera).toArray())}
  })
  if(!baseline)baseline=probe
  for(const key of ['head','headWorld','visorWorld','instances'])expect(probe[key]).toEqual(baseline[key])
  expect(probe.asset).toBe('blender');expect(probe.counts[0]).toBeGreaterThan(0)
  for(const p of probe.projected){expect(Math.abs(p[0])).toBeLessThan(.9);expect(Math.abs(p[1])).toBeLessThan(.9);expect(p[2]).toBeGreaterThan(-1);expect(p[2]).toBeLessThan(1)}
  const path=info.outputPath(`signals-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`signals-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,probe,capture})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end())
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('signals-evidence.json'),JSON.stringify({gpu,diagnostics,frames,errors},null,2))
})
