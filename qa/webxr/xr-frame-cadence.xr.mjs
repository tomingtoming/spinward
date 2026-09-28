import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})

test('wrist FPS reports 10 Hz callback cadence rather than the 20 Hz physics cap',async({page,xr},info)=>{
 test.setTimeout(180000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.addInitScript(()=>{
  const install=()=>{
   if(!window.XRSession)return requestAnimationFrame(install)
   const request=XRSession.prototype.requestAnimationFrame
   XRSession.prototype.requestAnimationFrame=function(callback){return request.call(this,(time,frame)=>{
    // Multiple callbacks (the app and waitForFrames) share one XR frame.
    // Advance the synthetic clock once per frame, not once per subscriber.
    if(window.__qaCadenceStep){
     if(window.__qaNativeTime!==time){window.__qaTime=(window.__qaTime??time)+window.__qaCadenceStep;window.__qaNativeTime=time}
     time=window.__qaTime
    }
    callback(time,frame)
   })}
  };install()
 })
 await page.goto('/?city=tokyo&preset=izma&place=shibuya&debug&metrics=off&lock=0&tier=quest')
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})
 expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 expect((await xr.diagnostics()).runtime.playwrightWebxrVersion).toBe('0.3.0')
 await xr.waitForFrames(30)
 await page.evaluate(()=>window.__qaCadenceStep=100)
 await xr.waitForFrames(40)
 const slow=await page.evaluate(()=>window.__spinwardWatch.snapshot.fps)
 expect(slow).toBeCloseTo(10,4)
 await page.evaluate(()=>window.__qaCadenceStep=1000/72)
 await xr.waitForFrames(90)
 const normal=await page.evaluate(()=>window.__spinwardWatch.snapshot.fps)
 expect(normal).toBeCloseTo(72,4)
 await xr.endSession();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('cadence.json'),JSON.stringify({gpu,synthetic:true,slow,normal,errors},null,2))
})
