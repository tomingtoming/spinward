import { test, expect } from 'playwright-webxr'
import { Matrix4, Quaternion, Vector3 } from 'three'
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
 const direction=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(matrix).sub(new Vector3(...right)).normalize()
 await xr.setControllerPose('right',{position:right,quaternion:new Quaternion().setFromUnitVectors(new Vector3(0,0,-1),direction).toArray()});await xr.settle(90)
 await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
 await xr.pressButton('right','trigger')
}
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('wrist places reach the supported observation deck and preserve its guard through head roll',async({page,xr},info)=>{
 const errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto('/?debug&metrics=off&lock=0&dpr=1&preset=izma&tier=quest&t=.42')
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardCity.group.getObjectByName('observation-deck')?.userData.asset==='blender')
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',leftPose);await xr.settle(180)
 await press(page,xr,'nav-places')
 const texture=await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.image.toDataURL('image/png'))
 await fs.writeFile(info.outputPath('deck-places-texture.png'),Buffer.from(texture.split(',')[1],'base64'))
 const wrist=await xr.screenshot(info.outputPath('deck-places-stereo.png'),{canvas:'canvas',metadata:true,timeout:5000});expect(wrist.sessionId).toBe(diagnostics.session.id)
 await press(page,xr,'visit-deck')
 await page.waitForFunction(()=>window.__spinward.groundHeight>58.4);await xr.settle(500)
 const probe=()=>page.evaluate(()=>{
  const w=window.__spinward,g=window.__spinwardCity.group.getObjectByName('observation-deck'),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  const target=g.localToWorld(g.position.clone().set(0,59,-10.5))
  return {ground:w.groundHeight,mode:w.mode,asset:g.userData.asset,matrix:g.matrix.elements,lod:g.children[0].levels.findIndex(l=>l.object.visible),projected:target.clone().project(camera).toArray(),tracking:camera.parent.worldToLocal(target).toArray(),seatAvailable:w.room.seats.some(s=>s.id==='observation-bench')}
 })
 const initial=await probe();expect(initial.ground).toBeCloseTo(58.5,2);expect(initial.mode).toBe('grounded');expect(initial.seatAvailable).toBe(true)
 await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]});await xr.setControllerPose('right',{position:[.4,.6,-.2],quaternion:[0,0,0,1]})
 for(const degrees of [0,25,-25]){
  const target=(await probe()).tracking
  const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()});await xr.settle(180)
  const state=await probe();expect(state.matrix).toEqual(initial.matrix);expect(state.lod).toBe(0);expect(state.ground).toBeCloseTo(58.5,2)
  expect(Math.abs(state.projected[0])).toBeLessThan(.9);expect(Math.abs(state.projected[1])).toBeLessThan(.9)
  const capture=await xr.screenshot(info.outputPath(`deck-roll-${degrees}.png`),{canvas:'canvas',metadata:true,timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960]);frames.push({degrees,state,capture})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end());await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000})
 expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('observation-deck.json'),JSON.stringify({gpu,diagnostics,initial,frames,errors},null,2))
})
