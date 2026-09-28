import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const place of ['shibuya','omiya'])test(`XR CPU profile ${place}`,async({page,xr},info)=>{
 test.setTimeout(180000)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=.42&place=${place}`)
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.stream.running===0&&l.base.running===0&&l.base.farStream?.running===0&&l.lowrise?.running===0))
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]});await xr.waitForFrames(120)
 const gpu=await page.evaluate(()=>{const r=window.__spinwardRenderer,g=r.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),draw:{...r.info.render},lights:window.__spinwardScene.children.length}})
 expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|software/i)
 const session=await page.context().newCDPSession(page)
 await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:200});await session.send('Profiler.start')
 await xr.waitForFrames(300,{timeout:30000})
 const {profile}=await session.send('Profiler.stop');await session.detach()
 await fs.writeFile(info.outputPath('cpu.cpuprofile'),JSON.stringify(profile))
 await fs.writeFile(info.outputPath('state.json'),JSON.stringify(gpu,null,2))
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map()
 for(let i=0;i<profile.samples.length;i++){
  const n=nodes.get(profile.samples[i]),f=n.callFrame,key=`${f.functionName||'(anonymous)'} ${f.url.split('/').at(-1)}:${f.lineNumber+1}`
  totals.set(key,(totals.get(key)??0)+profile.timeDeltas[i]/1000)
 }
 console.log(place,JSON.stringify([...totals].sort((a,b)=>b[1]-a[1]).slice(0,35)))
 await xr.endSession()
})
