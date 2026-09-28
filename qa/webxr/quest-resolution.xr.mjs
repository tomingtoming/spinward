import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

// Synthetic Quest UA exercises detection without forcing the city quality tier.
// IWER verifies allocation arguments, not native headset clarity or frame time.
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960},
  userAgent:'Mozilla/5.0 (X11; Linux aarch64; Quest 3S) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0.0.0.0 Chrome/136.0.0.0 Safari/537.36'})

for(const [label,query,scale] of [['default','',1],['previous','&xrScale=0.7',.7],['native','&xrScale=1',1]])
test(`Quest resolution ${label}: allocation, city budget and reentry`,async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),n=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return n})
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
  await page.addInitScript(()=>{
    window.__qaLayerOptions=[]
    const observe=()=>{
      if(!window.XRWebGLLayer)return requestAnimationFrame(observe)
      const Layer=window.XRWebGLLayer
      window.XRWebGLLayer=new Proxy(Layer,{construct(Target,args){window.__qaLayerOptions.push({...args[2]});return Reflect.construct(Target,args)}})
    }
    observe()
  })
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&t=.42'+query)
  await page.waitForFunction(()=>window.__spinward?.metro?.operational&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
  const probe=()=>page.evaluate(()=>{
    const r=window.__spinwardRenderer,b=r.xr.getBaseLayer()
    return{profile:r.domElement.dataset.xrProfile,scale:Number(r.domElement.dataset.xrScale),aa:r.getContext().getContextAttributes().antialias,
      foveation:r.xr.getFoveation(),lost:r.getContext().isContextLost(),city:window.__spinwardMetro.renderBudget,
      layerOptions:window.__qaLayerOptions,framebuffer:[b?.framebufferWidth,b?.framebufferHeight]}
  })
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.waitForFrames(12)
  // Observe the normal connected-controller lifecycle. Ending before the
  // asynchronous Three controller model arrives is a separate loader race.
  await page.waitForFunction(()=>{let ready=0;window.__spinwardScene.traverse(o=>{if(o.motionController&&o.children.some(c=>c.type==='Group'))ready++});return ready===2})
  const entered=await probe()
  expect(entered.profile).toBe('standalone');expect(entered.scale).toBe(scale);expect(entered.aa).toBe(false)
  expect(entered.city.tier).toBe('quest');expect(entered.city.batchFacades).toBe(true);expect(entered.city.flatOpenings).toBe(true);expect(entered.foveation).toBe(1)
  expect(entered.layerOptions.at(-1).framebufferScaleFactor).toBe(scale);expect(entered.lost).toBe(false)
  await xr.screenshot(info.outputPath('entry.png'),{canvas:'canvas',metadata:true})
  await xr.endSession();await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.waitForFrames(12)
  await page.waitForFunction(()=>{let ready=0;window.__spinwardScene.traverse(o=>{if(o.motionController&&o.children.some(c=>c.type==='Group'))ready++});return ready===2})
  const reentered=await probe();expect(reentered.lost).toBe(false);expect(reentered.layerOptions.at(-1).framebufferScaleFactor).toBe(scale)
  await xr.endSession();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('resolution.json'),JSON.stringify({gpu,entered,reentered,errors},null,2))
})
