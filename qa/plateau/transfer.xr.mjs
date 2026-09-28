import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

async function ready(page){
  await page.goto('/');await page.waitForFunction(()=>window.__plateau?.rendered)
  const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
test('three real cities: layout, curvature, overview, and responsive controls',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText))
  const gpu=await ready(page),captures=[]
  for(const id of ['tokyo','tama','azumino']){
    await page.locator(`[data-region=${id}]`).click()
    await expect(page.locator(`[data-region=${id}]`)).toHaveAttribute('aria-pressed','true')
    await page.waitForFunction(id=>window.__plateau.state.selected===id,id)
    const visibility=await page.evaluate(()=>window.__plateau.groups.filter(g=>g.visible).map(g=>g.name));expect(visibility).toEqual([id])
    await page.screenshot({path:info.outputPath(id+'-flat.png')});captures.push(id+'-flat.png')
  }
  await page.locator('[data-mode=curved]').click()
  const curve=await page.evaluate(()=>{const w=window.__plateau,s=w.study.samples[2],g=w.groups[2].getObjectByName('terrain').geometry.attributes.position.array;let error=0;for(let i=0;i<g.length;i+=3){const r=Math.hypot(g[i],g[i+1]-w.study.radius);if(!Number.isFinite(r))throw Error('Invalid curvature');error=Math.max(error,Math.abs(r-w.study.radius))}return{mode:w.state.mode,error,relief:s.reliefM}})
  expect(curve.mode).toBe('curved');expect(curve.error).toBeLessThan(17)
  await page.screenshot({path:info.outputPath('azumino-curved.png')})
  await page.locator('[data-mode=colony]').click()
  expect(await page.evaluate(()=>window.__plateau.groups.every(g=>g.visible))).toBe(true)
  await expect(page.locator('#character')).toContainText('未転写')
  await page.screenshot({path:info.outputPath('colony.png')})
  await page.setViewportSize({width:390,height:844});await page.locator('[data-mode=flat]').click()
  await page.screenshot({path:info.outputPath('mobile.png')})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390)
  await expect(page.locator('#hint')).toContainText('2本指')
  const projected=await page.evaluate(()=>{const w=window.__plateau,g=w.groups[2].getObjectByName('terrain').geometry.attributes.position,out=[];for(let i=0;i<g.count;i++){const p=w.camera.position.clone().fromBufferAttribute(g,i).project(w.camera);out.push(Math.abs(p.x),Math.abs(p.y))}return Math.max(...out)})
  expect(projected,'whole sample stays inside portrait viewport').toBeLessThan(.98)
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('desktop.json'),JSON.stringify({gpu,captures,curve,errors},null,2))
})

test.describe('stereo tabletop',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('actual VR entry, three source samples, trigger navigation, head roll and return',async({page,xr},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await ready(page)
    await xr.enterVR();await xr.setHeadPose({position:[0,1.6,0],euler:[-.36,0,0]});await xr.waitForFrames(3)
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostics.rendering.views.length).toBe(2)
    const captures=[]
    for(const id of ['tokyo','tama','azumino']){
      expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe(id)
      await xr.waitForFrames(3);captures.push(await xr.screenshot(info.outputPath(id+'-stereo.png'),{canvas:'canvas',metadata:true}))
      await xr.pressButton('right','trigger');await xr.waitForFrames(3)
    }
    expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe('tokyo')
    const before=await page.evaluate(()=>window.__plateau.groups[0].matrixWorld.elements.slice())
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.36,0,.35]});await xr.waitForFrames(3)
    expect(await page.evaluate(()=>window.__plateau.groups[0].matrixWorld.elements.slice())).toEqual(before)
    captures.push(await xr.screenshot(info.outputPath('roll-stereo.png'),{canvas:'canvas',metadata:true}))
    await xr.endSession();expect(await xr.sessionMode()).toBeNull()
    await page.locator('[data-region=tama]').click();expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe('tama')
    expect(errors).toEqual([]);await fs.writeFile(info.outputPath('xr.json'),JSON.stringify({gpu,diagnostics,captures,errors},null,2))
  })
})
