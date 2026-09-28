import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const [place,time] of [['shibuya','.42'],['omiya','.42'],['omiya','.9']])test(`XR facade batches ${place} ${time}`,async({page,xr},info)=>{
 test.setTimeout(240000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/i.test(m.text()))errors.push(m.text())})
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.addInitScript(()=>{const poll=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(poll);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(poll)})
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=${time}&place=${place}`)
 await page.waitForFunction(()=>window.__spinward?.metro?.operational&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 await page.evaluate(()=>{
  const m=window.__spinwardMetro,o=m.setXRDetail.bind(m);m.setXRDetail=()=>o(2)
  const r=window.__spinwardRenderer,render=r.render.bind(r);window.__qaBatched=true
  // Compare identical LOD selection and shader programs. The control restores
  // only source draw submission, without changing a single recipe or pixel.
  r.render=(...args)=>{
   window.__qaRenderArgs=args
   const saved=[]
   if(!window.__qaBatched)for(const l of m.layers){
    const f=l.facade,b=f.batcher;f.group.autoUpdate=false
    for(const x of b.batches.values()){saved.push([x.mesh,x.mesh.visible]);x.mesh.visible=false}
    for(const s of b.sources){saved.push([s,s.visible]);s.visible=true}
   }
   const start=performance.now()
   try{return render(...args)}finally{
    window.__qaSubmit?.push(performance.now()-start)
    for(const [o,v] of saved)o.visible=v
    for(const l of m.layers)l.facade.group.autoUpdate=true
   }
  }
 })
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})
 expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 await page.waitForFunction(()=>{let n=0;window.__spinwardScene.traverse(o=>{if(o.motionController&&o.children.some(c=>c.type==='Group'))n++});return n===2})
 await xr.setControllerPose('left',{position:[-.35,.85,-.3],quaternion:[0,0,0,1]})
 await xr.setControllerPose('right',{position:[.35,.85,-.3],quaternion:[0,0,0,1]})
 await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)))
 // Allow the timed arrival card to leave before golden comparisons.
 await xr.waitForFrames(600,{timeout:30000})
 const samples=[]
 for(const [view,pose] of [['street',[-.12,0,0]],['turn',[-.12,1.2,0]],['overhead',[.85,.7,0]]]){
  await xr.setHeadPose({position:[0,1.6,0],euler:pose});await xr.waitForFrames(20)
  for(const batched of [false,true]){
   await page.evaluate(value=>{window.__qaBatched=value;window.__qaSubmit=[]},batched);await xr.waitForFrames(120)
   const state=await page.evaluate(()=>{
    const r=window.__spinwardRenderer,m=window.__spinwardMetro,a=window.__qaSubmit.sort((x,y)=>x-y)
    return{calls:r.info.render.calls,triangles:r.info.render.triangles,submit:{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]},scale:Number(r.domElement.dataset.xrScale),
     near:m.layers.map(l=>[...l.base.entries].filter(([,e])=>e.status==='resident').map(([id])=>id)),
     packed:m.layers.reduce((n,l)=>n+[...l.facade.batcher.batches.values()].filter(b=>b.mesh.visible).reduce((s,b)=>s+b.mesh.count,0),0),
     lost:r.getContext().isContextLost(),uploads:m.layers.reduce((n,l)=>n+l.facade.batcher.uploads,0)}
   })
   expect(state.scale).toBe(1);expect(state.lost).toBe(false)
   if(batched){expect(state.calls).toBeLessThan(samples.at(-1).calls);expect(state.near).toEqual(samples.at(-1).near)}
   const label=`${view}-${batched?'batched':'control'}`
   await xr.screenshot(info.outputPath(label+'.png'),{canvas:'canvas',metadata:true})
   samples.push({label,...state})
  }
 }
 // With a settled eye pose, buffers should not be repacked every frame.
 const uploads=await page.evaluate(()=>window.__spinwardMetro.layers.reduce((n,l)=>n+l.facade.batcher.uploads,0))
 await xr.waitForFrames(90)
 expect(await page.evaluate(()=>window.__spinwardMetro.layers.reduce((n,l)=>n+l.facade.batcher.uploads,0))).toBe(uploads)
 if(place==='omiya'&&time==='.42'){
  // Investigate a few-pixel edge difference between time-separated goldens.
  // Render both versions in one JS task using the exact same scene/cameras;
  // idle body motion and streamed LOD cannot advance between these captures.
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,1.2,0]});await xr.waitForFrames(20)
  const pair=await page.evaluate(()=>{
   const r=window.__spinwardRenderer,g=r.getContext(),layer=r.xr.getBaseLayer(),w=layer.framebufferWidth,h=layer.framebufferHeight
   const capture=()=>{
    const previous=g.getParameter(g.FRAMEBUFFER_BINDING),data=new Uint8Array(w*h*4)
    g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,data);g.bindFramebuffer(g.FRAMEBUFFER,previous)
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(w,h)
    for(let y=0;y<h;y++)pixels.data.set(data.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4)
    ctx.putImageData(pixels,0,0);return{data,url:canvas.toDataURL()}
   }
   window.__qaBatched=false;r.render(...window.__qaRenderArgs);const control=capture()
   window.__qaBatched=true;r.render(...window.__qaRenderArgs);const batched=capture()
   let changed=0,max=0,nonblack=0
   for(let i=0;i<control.data.length;i+=4){let d=0;for(let k=0;k<3;k++){d=Math.max(d,Math.abs(control.data[i+k]-batched.data[i+k]));nonblack+=control.data[i+k]>0?1:0}if(d)changed++;max=Math.max(max,d)}
   return{control:control.url,batched:batched.url,changed,max,nonblack,width:w,height:h}
  })
  expect(pair.nonblack).toBeGreaterThan(100000);expect(pair.changed).toBe(0)
  for(const name of ['control','batched'])await fs.writeFile(info.outputPath(`same-frame-${name}.png`),Buffer.from(pair[name].split(',')[1],'base64'))
  delete pair.control;delete pair.batched
  await fs.writeFile(info.outputPath('same-frame.json'),JSON.stringify(pair,null,2))
 }
 await xr.endSession();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('batches.json'),JSON.stringify({gpu,samples,errors},null,2))
 console.log(place,time,JSON.stringify(samples.map(({label,calls,triangles,submit})=>({label,calls,triangles,submit}))))
})
