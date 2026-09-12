import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {Matrix4,Quaternion,Vector3} from 'three'
import {skylinePose} from '../neighborhood-life/skyline-views.mjs'
import {nightDistrictViews} from '../neighborhood-life/night-district-views.mjs'

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('distant district lights remain attached to the colony in stereo through head roll',async({page,xr},info)=>{
 const errors=[],frames=[]
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|context.*lost/i.test(m.text()))errors.push(m.text())})
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 const view=nightDistrictViews[1]
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${skylinePose(view)}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>!!window.__spinwardCity?.colonyBuildings?.modules)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics()
 expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible))).toBe(true)
 const target=await page.evaluate(([a,y])=>{
  const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  const p=camera.position.clone().set(Math.cos(a)*3200,y,Math.sin(a)*3200)
  return camera.parent.worldToLocal(city.group.localToWorld(p)).toArray()
 },view.aim)
 const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
 const probe=()=>page.evaluate(()=>{
  const scene=window.__spinwardScene
  const material=scene.getObjectsByProperty('isMesh',true).flatMap(o=>Array.isArray(o.material)?o.material:[o.material]).find(m=>m.onBeforeCompile.toString().includes('cityEmissiveMap'))
  if(!material)throw Error('Missing city shell')
  const shader={uniforms:{},vertexShader:'',fragmentShader:''};material.onBeforeCompile(shader)
  const u=shader.uniforms,texture=u.cityEmissiveMap.value
  return {texture:texture.uuid,version:texture.version,size:[texture.image.width,texture.image.height],fade:u.uCityFade.value.toArray(),group:window.__spinwardCity.group.matrix.elements}
 })
 const before=await probe()
 expect(before.size).toEqual([4096,2048])
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()})
  await xr.settle(200)
  expect(await probe()).toEqual(before)
  const projected=await page.evaluate(([a,y])=>{
   const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
   return city.group.localToWorld(camera.position.clone().set(Math.cos(a)*3200,y,Math.sin(a)*3200)).project(camera).toArray()
  },view.aim)
  expect(Math.abs(projected[0])).toBeLessThan(.95);expect(Math.abs(projected[1])).toBeLessThan(.95)
  expect(projected[2]).toBeGreaterThan(-1);expect(projected[2]).toBeLessThan(1)
  const path=info.outputPath(`night-districts-roll-${degrees}.png`)
  const capture=await xr.screenshot(path,{canvas:'canvas',metadata:true,timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`night-districts-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,capture,projected})
 }
 const after=await xr.sessionCursor()
 await page.evaluate(()=>window.__xrDevice.activeSession.end())
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000})
 expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('night-districts.json'),JSON.stringify({diagnostics,gpu,frames,before,errors},null,2))
})
