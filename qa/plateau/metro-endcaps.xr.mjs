import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {Matrix4,Quaternion,Vector3} from 'three'
import {bulkheadViews,bulkheadPose} from '../neighborhood-life/bulkhead-views.mjs'
const before=process.env.SPINWARD_ENDCAP_BEFORE==='1'
// P-24 lies over the land band. The window-band bay at 45 degrees does not
// have a nearby street region, so waiting for regional city readiness there
// would never finish even when the wall and equipment are already rendered.
const c=Math.cos(Math.PI/12),s=Math.sin(Math.PI/12),r=3200*.86
const service={name:'service',at:[(r-3)*c,-19968,-(r-3)*s],aim:[(r-3)*c,-19999,-(r-3)*s],up:[-c,0,s]}
const serviceOblique={name:'service-oblique',at:[(r+1)*c-16*s,-19982,-(r+1)*s-16*c],aim:service.aim,up:service.up}
const views=[...bulkheadViews.filter(v=>['port','opposite','oblique','night','small','ring','window'].includes(v.name)),service,serviceOblique]
async function boot(page,v){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info'),r=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto(`/?${!v.preset||v.preset==='izma'?'city=tokyo&':''}debug&metrics=off&lock=0&dpr=1&tier=quest&${bulkheadPose(v)}`)
  await page.waitForFunction(()=>window.__spinwardScene&&window.__spinwardRenderer)
  await page.waitForSelector('#splash',{state:'detached'})
  if(!v.preset)await page.waitForFunction(()=>window.__spinwardMetro?.ready&&window.__spinward.regional.state==='ready')
  if(!before&&!v.preset)await page.waitForFunction(()=>window.__spinwardScene.getObjectByName('bulkhead-structure')?.userData.moduleStatus==='blender')
  await page.waitForTimeout(900)
  const p=await page.evaluate(()=>({y:window.__spinward.axial,r:window.__spinward.radial}))
  expect(p.y).toBeCloseTo(v.at[1],1);expect(p.r).toBeCloseTo(Math.hypot(v.at[0],v.at[2]),1)
  return gpu
}
const listen=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});return errors}
for(const v of views)test(`end wall ${v.name}: structure, scale and topology`,async({page},info)=>{
  const errors=listen(page),gpu=await boot(page,v)
  await page.screenshot({path:info.outputPath('view.png')})
  const probe=await page.evaluate(()=>new Promise(resolve=>{
    const times=[];let last=performance.now(),start=last
    function tick(now){times.push(now-last);last=now;if(now-start<1800)return requestAnimationFrame(tick)
      times.sort((a,b)=>a-b)
      const root=window.__spinwardScene.getObjectByName('bulkhead-structure'),caps=window.__spinwardScene.getObjectByName('bulkhead-disks'),lods=[]
      root?.traverse(o=>{if(o.isLOD)lods.push(o.getCurrentLevel())})
      resolve({p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],draw:window.__spinwardRenderer.info.render,
        details:root?.userData??null,lods,opaque:caps?!caps.material.transparent:null,errors:[]})
    }requestAnimationFrame(tick)
  }))
  if(!before){expect(probe.details.triangles).toBeLessThan(40000)
    expect(probe.details.ends).toEqual(v.open?[]:v.preset==='playground'?[-1]:[-1,1])
    if(v.name==='service')expect(probe.lods).toContain(0)
    if(v.name==='port')expect(probe.lods.every(l=>l===2)).toBe(true)
  }
  expect(probe.opaque).toBe(v.open?null:true);expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({view:v,gpu,probe,errors},null,2))
})
test.describe('stereo end wall',()=>{
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
for(const view of [bulkheadViews[0],service])test(`stereo ${view.name}: both eyes and head roll`,async({page,xr},info)=>{
  test.skip(before)
  const errors=listen(page),gpu=await boot(page,view)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostics=await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
  expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
  const aim=await page.evaluate(target=>{const scene=window.__spinwardScene,camera=scene.getObjectsByProperty('isPerspectiveCamera',true)[0];return camera.parent.worldToLocal(scene.getObjectByName('habitat').localToWorld(camera.position.clone().set(...target))).toArray()},view.aim)
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...aim),new Vector3(0,1,0)))
  const baseline=await page.evaluate(()=>window.__spinwardScene.getObjectByName('bulkhead-structure').matrixWorld.elements)
  for(const roll of [0,.32,-.32]){
    await xr.setHeadPose({position:[0,1.6,0],quaternion:q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll)).toArray()});await xr.waitForFrames(3)
    expect(await page.evaluate(()=>window.__spinwardScene.getObjectByName('bulkhead-structure').matrixWorld.elements)).toEqual(baseline)
    const projected=await page.evaluate(target=>{const scene=window.__spinwardScene,camera=scene.getObjectsByProperty('isPerspectiveCamera',true)[0];return scene.getObjectByName('habitat').localToWorld(camera.position.clone().set(...target)).project(camera).toArray()},view.aim)
    expect(Math.abs(projected[0])).toBeLessThan(.95);expect(Math.abs(projected[1])).toBeLessThan(.95)
    expect(projected[2]).toBeGreaterThan(-1);expect(projected[2]).toBeLessThan(1)
    const capture=await xr.screenshot(info.outputPath(`stereo-${roll}.png`),{canvas:'canvas',metadata:true})
    expect(capture.sessionId).toBe(diagnostics.session.id)
    expect([capture.width,capture.height]).toEqual([2560,960])
  }
  await xr.endSession();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('xr.json'),JSON.stringify({gpu,errors},null,2))
})
})
