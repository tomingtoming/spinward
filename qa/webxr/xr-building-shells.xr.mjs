import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const place of ['shibuya','omiya'])for(const day of [.42,.02])test(`Certified building shells ${place} ${day}`,async({page,xr},info)=>{
 test.setTimeout(240000)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.addInitScript(()=>{
  const freeze=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(freeze);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(freeze)
 })
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=${day}&place=${place}&depth=log`)
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)))
 await page.evaluate(()=>{const m=window.__spinwardMetro,o=m.setXRDetail.bind(m);m.setXRDetail=()=>o(2)})
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]});await xr.waitForFrames(180)
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),timer:!!g.getExtension('EXT_disjoint_timer_query_webgl2')}})
 expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|software/i);expect(gpu.timer).toBe(true)
 const results=[]
 const certified=await page.evaluate(()=>{
  const rows=[]
  window.__spinwardScene.traverse(o=>{if(o.userData.shellCulling){
   const callback=o.onBeforeRender;o.onBeforeRender=function(...args){callback.apply(this,args);if(window.__qaDisableShell)o.userData.shellCulling.value=0}
   const mask=o.geometry.attributes.closedShell.array
   rows.push({level:o.userData.level,vertices:mask.length,certified:mask.reduce((s,v)=>s+v,0)})
  }});return rows
 })
 expect(certified.length).toBeGreaterThan(0)
 await page.evaluate(()=>{const r=window.__spinwardRenderer,render=r.render.bind(r);r.render=(...args)=>{window.__qaArgs=args;return render(...args)}})
 for(const pose of [[-.12,0,0],[-.12,1.2,0],[-.12,2.6,0],[.9,0,0],[.8,1.2,0],[-.9,0,0],[.15,1.2,0,80],[-.5,0,0,80],[-.5,0,0,300]]){
  await xr.setHeadPose({euler:pose.slice(0,3),position:[0,pose[3]??1.6,0]});await xr.waitForFrames(3)
  const pair=await page.evaluate(()=>{
   const r=window.__spinwardRenderer,g=r.getContext(),layer=r.xr.getBaseLayer(),w=layer.framebufferWidth,h=layer.framebufferHeight
   const capture=()=>{const old=g.getParameter(g.FRAMEBUFFER_BINDING),data=new Uint8Array(w*h*4);g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,data);g.bindFramebuffer(g.FRAMEBUFFER,old);const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),p=ctx.createImageData(w,h);for(let y=0;y<h;y++)p.data.set(data.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4);ctx.putImageData(p,0,0);return{data,url:c.toDataURL()}}
   window.__qaDisableShell=true;r.render(...window.__qaArgs);const before=capture();window.__qaDisableShell=false;r.render(...window.__qaArgs);const after=capture()
   let changed=0,severe=0,max=0,sum=0;for(let i=0;i<before.data.length;i+=4){const d=Math.max(...[0,1,2].map(j=>Math.abs(before.data[i+j]-after.data[i+j])));if(d>0)changed++;if(d>3)severe++;max=Math.max(max,d);sum+=d}
   return{before:before.url,after:after.url,changed,severe,max,mean:sum/(w*h)}
  })
  for(const side of ['before','after'])await fs.writeFile(info.outputPath(`view-${pose[0]}-${pose[1]}-${pose[3]??1.6}-${side}.png`),Buffer.from(pair[side].split(',')[1],'base64'))
  expect(pair.changed).toBe(0)
  delete pair.before;delete pair.after;results.push({pose,...pair})
 }
 const profile=await page.evaluate(()=>({scale:Number(window.__spinwardRenderer.domElement.dataset.xrScale),log:window.__spinwardRenderer.capabilities.logarithmicDepthBuffer}))
 expect(profile).toEqual({scale:1,log:true});expect((await xr.diagnostics()).runtime.playwrightWebxrVersion).toBe('0.3.0')
 await fs.writeFile(info.outputPath('compare.json'),JSON.stringify({gpu,profile,certified,results},null,2));console.log(place,day,JSON.stringify(results));await xr.endSession()
})
