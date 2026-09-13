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
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('wrist Garden street directions preserve position and Go now reaches its supported footway',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 await page.goto('about:blank');const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=.23313371027541227&ax=464.84167035358854&gh=.34')
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardOuting?.destinations.has('guide-garden'));await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();const diagnostics=await xr.diagnostics()
 expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(2,{timeout:5000})
 const state=()=>page.evaluate(()=>({azimuth:window.__spinward.azimuth,axial:window.__spinward.axial,h:window.__spinward.groundHeight,outing:window.__spinward.outing,mode:window.__spinward.mode}))
 const before=await state();await press(page,xr,'nav-places');await press(page,xr,'nav-outing');await press(page,xr,'guide-garden')
 await page.waitForFunction(()=>window.__spinward.outing.action==='guide-garden'&&window.__spinward.outing.detail.includes('on foot'))
 const guided=await state();expect(guided.outing.detail).toContain(`${Math.ceil(guided.outing.remaining)} m on foot`);expect(Math.hypot((guided.azimuth-before.azimuth)*3200,guided.axial-before.axial)).toBeLessThan(.15)
 const route=await page.evaluate(()=>window.__spinwardOuting.journey.points);expect(route.some(p=>p.curvedWalk)).toBe(true)
 const texture=await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.image.toDataURL('image/png'));await fs.writeFile(info.outputPath('garden-directions-texture.png'),Buffer.from(texture.split(',')[1],'base64'))
 for(const roll of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,roll*Math.PI/180]});await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
  const capture=await xr.screenshot(info.outputPath(`garden-directions-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000});expect(capture.sessionId).toBe(diagnostics.session.id);frames.push(capture)
 }
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.waitForFrames(2,{timeout:5000});await press(page,xr,'guide-cancel');await press(page,xr,'nav-home');await press(page,xr,'nav-places')
 await xr.screenshot(info.outputPath('garden-places.png'),{canvas:'canvas',metadata:true,timeout:5000});await press(page,xr,'visit-garden')
 await page.waitForFunction(()=>{const s=window.__spinward,p=window.__spinwardCity.getInteriorVisit('garden');return s.outing.action===null&&Math.hypot((s.azimuth-p.azimuth)*3200,s.axial-p.axial)<.2&&Math.abs(s.groundHeight-.34)<.03})
 const visited=await state();expect(Math.hypot((visited.azimuth-before.azimuth)*3200,visited.axial-before.axial)).toBeGreaterThan(30)
 await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]});await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,0]});await xr.setAxes('left',0,-.5);await xr.settle(600);await xr.setAxes('left',0,0)
 const moved=await state();expect(Math.hypot((moved.azimuth-visited.azimuth)*3200,moved.axial-visited.axial)).toBeGreaterThan(.2);expect(moved.mode).toBe('grounded');expect(moved.h).toBeCloseTo(.34,2)
 await xr.screenshot(info.outputPath('garden-visited.png'),{canvas:'canvas',metadata:true,timeout:5000})
 const cursor=await xr.sessionCursor();await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('garden.json'),JSON.stringify({gpu,diagnostics,before,guided,route,visited,moved,frames,errors},null,2))
})
