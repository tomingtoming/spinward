import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const [place,time] of [['shibuya','.42'],['omiya','.42'],['omiya','.9']])
test(`XR full resolution and adaptive distance: ${place} ${time}`,async({page,xr},info)=>{
  test.setTimeout(240000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),n=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return n})
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
  await page.addInitScript(()=>{const poll=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(poll);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(poll)})
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=${time}&place=${place}`)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
  // Hold only the policy output to compare identical camera poses. Cadence
  // feedback itself is exercised independently below and in the unit tests.
  await page.evaluate(()=>{
    window.__qaDetail=0
    const m=window.__spinwardMetro,original=m.setXRDetail.bind(m)
    m.setXRDetail=level=>original(window.__qaDetail??level)
  })
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  await page.waitForFunction(()=>{let n=0;window.__spinwardScene.traverse(o=>{if(o.motionController&&o.children.some(c=>c.type==='Group'))n++});return n===2})
  await xr.setControllerPose('left',{position:[-.35,.85,-.3],quaternion:[0,0,0,1]})
  await xr.setControllerPose('right',{position:[.35,.85,-.3],quaternion:[0,0,0,1]})
  const samples=[]
  for(const level of [0,2,0]){
    await page.evaluate(n=>{window.__qaDetail=n},level)
    await page.waitForFunction(n=>window.__spinward.metro.xrDetailLevel===n,level)
    await xr.settle(1000)
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)))
    for(const [view,pose] of [['street',[-.12,0,0]],['overhead',[.85,.7,0]]]){
      await xr.setHeadPose({position:[0,1.6,0],euler:pose});await xr.waitForFrames(10)
      const sample=await page.evaluate(()=>{
        const r=window.__spinwardRenderer,m=window.__spinwardMetro
        return {level:m.xrDetailLevel,scale:Number(r.domElement.dataset.xrScale),render:{...r.info.render},lost:r.getContext().isContextLost(),
          near:m.layers.map(l=>[...l.base.entries].filter(([,e])=>e.status==='resident').map(([id,e])=>[id,e.meshes.reduce((n,x)=>n+x.geometry.index.count,0)])),
          terrain:m.layers.map(l=>({band:l.base.sample.id,coarse:l.base.far.reduce((n,f)=>n+(f.coarseSelected??[]).filter(Boolean).length,0),
            indices:l.base.far.reduce((n,f)=>n+(f.mesh.name==='terrain'?f.mesh.geometry.drawRange.count:0),0)})),
          pose:{a:window.__spinward.azimuth,y:window.__spinward.axial,mode:window.__spinward.mode},collision:m.collision.stats}
      })
      expect(sample.scale).toBe(1);expect(sample.lost).toBe(false);expect(sample.terrain).toHaveLength(3)
      if(level===2)expect(sample.terrain.reduce((n,b)=>n+b.coarse,0)).toBeGreaterThan(0)
      const label=`${samples.length}-${level}-${view}`
      await xr.screenshot(info.outputPath(label+'.png'),{canvas:'canvas',metadata:true})
      samples.push({label,...sample})
    }
  }
  expect(samples[2].near).toEqual(samples[0].near)
  expect(samples[4].near).toEqual(samples[0].near)
  expect(samples[3].render.triangles).toBeLessThan(samples[1].render.triangles)
  for(const b of samples[4].terrain)expect(b.coarse).toBe(0)
  await page.evaluate(()=>{window.__qaDetail=null})
  await xr.endSession();await page.waitForFunction(()=>window.__spinward.xrDetail.active===false&&window.__spinward.metro.xrDetailLevel===0)
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('adaptive.json'),JSON.stringify({gpu,samples,errors},null,2))
})

test('XR cadence drives detail down, recovers, and resets across sessions',async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.addInitScript(()=>{
    // Synthetic cadence verifies the feedback wiring, not physical GPU speed.
    window.__qaStep=1000/36
    const install=()=>{
      if(!window.XRSession)return requestAnimationFrame(install)
      const p=window.XRSession.prototype,raf=p.requestAnimationFrame
      Object.defineProperty(p,'frameRate',{configurable:true,get:()=>72})
      p.requestAnimationFrame=function(callback){return raf.call(this,(time,frame)=>{
        window.__qaTime=(window.__qaTime??time)+(window.__qaStep??1000/72)
        callback(window.__qaTime,frame)
      })}
    };install()
  })
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest')
  await page.waitForFunction(()=>window.__spinward?.metro?.operational&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
  const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  await page.waitForFunction(()=>window.__spinward.xrDetail.level===2,null,{timeout:60000})
  const low=await page.evaluate(()=>({governor:window.__spinward.xrDetail,city:window.__spinward.metro.xrDetailLevel,scale:Number(window.__spinwardRenderer.domElement.dataset.xrScale)}))
  expect(low.city).toBe(2);expect(low.scale).toBe(1)
  await page.evaluate(()=>{window.__qaStep=1000/72})
  await page.waitForFunction(()=>window.__spinward.xrDetail.level===1,null,{timeout:60000})
  const recovery=await page.evaluate(()=>window.__spinward.xrDetail)
  expect(recovery.reason).toBe('recovery-trial')
  await xr.endSession();await page.waitForFunction(()=>window.__spinward.metro.xrDetailLevel===0&&!window.__spinward.xrDetail.active)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.waitForFrames(10)
  const reentry=await page.evaluate(()=>window.__spinward.xrDetail);expect(reentry.level).toBe(0)
  await page.waitForFunction(()=>{let n=0;window.__spinwardScene.traverse(o=>{if(o.motionController&&o.children.some(c=>c.type==='Group'))n++});return n===2})
  await xr.endSession();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('cadence.json'),JSON.stringify({gpu,low,recovery,reentry,errors},null,2))
})
