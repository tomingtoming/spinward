import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'

async function ready(page){
  await page.waitForFunction(()=>window.__metro?.ready,null,{timeout:120000})
  const gpu=await page.evaluate(()=>{const gl=window.__metro.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|Software|SwiftShader|llvmpipe/i)
  return gpu
}
async function details(page){
  await page.waitForFunction(()=>{const w=window.__metro,l=w.layers.get(w.selected);return l.base.ready&&l.walk.readyAt(w.walker.state.x,w.walker.state.y)&&l.stream.running===0&&[...l.stream.entries.values()].every(e=>!e.wanted||e.status==='resident')},null,{timeout:120000})
}
test('PC: all three real source strips fill their exact interior bounds',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/')
  const gpu=await ready(page);await page.waitForTimeout(1000)
  await page.screenshot({path:info.outputPath('whole-colony.png')})
  const data=await page.evaluate(()=>window.__metro.diagnostics())
  expect(Object.keys(data.layers)).toEqual(['south','central','north'])
  expect(await page.evaluate(()=>window.__metro.study.samples.map(s=>s.band))).toEqual([0,2,1])
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('overview.json'),JSON.stringify({gpu,data,errors},null,2))
})
for(const region of ['south','central','north'])test(`PC: ${region} source street, feet, walking and rotating jump`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?region='+region+'&walk=1')
  const gpu=await ready(page);await details(page)
  await page.waitForFunction(()=>window.__metro.body.view.group.userData.ready===true)
  await page.screenshot({path:info.outputPath(region+'-street.png')})
  const before=await page.evaluate(()=>({...window.__metro.walker.state}))
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW')
  await page.waitForFunction(p=>Math.hypot(window.__metro.walker.state.x-p.x,window.__metro.walker.state.y-p.y)>8,before,{timeout:15000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')
  const grounded=await page.evaluate(()=>window.__metro.walker.state.h)
  await page.keyboard.press('Space');await page.waitForFunction(()=>!window.__metro.walker.grounded)
  await page.waitForFunction(h=>window.__metro.walker.state.h>h+.5,grounded)
  await page.waitForFunction(()=>window.__metro.walker.grounded)
  const after=await page.evaluate(()=>window.__metro.walker.state)
  expect(Math.abs(after.h-grounded)).toBeLessThan(.2)
  await page.mouse.move(680,230);await page.mouse.down();await page.mouse.move(680,630,{steps:10});await page.mouse.up()
  await page.waitForTimeout(250);await page.screenshot({path:info.outputPath(region+'-feet.png')})
  await page.click('#night');await page.screenshot({path:info.outputPath(region+'-night.png')})
  const data=await page.evaluate(()=>window.__metro.diagnostics())
  expect(errors).toEqual([]);expect(data.layers[region].base.failures).toBe(0);expect(data.layers[region].walk.failures).toBe(0)
  await fs.writeFile(info.outputPath(region+'-probe.json'),JSON.stringify({gpu,before,after,data,errors},null,2))
})

test.describe('WebXR 0.3.0',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('VR: actual entry, tracked body, wrist daylight, controller walking and jump',async({page,xr},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?region=south&walk=1')
    const gpu=await ready(page);await details(page)
    await xr.enterVR();await xr.waitForFrames(5)
    expect(await page.evaluate(()=>window.__metro.renderer.xr.isPresenting)).toBe(true)
    // IWER 2.4.0 explicitly emulates grips; only this fixture supplies tracked
    // confidence. Keep the shared application body's emulated-pose guard intact.
    await page.evaluate(()=>{for(const source of window.__metro.renderer.xr.getSession().inputSources)if(source.gripSpace)source.gripSpace[IWER.P_SPACE].emulated=false})
    await xr.setHeadPose({position:[0,1.65,0],euler:[-.35,0,0]})
    await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.22,1.2,-.38],quaternion:[0,0,0,1]});await xr.waitForFrames(8)
    await xr.screenshot(info.outputPath('metro-vr-street.png'),{canvas:'canvas',metadata:true})
    expect(await page.evaluate(()=>window.__metro.body.view.group.userData.hands)).toEqual([true,true])
    const target=await page.evaluate(()=>window.__metro.wrist.trackingTarget('daylight',window.__metro.rig)),origin=[.2,1.35,-.15]
    await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(5)
    expect(await page.evaluate(()=>window.__metro.wrist.hover)).toBe('daylight')
    const day=await page.evaluate(()=>window.__metro.scene.background.getHexString())
    await xr.pressButton('right','trigger');await xr.waitForFrames(5)
    expect(await page.evaluate(()=>window.__metro.scene.background.getHexString())).not.toBe(day)
    await xr.screenshot(info.outputPath('metro-vr-wrist-night.png'),{canvas:'canvas',metadata:true})
    await xr.pressButton('right','trigger');await xr.waitForFrames(3)
    await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]})
    const before=await page.evaluate(()=>({...window.__metro.walker.state}))
    await xr.setAxes('left',0,-.8)
    await page.waitForFunction(p=>Math.hypot(window.__metro.walker.state.x-p.x,window.__metro.walker.state.y-p.y)>.75,before)
    await xr.setAxes('left',0,0);await xr.pressButton('right','a-button')
    await page.waitForFunction(()=>!window.__metro.walker.grounded);await page.waitForFunction(()=>window.__metro.walker.grounded)
    const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.endSession();expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('vr-probe.json'),JSON.stringify({gpu,diagnostic,app:await page.evaluate(()=>window.__metro.diagnostics()),errors},null,2))
  })
})
