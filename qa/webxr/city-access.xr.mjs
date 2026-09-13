import { test, expect } from 'playwright-webxr'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'
const leftPose={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()}
const right=[.22,1.38,-.2]
async function press(page,xr,id){
 const p=await page.evaluate(id=>{
  const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
  if(!b)throw Error('Missing target '+id)
  const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  return {u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}
 },id)
 const matrix=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
 const target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(matrix).toArray()
 await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)});await xr.waitForFrames(2,{timeout:5000})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
 await xr.pressButton('right','trigger')
}
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('wrist apartment visit keeps the shared entrance accessible after moving the room upstairs',async({page,xr},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
 await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',leftPose);await xr.waitForFrames(2,{timeout:5000})
 await press(page,xr,'nav-places');await press(page,xr,'visit-apartment')
 await page.waitForFunction(()=>Math.abs(window.__spinward.azimuth-.08947172079345704)<.001&&window.__spinward.groundHeight<.2)
 await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]});await xr.setControllerPose('right',{position:[.4,.6,-.2],quaternion:[0,0,0,1]})
 await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,0]});const before=await page.evaluate(()=>window.__spinward.axial)
 await xr.setAxes('left',0,-.5);await xr.settle(800);await xr.setAxes('left',0,0)
 const after=await page.evaluate(()=>({ax:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode}))
 expect(after.ax-before).toBeGreaterThan(.2);expect(after.mode).toBe('grounded')
 const capture=await xr.screenshot(info.outputPath('apartment-entry.png'),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id)
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000})
 expect(errors).toEqual([]);await fs.writeFile(info.outputPath('apartment-entry.json'),JSON.stringify({gpu,diagnostics,before,after,capture,errors},null,2))
})

test('upstairs room and curved neighborhood retain their shapes under stereo head roll',async({page,xr},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const frames=[]
 for(const [name,a,ax,h,da,dy]of [['room',.08947172079345704-1.85/3200,-207.49,3.473,-1,3],['curve',.2460914245312005,496.2,.34,30,5]]){
  const eye=new Vector3(Math.cos(a)*(3200-h-1.8),ax,Math.sin(a)*(3200-h-1.8)),target=new Vector3(Math.cos(a+da/3200)*(3200-h-1.5),ax+dy,Math.sin(a+da/3200)*(3200-h-1.5))
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,new Vector3(-Math.cos(a),0,-Math.sin(a))))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${a}&ax=${ax}&gh=${h}&q=${q.toArray()}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.buildings.modules);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();const diagnostics=await xr.diagnostics()
  for(const roll of [0,20,-20]){
   await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,roll*Math.PI/180]});await xr.waitForFrames(2,{timeout:5000})
   const s=await page.evaluate(()=>({h:window.__spinward.groundHeight,mode:window.__spinward.mode,street:window.__spinwardCity.curvedNeighborhood.group.userData}))
   expect(s.mode).toBe('grounded');expect(Math.abs(s.h-h)).toBeLessThan(.1);expect(s.street.buildings).toBe(8)
   const capture=await xr.screenshot(info.outputPath(`${name}-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);frames.push({name,roll,s,capture})
  }
  const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000})
 }
 expect(errors).toEqual([]);await fs.writeFile(info.outputPath('city-access-stereo.json'),JSON.stringify({gpu,frames,errors},null,2))
})
