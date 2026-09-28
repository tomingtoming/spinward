import {FRUSTUM_MODULE} from './xr-frustum-fixture.mjs'
import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const place of ['shibuya','omiya'])for(const day of [.42,.02])test(`Tight overview visuals ${place} ${day}`,async({page,xr},info)=>{
 test.setTimeout(240000)
 await page.route('**/qa-frustum.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:FRUSTUM_MODULE}))
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
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
 await page.evaluate(()=>{
  const r=window.__spinwardRenderer,draw=r.renderBufferDirect.bind(r)
  r.renderBufferDirect=(camera,scene,geometry,material,object,group)=>{
   if(window.__qaDrawRows&&object.isMesh)window.__qaDrawRows.push({name:object.name,parent:object.parent?.name,level:object.userData.level,triangles:Math.min(geometry.index?.count??geometry.attributes.position.count,geometry.drawRange.count)/3*(object.isInstancedMesh?object.count:1)})
   return draw(camera,scene,geometry,material,object,group)
  }
 })
 await page.evaluate(async()=>{const m=await import('/qa-frustum.js');window.__qaFrustumFactory=m.createFrustum})
 await page.evaluate(()=>{window.__qaSetOverview=mode=>{
   window.__spinwardScene.traverse(o=>{if(o.name==='overview-hierarchy'){
    if(!o.userData.qaTight){
     o.userData.qaTight=o.update
     const parts=o.children[1].children,frusta=[],matrix=o.matrixWorld.clone(),sphere=parts[0].geometry.boundingSphere.clone()
     o.userData.qaLoose=camera=>{
      const eyes=camera.isArrayCamera?camera.cameras:[camera]
      for(let i=0;i<eyes.length;i++){
       // Reuse the engine's frustum class through the live renderer helper.
       const f=frusta[i]??(frusta[i]=window.__qaFrustumFactory())
       f.setFromProjectionMatrix(matrix.multiplyMatrices(eyes[i].projectionMatrix,eyes[i].matrixWorldInverse))
      }
      let visible=0
      for(const p of parts){p.visible=true;sphere.copy(p.geometry.boundingSphere).applyMatrix4(p.matrixWorld);if(eyes.some((_,i)=>frusta[i].intersectsSphere(sphere)))visible++}
      o.children[1].visible=visible<=parts.length/2;o.children[0].visible=!o.children[1].visible
     }
    }
    o.update=mode==='normal'?o.userData.qaTight:o.userData.qaLoose
   }})

 }})
 await page.evaluate(()=>{const r=window.__spinwardRenderer,render=r.render.bind(r);r.render=(...args)=>{window.__qaArgs=args;return render(...args)}})
 for(const pose of [[-.12,0,0],[-.12,1.2,0],[-.12,2.6,0],[.9,0,0],[.8,1.2,0],[-.9,0,0],[.15,1.2,0,80],[-.5,0,0,80],[-.5,0,0,300]]){
  await xr.setHeadPose({euler:pose.slice(0,3),position:[0,pose[3]??1.6,0]});await xr.waitForFrames(3)
  const pair=await page.evaluate(()=>{
   const r=window.__spinwardRenderer,g=r.getContext(),layer=r.xr.getBaseLayer(),w=layer.framebufferWidth,h=layer.framebufferHeight
   const capture=()=>{const old=g.getParameter(g.FRAMEBUFFER_BINDING),data=new Uint8Array(w*h*4);g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,data);g.bindFramebuffer(g.FRAMEBUFFER,old);const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),p=ctx.createImageData(w,h);for(let y=0;y<h;y++)p.data.set(data.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4);ctx.putImageData(p,0,0);return{data,url:c.toDataURL(),draw:{...r.info.render}}}
   window.__qaSetOverview('disabled');r.info.reset();r.render(...window.__qaArgs);const before=capture();window.__qaSetOverview('normal');r.info.reset();window.__qaDrawRows=[];r.render(...window.__qaArgs);const after=capture()
   let changed=0,severe=0,max=0,sum=0;for(let i=0;i<before.data.length;i+=4){const d=Math.max(...[0,1,2].map(j=>Math.abs(before.data[i+j]-after.data[i+j])));if(d>0)changed++;if(d>3)severe++;max=Math.max(max,d);sum+=d}
   return{before:before.url,after:after.url,drawBefore:before.draw,drawAfter:after.draw,drawRows:window.__qaDrawRows,changed,severe,max,mean:sum/(w*h)}
  })
  for(const side of ['before','after'])await fs.writeFile(info.outputPath(`view-${pose[0]}-${pose[1]}-${pose[3]??1.6}-${side}.png`),Buffer.from(pair[side].split(',')[1],'base64'))
  expect(pair.changed).toBe(0)
  delete pair.before;delete pair.after;results.push({pose,...pair})
 }
 const profile=await page.evaluate(()=>({scale:Number(window.__spinwardRenderer.domElement.dataset.xrScale),log:window.__spinwardRenderer.capabilities.logarithmicDepthBuffer}))
 expect(profile).toEqual({scale:1,log:true});expect((await xr.diagnostics()).runtime.playwrightWebxrVersion).toBe('0.3.0')
 await fs.writeFile(info.outputPath('compare.json'),JSON.stringify({gpu,profile,results},null,2));console.log(place,day,JSON.stringify(results.map(({drawRows,...row})=>row)));expect(errors).toEqual([]);await xr.endSession()
})
