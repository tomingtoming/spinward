import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {readFileSync} from 'node:fs'
const views=JSON.parse(readFileSync(new URL('./fixtures/metro-facade-views.json',import.meta.url))).views
const apartment=views.find(v=>v.family==='apartments')
const house=views.find(v=>v.family==='house')
const shop=JSON.parse(readFileSync(new URL('./fixtures/metro-street-life-views.json',import.meta.url))).views[0]
async function boot(page,place,time,view){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info'),gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return gpu})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const pose=view?`&m=g&a=${-(view.band*Math.PI*2/3+view.spawn[0]/3200)}&ax=${-view.spawn[1]}&gh=${view.ground}`:''
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=${time}&place=${place}${pose}`)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded')
  await page.waitForFunction(()=>window.__spinwardMetro.layers.some(l=>l.facade.design.parts.length>0)&&window.__spinwardMetro.layers.every(l=>l.stream.running===0))
  expect(await page.evaluate(()=>window.__spinwardMetro.kit.version)).toBe(3)
  if(view){await page.evaluate(h=>window.__spinwardOuting.face(h),view.heading);await page.mouse.move(640,480);await page.mouse.down({button:'right'});await page.mouse.move(640,view.family==='house'?510:view.family==='shop'?425:290,{steps:8});await page.mouse.up({button:'right'})}
  else await page.evaluate(()=>window.__spinwardOuting.face(0))
  await page.waitForTimeout(600);return gpu
}
const listen=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Shader|VALIDATE|TypeError|ReferenceError|Error:/.test(m.text()))errors.push(m.text())});return errors}
for(const place of ['apartments','house','shop','shibuya','tokyo'])test(`${place}: day and night show source use and bounded contacts`,async({page},info)=>{
  const errors=listen(page),captures=[]
  for(const [label,time] of [['day',.48],['night',.01]]){
    const view=place==='apartments'?apartment:place==='house'?house:place==='shop'?shop:null
    const gpu=await boot(page,view?(view.family==='shop'?'shibuya':'nakano'):place,time,view)
    await page.screenshot({path:info.outputPath(label+'.png')})
    const probe=await page.evaluate(id=>{
      const m=window.__spinwardMetro,parts=m.layers.flatMap(l=>l.facade.design.parts),target=id?parts.filter(p=>p.id===id):parts
      const total=parts.length,byPurpose=target.reduce((a,p)=>(a[p.purpose]=(a[p.purpose]??0)+1,a),{})
      const contactParts=m.facadeContacts.parts,times=[]
      for(let i=0;i<12;i++){const start=performance.now();m.collision.setDecorations(i%2?contactParts:[]);times.push(performance.now()-start)}
      m.collision.setDecorations(contactParts)
      return {total,byPurpose,daylight:m.daylight,lights:target.filter(p=>p.light).map(p=>({family:p.family,purpose:p.purpose,floor:p.floor,bay:p.bay,...p.light})),contacts:{...m.facadeContacts.stats,reindexMs:times},
        streams:m.layers.map(l=>({id:l.base.sample.id,failures:l.stream.failures,bytes:l.stream.diagnostics().recipeBytes,resident:l.stream.diagnostics().resident.length})),draw:window.__spinwardRenderer.info.render}
    },view?.id??null)
    expect(probe.contacts.truncated).toBe(0);expect(probe.contacts.active).toBeLessThanOrEqual(512)
    for(const s of probe.streams){expect(s.failures).toBe(0);expect(s.bytes).toBeLessThanOrEqual(6*1024*1024);expect(s.resident).toBeLessThanOrEqual(24)}
    if(place==='apartments'){expect(probe.byPurpose.balcony).toBeGreaterThan(0);expect(new Set(probe.lights.filter(p=>p.purpose==='room').map(p=>p.colour)).size).toBeGreaterThanOrEqual(2)}
    if(place==='shop'){expect(probe.byPurpose['shop-sign']).toBeGreaterThan(0);expect(probe.byPurpose['shop-awning']).toBeGreaterThan(0)}
    if(place==='house')expect(probe.byPurpose['entry-apron']).toBeGreaterThan(0)
    if(label==='day')expect(probe.daylight).toBeGreaterThan(.8);else expect(probe.daylight).toBeLessThan(.2)
    captures.push({label,gpu,probe})
  }
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('life.json'),JSON.stringify({captures,errors},null,2))
})
test('certified balcony supports a real player jump and landing',async({page},info)=>{
  const errors=listen(page)
  await boot(page,'nakano',.48,apartment)
  const balcony=await page.evaluate(id=>window.__spinwardMetro.layers.flatMap(l=>l.facade.design.parts).filter(p=>p.id===id&&p.kind==='balcony').sort((a,b)=>a.origin[2]-b.origin[2])[0],apartment.id)
  const view={...apartment,spawn:[balcony.origin[0]+balcony.u[1]*.46,balcony.origin[1]-balcony.u[0]*.46],ground:balcony.origin[2]}
  const gpu=await boot(page,'nakano',.48,view)
  const standing=await page.evaluate(()=>({h:window.__spinward.groundHeight,contacts:window.__spinwardMetro.facadeContacts.stats.active}))
  expect(standing.contacts).toBeGreaterThan(0)
  expect(Math.abs(standing.h-view.ground)).toBeLessThan(.08)
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__spinward.mode==='free-fly')
  await page.waitForFunction(h=>3200-window.__spinward.radial>h+.6,view.ground)
  await page.waitForFunction(()=>window.__spinward.mode==='grounded')
  const landed=await page.evaluate(()=>({h:window.__spinward.groundHeight,a:window.__spinward.azimuth,y:window.__spinward.axial}))
  expect(Math.abs(landed.h-view.ground)).toBeLessThan(.08)
  await page.screenshot({path:info.outputPath('balcony-landing.png')});expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('landing.json'),JSON.stringify({gpu,view,standing,landed,errors},null,2))
})
test.describe('stereo night',()=>{
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('balconies and household lights remain attached through head and hand movement',async({page,xr},info)=>{
  const errors=listen(page),gpu=await boot(page,'nakano',.01,apartment)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  expect((await xr.diagnostics()).runtime.playwrightWebxrVersion).toBe('0.3.0')
  for(const yaw of [0,.5]){await xr.setHeadPose({position:[0,1.6,0],euler:[.18,yaw,0]});await xr.waitForFrames(4);await xr.screenshot(info.outputPath(`night-${yaw}.png`),{canvas:'canvas',metadata:true})}
  const before=await page.evaluate(()=>({a:window.__spinward.azimuth,y:window.__spinward.axial}))
  await xr.setAxes('left',0,-.5);await page.waitForTimeout(1000);await xr.setAxes('left',0,0)
  const after=await page.evaluate(()=>({a:window.__spinward.azimuth,y:window.__spinward.axial}))
  expect(Math.hypot((after.a-before.a)*3200,after.y-before.y)).toBeGreaterThan(.2)
  await xr.endSession();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('xr.json'),JSON.stringify({gpu,before,after,errors},null,2))
})
})
