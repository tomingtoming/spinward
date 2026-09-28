import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const place of ['shibuya','omiya'])test(`XR cost isolation ${place}`,async({page,xr},info)=>{
 test.setTimeout(240000)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.addInitScript(()=>{
  const install=()=>{
   if(!window.XRSession)return requestAnimationFrame(install)
   const original=XRSession.prototype.requestAnimationFrame
   XRSession.prototype.requestAnimationFrame=function(callback){return original.call(this,(time,frame)=>{
    const start=performance.now(),renders=window.__qaRenderSerial??0;try{callback(time,frame)}finally{if(window.__qaCPU&&(window.__qaRenderSerial??0)>renders)window.__qaCPU.push(performance.now()-start)}
   })}
  };install()
  const freeze=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(freeze);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(freeze)
 })
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=.42&place=${place}`)
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)))
 await page.evaluate(()=>{const m=window.__spinwardMetro,o=m.setXRDetail.bind(m);m.setXRDetail=()=>o(2)})
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]});await xr.settle(1000)
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),timer:!!g.getExtension('EXT_disjoint_timer_query_webgl2')}})
 expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|software/i)
 const samples=[]
 for(const mode of ['normal','no-facades','no-overview','no-city','normal']){
  await page.evaluate(mode=>{
   const m=window.__spinwardMetro
   window.__qaMode=mode
   if(!window.__qaOriginalRender){
    const r=window.__spinwardRenderer;window.__qaOriginalRender=r.render.bind(r)
    r.render=(...args)=>{
     const mode=window.__qaMode,m=window.__spinwardMetro,saved=[]
     const hide=o=>{saved.push([o,o.visible]);o.visible=false}
     if(mode==='no-facades')for(const l of m.layers)hide(l.facade.group)
     if(mode==='no-overview')for(const l of m.layers)for(const f of l.base.far)hide(f.mesh)
     if(mode==='no-city')hide(m.group)
     const g=r.getContext(),ext=g.getExtension('EXT_disjoint_timer_query_webgl2')
     window.__qaQueries??=[]
     for(const q of [...window.__qaQueries])if(g.getQueryParameter(q,g.QUERY_RESULT_AVAILABLE)){
      if(!g.getParameter(ext.GPU_DISJOINT_EXT))window.__qaGPU?.push(g.getQueryParameter(q,g.QUERY_RESULT)/1e6)
      g.deleteQuery(q);window.__qaQueries.splice(window.__qaQueries.indexOf(q),1)
     }
     const query=ext&&window.__qaQueries.length<10?g.createQuery():null
     if(query)g.beginQuery(ext.TIME_ELAPSED_EXT,query)
     const start=performance.now();try{return window.__qaOriginalRender(...args)}finally{
      window.__qaRenderSerial=(window.__qaRenderSerial??0)+1
      if(query){g.endQuery(ext.TIME_ELAPSED_EXT);window.__qaQueries.push(query)}
      window.__qaRender?.push(performance.now()-start);for(const [o,v] of saved)o.visible=v
     }
    }
   }
  },mode)
  await xr.waitForFrames(15);await page.evaluate(()=>{window.__qaCPU=[];window.__qaRender=[];window.__qaGPU=[]})
  await xr.waitForFrames(150)
  samples.push(await page.evaluate(()=>{
   const stats=a=>{a.sort((x,y)=>x-y);return{n:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]}}
   return{mode:window.__qaMode,cpu:stats(window.__qaCPU),submit:stats(window.__qaRender),gpu:stats(window.__qaGPU),draw:{...window.__spinwardRenderer.info.render},detail:window.__spinward.xrDetail}
  }))
 }
 await fs.writeFile(info.outputPath('cost.json'),JSON.stringify({gpu,samples},null,2));console.log(place,JSON.stringify(samples))
 await xr.endSession()
})
