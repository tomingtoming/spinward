import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
const left={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()},right=[.22,1.38,-.2]
async function press(page,xr,id){
 const p=await page.evaluate(id=>{const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id);if(!b)throw Error('Missing '+id);const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return{u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}},id)
 const matrix=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel)),target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(matrix).toArray()
 await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)});await xr.waitForFrames(2,{timeout:5000})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id);await xr.pressButton('right','trigger')
}
import {signalPose} from '../neighborhood-life/signal-views.mjs'
import {nativeDistrictViews} from '../neighborhood-life/native-district-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('native district roads remain connected while walking and using the wrist in stereo',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank');const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(nativeDistrictViews.find(v=>v.name==='spine'))}`)
 await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 const state=()=>page.evaluate(()=>{
  const city=window.__spinwardCity,p=city.getCityPlan(),poses=city.getTrafficPositions(),routes=city.trafficRoutes
  return{azimuth:window.__spinward.azimuth,axial:window.__spinward.axial,ground:window.__spinward.groundHeight,mode:window.__spinward.mode,
   districts:p.nativeDistricts.map(d=>({id:d.id,buildings:d.buildings.length})),
   traffic:routes.flatMap((r,i)=>r.native?[{id:r.id,...poses[i]}]:[]),
   walkers:window.__spinwardWalkers.group.userData,
   roadMatrices:window.__spinwardScene.getObjectsByProperty('isMesh',true).filter(m=>m.name.startsWith('street-surface-')).map(m=>({name:m.name,matrix:m.matrixWorld.elements,triangles:m.geometry.index.count/3}))}
 })
 await page.waitForFunction(()=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id.startsWith('native:')&&a.visible))
 const before=await state();expect(before.districts).toHaveLength(3);expect(before.traffic.length).toBeGreaterThan(0);expect(before.walkers.people).toBeLessThanOrEqual(4)
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.2,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(2,{timeout:5000})
 await press(page,xr,'nav-places');await page.waitForFunction(()=>window.__spinwardWatch.screen==='places')
 await xr.screenshot(info.outputPath('district-wrist.png'),{canvas:'canvas',metadata:true,timeout:5000});await press(page,xr,'nav-home')
 await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 for(const roll of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,roll*Math.PI/180]});await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
  const probe=await state();expect(probe.roadMatrices).toEqual(before.roadMatrices)
  const capture=await xr.screenshot(info.outputPath(`district-roll-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);frames.push(capture)
 }
 await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,0]});await xr.setAxes('left',0,-.45);await xr.settle(1000);await xr.setAxes('left',0,0)
 const after=await state();expect(Math.hypot((after.azimuth-before.azimuth)*3200,after.axial-before.axial)).toBeGreaterThan(.3);expect(after.mode).toBe('grounded');expect(Math.abs(after.ground)).toBeLessThan(.05)
 expect(after.traffic.some(v=>{const b=before.traffic.find(b=>b.id===v.id);return b&&Math.hypot((v.azimuth-b.azimuth)*3200,v.axial-b.axial)>1})).toBe(true)
 expect(after.walkers.actors.some(a=>{const b=before.walkers.actors.find(b=>b.id===a.id);return a.id.startsWith('native:')&&b&&Math.hypot((a.azimuth-b.azimuth)*3200,a.axial-b.axial)>.1})).toBe(true)
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('district-evidence.json'),JSON.stringify({gpu,diagnostics,before,after,frames,errors},null,2))
})
