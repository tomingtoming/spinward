import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { riverWalkerViews, riverPose } from '../neighborhood-life/river-walker-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('river residents walk on the lower bank in stereo through head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${riverPose(riverWalkerViews[0])}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardWalkers?.group.userData.actors?.some(a=>a.id==='river:1'))
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 const probe=()=>page.evaluate(()=>{
  const w=window.__spinwardWalkers,a=w.group.userData.actors.find(a=>a.id==='river:1'),root=w.walkers.find(w=>w.route.id===a.id).root
  const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],point=root.position.clone()
  const angle=a.azimuth;point.set(Math.cos(angle)*(3200-a.height-1.05),a.axial,Math.sin(angle)*(3200-a.height-1.05))
  const world=window.__spinwardCity.group.localToWorld(point)
  return {actor:a,root:root.position.toArray(),people:w.group.userData.people,capacity:w.group.userData.capacity,
   projected:world.clone().project(camera).toArray(),tracking:camera.parent.worldToLocal(world).toArray()}
 })
 const initial=await probe();await xr.settle(600);const moved=await probe()
 expect(Math.hypot((initial.actor.azimuth-moved.actor.azimuth)*3200,initial.actor.axial-moved.actor.axial)).toBeGreaterThan(.2)
 for(const degrees of [0,25,-25]) {
  const target=(await probe()).tracking
  const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(180)
  const state=await probe()
  expect(state.people).toBeLessThanOrEqual(4);expect(state.actor.visible).toBe(true);expect(state.actor.height).toBeCloseTo(1.2,2)
  expect(3200-Math.hypot(state.root[0],state.root[2])).toBeCloseTo(state.actor.height+.02,6)
  expect(Math.abs(state.projected[0])).toBeLessThan(.95);expect(Math.abs(state.projected[1])).toBeLessThan(.95)
  expect(state.projected[2]).toBeGreaterThan(-1);expect(state.projected[2]).toBeLessThan(1)
  const path=info.outputPath(`river-walkers-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);await info.attach(`river-walkers-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,state,capture})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end());await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000})
 expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('river-walkers.json'),JSON.stringify({diagnostics,gpu,initial,moved,frames,errors},null,2))
})
