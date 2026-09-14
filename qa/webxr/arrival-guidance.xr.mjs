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
const unavailable=process.env.EXPECT_UNAVAILABLE==='1'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('arrival west wrist directions reach public places without moving the player',async({page,xr},info)=>{
 const errors=[],frames=[],journeys=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank');const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(nativeDistrictViews.find(v=>v.name==='arrival-street'))}`)
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardOuting?.destinations.has('guide-park'));await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(2,{timeout:5000})
 const state=()=>page.evaluate(()=>({azimuth:window.__spinward.azimuth,axial:window.__spinward.axial,ground:window.__spinward.groundHeight,mode:window.__spinward.mode,outing:window.__spinward.outing,points:window.__spinwardOuting.journey.points}))
 const origin=await state()
 for(const id of ['guide-square','guide-park']){
  await press(page,xr,'nav-places');await press(page,xr,'nav-outing');const started=Date.now();await press(page,xr,id)
  await page.waitForFunction(({id,unavailable})=>window.__spinward.outing.action===id&&window.__spinward.outing.status===(unavailable?'unavailable':'active'),{id,unavailable})
  const guided=await state();expect(Math.hypot((guided.azimuth-origin.azimuth)*3200,guided.axial-origin.axial)).toBeLessThan(.15)
  journeys.push({id,uiResponseMs:Date.now()-started,...guided})
  if(!unavailable){expect(guided.points.length).toBeGreaterThan(20);expect(guided.points.some(p=>p.crosswalk)).toBe(true);expect(guided.outing.remaining).toBeGreaterThan(600);expect(guided.outing.remaining).toBeLessThan(id==='guide-square'?1900:2200)}
  else expect(guided.points).toHaveLength(0)
  for(const roll of id==='guide-park'?[0,25,-25]:[0]){
   await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,roll*Math.PI/180]});await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
   frames.push(await xr.screenshot(info.outputPath(`${id}-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000}))
  }
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.waitForFrames(2,{timeout:5000})
  if(id==='guide-square'||unavailable){await press(page,xr,'guide-cancel');await press(page,xr,'nav-home')}
 }
 let walked=null,visited=null
 if(!unavailable){
  const before=await state(),target=before.points.find(p=>Math.hypot((p.azimuth-before.azimuth)*3200,p.axial-before.axial)>12)
  const tracking=await page.evaluate(p=>{const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],point=camera.position.clone().set(Math.cos(p.azimuth)*(3200-1.6),p.axial,Math.sin(p.azimuth)*(3200-1.6));return camera.parent.worldToLocal(city.group.localToWorld(point)).toArray()},target)
  const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
  await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]});await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()});await xr.setAxes('left',0,-.45);await xr.settle(1200);await xr.setAxes('left',0,0)
  walked=await state();expect(Math.hypot((walked.azimuth-before.azimuth)*3200,walked.axial-before.axial)).toBeGreaterThan(1);expect(walked.mode).toBe('grounded');expect(walked.outing.status).toBe('active');expect(walked.outing.remaining).toBeLessThan(before.outing.remaining-.3)
  await xr.screenshot(info.outputPath('walking-approach.png'),{canvas:'canvas',metadata:true,timeout:5000})
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(2,{timeout:5000});await press(page,xr,'guide-cancel');await press(page,xr,'nav-home');await press(page,xr,'nav-places');await press(page,xr,'visit-park')
  await page.waitForFunction(()=>{const s=window.__spinward,p=window.__spinwardCity.getInteriorVisit('park');return s.outing.action===null&&Math.hypot((s.azimuth-p.azimuth)*3200,s.axial-p.axial)<.2})
  // Park paving is a visible foot finish (PlayerFootSurface), not a raised physical floor.
  visited=await state();await fs.writeFile(info.outputPath('park-visit.json'),JSON.stringify(visited,null,2));expect(visited.mode).toBe('grounded');expect(visited.ground).toBeCloseTo(0,2)
 }
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000})
 expect(errors).toEqual([]);await fs.writeFile(info.outputPath('guidance.json'),JSON.stringify({unavailable,gpu,diagnostics,origin,journeys,walked,visited,frames,errors},null,2))
})
