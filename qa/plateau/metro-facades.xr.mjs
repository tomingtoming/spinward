import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {readFileSync} from 'node:fs'
const expectedVersion=Number(process.env.SPINWARD_FACADE_VERSION??2)
const views=JSON.parse(readFileSync(new URL('./fixtures/metro-facade-views.json',import.meta.url))).views

async function boot(page,place,query=''){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info'),n=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return n})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&place='+place+query)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded')
  await page.waitForFunction(()=>window.__spinwardMetro.layers.some(l=>l.facade.design.parts.length>0)&&window.__spinwardMetro.layers.every(l=>l.stream.running===0))
  await page.waitForTimeout(1200)
  if(expectedVersion>=2)expect(await page.evaluate(()=>window.__spinwardMetro.kit.version)).toBe(expectedVersion)
  return gpu
}

async function sample(page){
  return page.evaluate(()=>new Promise(resolve=>{
    const times=[];let previous=performance.now(),started=previous
    const tick=now=>{
      times.push(now-previous);previous=now
      if(now-started<2500)return requestAnimationFrame(tick)
      times.sort((a,b)=>a-b)
      const m=window.__spinwardMetro,s=window.__spinward,r=window.__spinwardRenderer
      resolve({p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1),draw:r.info.render,memory:r.info.memory,
        pose:{a:s.azimuth,ax:s.axial,h:s.groundHeight},layers:m.layers.map(l=>({id:l.base.sample.id,facades:l.facade.diagnostics(),stream:{resident:l.stream.diagnostics().resident,recipeBytes:l.stream.diagnostics().recipeBytes,failures:l.stream.failures},base:l.base.diagnostics()}))})
    };requestAnimationFrame(tick)
  }))
}
function listen(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Shader|VALIDATE|TypeError|ReferenceError|Error:/.test(m.text()))errors.push(m.text())});return errors}

for(const place of ['shibuya','tokyo','nakano','ikebukuro'])test(`facades ${place}: source families, four headings and bounded residency`,async({page},info)=>{
  const errors=listen(page),gpu=await boot(page,place),captures=[]
  for(const [i,heading] of [0,Math.PI/2,Math.PI,Math.PI*1.5].entries()){
    await page.evaluate(h=>window.__spinwardOuting.face(h),heading);await page.waitForTimeout(300)
    await page.screenshot({path:info.outputPath(`street-${i}.png`)});captures.push({heading})
  }
  const performance=await sample(page)
  for(const l of performance.layers){expect(l.stream.failures).toBe(0);expect(l.stream.resident.length).toBeLessThanOrEqual(24);expect(l.stream.recipeBytes).toBeLessThanOrEqual(6*1024*1024)}
  const designs=await page.evaluate(()=>window.__spinwardMetro.layers.flatMap(l=>l.facade.design.buildings))
  if(expectedVersion>=2){expect(designs.some(b=>b.family==='office'||b.family==='commercial')).toBe(true);expect(new Set(designs.map(b=>b.style)).size).toBeGreaterThan(2)}
  if(expectedVersion>=2&&place==='tokyo'){
    // Visual-review regression: these readable middle-distance office walls
    // lost all windows when decoration-dependent bounds shrank after a refit.
    const levels=await page.evaluate(()=>['13101:bldg_ecdcca3c-022a-49d1-a79a-85627df7754d','13101:bldg_6887e14e-65da-4045-bba8-a6325383b970'].map(id=>({id,levels:window.__spinwardMetro.layers.flatMap(l=>l.facade.chunks.filter(c=>c.parts.some(p=>p.id===id)).map(c=>c.level))})))
    for(const b of levels){expect(b.levels.length).toBeGreaterThan(0);expect(b.levels.every(l=>l==='near'||l==='mid')).toBe(true)}
  }
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({gpu,captures,performance,families:designs.reduce((a,b)=>(a[b.family??'legacy']=(a[b.family??'legacy']??0)+1,a),{}),errors},null,2))
})

for(const view of views)test(`residential ${view.family}: close and middle LOD preserve the source elevation`,async({page},info)=>{
  const errors=listen(page),a=-(view.band*Math.PI*2/3+view.spawn[0]/3200)
  const gpu=await boot(page,'nakano',`&m=g&a=${a}&ax=${-view.spawn[1]}&gh=${view.ground}`)
  await page.evaluate(h=>window.__spinwardOuting.face(h),view.heading)
  // Real desktop look input: tilt up enough to show the upper dwelling floors.
  await page.mouse.move(640,480);await page.mouse.down({button:'right'});await page.mouse.move(640,view.family==='apartments'?290:410,{steps:8});await page.mouse.up({button:'right'})
  await page.waitForTimeout(300)
  const target=await page.evaluate(id=>window.__spinwardMetro.layers.flatMap(l=>l.facade.design.buildings).find(b=>b.id===id),view.id)
  expect(target).toBeDefined();if(expectedVersion>=2)expect(target.family).toBe(view.family)
  const probes=[]
  for(const lod of ['near','mid']){
    await page.evaluate(lod=>{for(const l of window.__spinwardMetro.layers){const f=l.facade;f.qaOriginalLOD??=f.updateLOD.bind(f);f.updateLOD=camera=>f.qaOriginalLOD(camera,lod)}},lod)
    await page.waitForTimeout(300)
    await page.screenshot({path:info.outputPath(`residential-${lod}.png`)})
    probes.push(await page.evaluate(id=>window.__spinwardMetro.layers.flatMap(l=>l.facade.design.parts.filter(p=>p.id===id).map(p=>({kind:p.kind,origin:p.origin,width:p.width,height:p.height,colour:p.colour}))),view.id))
  }
  expect(probes[0]).toEqual(probes[1]);expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('residential.json'),JSON.stringify({view,target,gpu,parts:probes[0].length,errors},null,2))
})

test.describe('stereo',()=>{
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('facades: stereo near/mid geometry and movement use WebXR 0.3.0',async({page,xr},info)=>{
  const errors=listen(page),gpu=await boot(page,'nakano')
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
  for(const yaw of [0,.7,1.4]){
    await xr.setHeadPose({position:[0,1.6,0],euler:[.15,yaw,0]});await xr.waitForFrames(4)
    await xr.screenshot(info.outputPath(`stereo-${yaw}.png`),{canvas:'canvas',metadata:true})
  }
  const before=await page.evaluate(()=>({a:window.__spinward.azimuth,y:window.__spinward.axial}))
  await xr.setControllerPose('left',{position:[-.3,1.1,-.3],quaternion:[0,0,0,1]})
  await xr.setControllerPose('right',{position:[.3,1.1,-.3],quaternion:[0,0,0,1]})
  await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,0]})
  await xr.waitForFrames(4)
  await xr.screenshot(info.outputPath('stereo-forward.png'),{canvas:'canvas',metadata:true})
  await xr.setAxes('left',0,-.65);await page.waitForTimeout(1500);await xr.setAxes('left',0,0)
  const moved=await page.evaluate(()=>({a:window.__spinward.azimuth,y:window.__spinward.axial}))
  expect(Math.hypot((moved.a-before.a)*3200,moved.y-before.y)).toBeGreaterThan(.2)
  await xr.endSession()
  const after=await sample(page);expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('xr.json'),JSON.stringify({gpu,diagnostics,before,moved,after,errors},null,2))
})
})
