import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {Matrix4,Quaternion,Vector3} from 'three'
const views=JSON.parse(readFileSync(process.env.SPINWARD_STATION_VIEWS??new URL('./fixtures/metro-station-views.json',import.meta.url),'utf8'))
test.use({viewport:{width:1440,height:960}})

async function boot(page,v,phase=.42){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return renderer})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...v.at),new Vector3(...v.aim),new Vector3(...v.up)))
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&m=f&rpm=0&p=${v.at}&q=${q.toArray()}&t=${phase}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(id=>window.__spinward?.metro?.ready&&!window.__spinward.regional.pendingArrival&&window.__spinwardMetro.layers.some(l=>l.facade.design.buildings.some(b=>b.id===id&&b.family==='station')),v.id)
  await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.stream.running===0))
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.waitForTimeout(500)
  // URL p locates the body rig. The desktop eye is 1.8m above that origin.
  const pose=await page.evaluate(()=>{const scene=window.__spinwardScene,c=scene.getObjectsByProperty('isPerspectiveCamera',true)[0];return scene.getObjectByName('habitat').worldToLocal(c.parent.getWorldPosition(c.position.clone())).toArray()})
  expect(new Vector3(...pose).distanceTo(new Vector3(...v.at))).toBeLessThan(.2)
  return {errors,gpu,pose}
}
async function probe(page,id){return page.evaluate(id=>{
  const m=window.__spinwardMetro,parts=m.layers.flatMap(l=>l.facade.design.parts.filter(p=>p.id===id))
  return {stationVersion:m.kit.stationVersion,parts:parts.length,purposes:parts.reduce((a,p)=>(a[p.purpose]=(a[p.purpose]??0)+1,a),{}),
    signNames:parts.filter(p=>p.purpose==='station-name').map(p=>m.kit.stationSigns[-p.surface-5]),
    render:window.__spinwardRenderer.info.render,layers:m.layers.map(l=>({band:l.base.sample.id,resident:l.stream.diagnostics().resident.length,bytes:l.stream.diagnostics().recipeBytes,failures:l.stream.failures,
      levels:l.facade.chunks.filter(c=>c.parts.some(p=>p.id===id)).map(c=>c.level)}))}
},id)}

for(const v of views)test(`station ${v.name}: facade, roof, identity and bounded residency`,async({page},info)=>{
  const result=await boot(page,v),p=await probe(page,v.id)
  expect(p.stationVersion).toBe(1);expect(p.purposes['station-clerestory']).toBeGreaterThan(0);expect(p.purposes['station-roof-seam']).toBeGreaterThan(0)
  expect(p.signNames.length).toBeGreaterThan(0);expect(p.signNames.every(s=>s===(v.name.startsWith('omiya')?'大宮':'さいたま新都心'))).toBe(true)
  for(const l of p.layers){expect(l.resident).toBeLessThanOrEqual(24);expect(l.bytes).toBeLessThanOrEqual(6*1024*1024);expect(l.failures).toBe(0)}
  await page.screenshot({path:info.outputPath(v.name+'.png')});expect(result.errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({...result,...p},null,2))
})

test('station night and middle LOD preserve name and structural rhythm',async({page},info)=>{
  const v=views.find(v=>v.name==='omiya-street'),result=await boot(page,v,.02)
  const before=await probe(page,v.id)
  await page.screenshot({path:info.outputPath('station-night.png')})
  await page.evaluate(()=>{for(const l of window.__spinwardMetro.layers){const f=l.facade;f.originalLOD=f.updateLOD.bind(f);f.updateLOD=camera=>f.originalLOD(camera,'mid')}})
  await page.waitForTimeout(300)
  const after=await probe(page,v.id);expect(after.parts).toBe(before.parts);expect(after.signNames).toEqual(before.signNames)
  expect(after.layers.flatMap(l=>l.levels).every(l=>l==='mid')).toBe(true)
  await page.screenshot({path:info.outputPath('station-night-mid.png')});expect(result.errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({result,before,after},null,2))
})

test.describe('stereo station',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('Omiya facade remains attached under head roll in both eyes',async({page,xr},info)=>{
    const v=views.find(v=>v.name==='omiya-street'),result=await boot(page,v)
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
    const target=await page.evaluate(aim=>{const s=window.__spinwardScene,c=s.getObjectsByProperty('isPerspectiveCamera',true)[0];return c.parent.worldToLocal(s.getObjectByName('habitat').localToWorld(c.position.clone().set(...aim))).toArray()},v.aim)
    const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
    const snapshots=[]
    for(const roll of [0,25,-25]){
      await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll*Math.PI/180)).toArray()});await xr.waitForFrames(2,{timeout:5000})
      const capture=await xr.screenshot(info.outputPath(`station-roll-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000})
      expect(capture.sessionId).toBe(diagnostics.session.id);snapshots.push({roll,capture,probe:await probe(page,v.id)})
    }
    expect(snapshots.every(s=>s.probe.parts===snapshots[0].probe.parts)).toBe(true)
    await xr.endSession({sessionId:diagnostics.session.id,timeout:5000});expect(result.errors).toEqual([])
    await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({result,diagnostics,snapshots},null,2))
  })
})
