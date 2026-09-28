import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {Matrix4,Quaternion,Vector3} from 'three'

test.use({viewport:{width:1440,height:960}})
const expectNight=process.env.SPINWARD_EXPECT_NIGHT!=='0'
async function boot(page,place,phase=.02){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');const r={renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',maxTexture:gl.getParameter(gl.MAX_TEXTURE_SIZE)};gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
  expect(gpu.renderer).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&place=${place}&t=${phase}`)
  await page.waitForFunction(()=>window.__spinwardWatch)
  // Use the app's normal Day Cycle action. A long three-band visit must not
  // turn into a dawn test while it is checking continuity of night lighting.
  await page.evaluate(()=>{for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')})
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&!window.__spinward.regional.pendingArrival)
  expect(await page.evaluate(()=>window.__spinwardMetro.arrivalId)).toBe(place.split('&')[0])
  await page.waitForFunction(()=>{const m=window.__spinwardMetro;return !m.release||m.layers.find(l=>l.base.sample.id===m.selected)?.detail.status==='ready'})
  if(expectNight)await page.waitForFunction(()=>window.__spinwardMetro.nightscape?.loaded===3)
  await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.stream.running===0))
  if(expectNight)await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>!l.panes||l.panes.running===0&&l.panes.entries.every(e=>!e.wanted||e.status==='resident')),{},{timeout:60000})
  await page.waitForTimeout(1200);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  return{gpu,errors}
}
async function probe(page){return page.evaluate(()=>{
  const n=window.__spinwardMetro.nightscape,s=window.__spinward
  return{night:n?.diagnostics(),pose:{a:s.azimuth,y:s.axial,radial:s.radial,mode:s.mode},regional:s.regional,
    render:window.__spinwardRenderer.info.render,memory:window.__spinwardRenderer.info.memory,
    obstruction:n?.obstruction?{...n.obstruction.diagnostics(),night:n.obstruction.night.value,visible:n.obstruction.points.visible}:null,
    panes:window.__spinwardMetro.layers.map(l=>l.panes?.diagnostics()),
    lights:window.__spinwardStreetLamps.lighting.slots.map(s=>({id:s.source?.id,intensity:s.light.intensity,position:s.light.position.toArray(),source:s.source?.position.toArray()})),
    fields:n?[...n.fields].map(([band,f])=>({band,ready:f.ready,fade:f.fade,night:f.uniforms.metroNight.value,poolSize:[f.pools.image.width,f.pools.image.height]})):[]}
})}

const left={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()}
const right=[.22,1.38,-.2]
async function press(page,xr,id){
  const p=await page.evaluate(id=>{
    const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
    if(!b)throw Error('Missing wrist target '+id)
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    return{u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}
  },id)
  const frame=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel)),target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(frame).toArray()
  await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)});await xr.waitForFrames(2,{timeout:5000})
  await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
  await xr.pressButton('right','trigger')
}

for(const place of ['shibuya','omiya','tokyo','ikebukuro'])for(const phase of [.02,.42])test(`nightscape ${place} ${phase<.1?'night':'day'}`,async({page},info)=>{
  const result=await boot(page,place,phase)
  await page.screenshot({path:info.outputPath('street.png')})
  const street=await probe(page)
  await page.evaluate(()=>{const c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];c.rotation.x=.85})
  await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('opposite.png')})
  if(expectNight){
    expect(street.night.failures).toEqual([]);expect(street.night.loadedBands).toBe(3)
    expect(street.night.visibleFixtures).toBeGreaterThan(0);expect(street.night.visibleFixtures).toBeLessThanOrEqual(512)
    expect(street.lights.length).toBe(1);expect(street.night.localSources).toBeLessThanOrEqual(32)
    expect(street.night.frontages).toBeLessThanOrEqual(128);expect(street.night.localTextureBytes).toBe(3*256*256*4)
    expect(street.night.maxTextureBytes).toBeLessThan(64*1024*1024)
    expect(street.obstruction.markers).toBeGreaterThan(0);expect(street.obstruction.supports).toBeLessThanOrEqual(128)
    expect(street.obstruction.visible).toBe(phase<.1)
    expect(street.fields.every(f=>f.ready&&f.fade===1)).toBe(true)
    for(const p of street.panes.filter(Boolean)){expect(p.bytes).toBeLessThanOrEqual(p.maxBytes);expect(p.resident).toBeLessThanOrEqual(p.maxResident);expect(p.failures).toBe(0)}
    if(phase>.1)expect(street.fields.every(f=>f.night===0)).toBe(true)
  }
  expect(result.errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({result,street},null,2))
})

test('slow night fields retain the original windows and never gate walking',async({page},info)=>{
  let release;const gate=new Promise(resolve=>release=resolve),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.route('**/night-v2/*-pools.png',async r=>{await gate;await r.continue()})
  try{
    await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&place=omiya&t=.02')
    await page.waitForFunction(()=>window.__spinwardWatch)
    await page.evaluate(()=>{for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')})
    await page.waitForSelector('#splash',{state:'detached',timeout:60000})
    await page.waitForFunction(()=>window.__spinward.metro.ready&&!window.__spinward.regional.pendingArrival&&window.__spinwardMetro.layers.some(l=>l.panes.diagnostics().resident>0))
    const before=await probe(page)
    expect(before.night.loadedBands).toBe(0)
    expect(await page.evaluate(()=>window.__spinwardMetro.layers.every(l=>l.facade.uniforms.kitNightTransition.value===0))).toBe(true)
    await page.keyboard.down('KeyW');await page.waitForTimeout(1000);await page.keyboard.up('KeyW')
    const during=await probe(page)
    expect(Math.hypot((during.pose.a-before.pose.a)*3200,during.pose.y-before.pose.y)).toBeGreaterThan(.5)
    expect(during.regional.state).toBe('ready')
    release();await page.waitForFunction(()=>window.__spinwardMetro.nightscape.loaded===3&&window.__spinwardMetro.layers.every(l=>l.facade.uniforms.kitNightTransition.value===1))
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({before,during,after:await probe(page),errors},null,2))
  }finally{release()}
})

test.describe('night stereo',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('light fields and interior rays stay fixed through both eyes and head roll',async({page,xr},info)=>{
    const result=await boot(page,'shibuya')
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
    const captures=[]
    for(const roll of [0,.436,-.436]){
      await xr.setHeadPose({position:[0,1.6,0],euler:[.35,0,roll]});await xr.waitForFrames(3)
      captures.push(await xr.screenshot(info.outputPath(`roll-${roll}.png`),{canvas:'canvas',metadata:true}))
    }
    await xr.endSession();expect(result.errors).toEqual([])
    await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({result,diagnostics,captures,scene:await probe(page)},null,2))
  })
  test('curb fixture and its ground pool stay together in stereo',async({page,xr},info)=>{
    await boot(page,'tokyo')
    const fixture=await page.evaluate(()=>{
      const n=window.__spinwardMetro.nightscape,r=n.selected.find(r=>r.id==='east:42137')??n.selected[0]
      const sample=n.study.samples.find(s=>s.id===r.band),i=Number(r.id.split(':')[1])
      return{id:r.id,band:sample.band,source:Array.from(n.buffers.get(r.band).slice(i*7,i*7+7))}
    })
    const [x,y,z,nx,ny]=fixture.source,px=x+nx*4-ny*5,py=y+ny*4+nx*5,a=-(fixture.band*Math.PI*2/3+px/3200)
    const p=[Math.cos(a)*(3200-z-.1),-py,Math.sin(a)*(3200-z-.1)]
    const result=await boot(page,`tokyo&m=f&rpm=0&p=${p}`)
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const frame=await page.evaluate(id=>{
      const n=window.__spinwardMetro.nightscape,r=n.selected.find(r=>r.id===id),c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
      const target=n.group.localToWorld(r.base.clone().lerp(r.head,.5)),up=r.up.clone().transformDirection(n.group.matrixWorld)
      return{target:target.toArray(),up:up.toArray(),rig:c.parent.matrixWorld.elements}
    },fixture.id)
    const inverse=new Matrix4().fromArray(frame.rig).invert(),target=new Vector3(...frame.target).applyMatrix4(inverse),up=new Vector3(...frame.up).transformDirection(inverse)
    const facing=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),target,up))
    for(const roll of [0,.436,-.436]){
      const q=facing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll))
      await xr.setHeadPose({position:[0,1.6,0],quaternion:q.toArray()});await xr.waitForFrames(4)
      await xr.screenshot(info.outputPath(`fixture-roll-${roll}.png`),{canvas:'canvas',metadata:true})
    }
    await xr.endSession();expect(result.errors).toEqual([])
    await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({fixture,result,frame,scene:await probe(page)},null,2))
  })
  test('night Places cross three bands and retain lights during VR walking',async({page,xr},info)=>{
    test.setTimeout(180000)
    const result=await boot(page,'shibuya'),visits=[]
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.25,0,0]});await xr.setControllerPose('left',left);await xr.setControllerPose('right',{position:right,quaternion:[0,0,0,1]})
    await xr.waitForFrames(4);await press(page,xr,'nav-places')
    for(const id of ['palace','ikebukuro','omiya','shibuya']){
      if(id==='omiya')await press(page,xr,'nav-places-more')
      if(id==='shibuya')await press(page,xr,'nav-places')
      await press(page,xr,'visit-metro-'+id)
      const destination=await page.evaluate(id=>window.__spinwardMetro.places.find(p=>p.id===id),id)
      await page.waitForFunction(y=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&Math.abs(window.__spinward.axial+y)<.2,destination.spawn[1])
      await page.waitForFunction(region=>{const m=window.__spinwardMetro;return(!m.release||m.layers.find(l=>l.base.sample.id===region)?.detail.status==='ready')&&m.layers.every(l=>l.stream.running===0&&(!l.panes||l.panes.running===0))},destination.region)
      await xr.waitForFrames(4)
      await xr.screenshot(info.outputPath(`night-${id}.png`),{canvas:'canvas',metadata:true})
      const before=await probe(page)
      await xr.setControllerPose('left',{position:[-.35,.85,-.3],quaternion:[0,0,0,1]})
      await xr.setAxes('left',0,-.65);await xr.settle(1500);await xr.setAxes('left',0,0)
      const after=await probe(page)
      expect(Math.hypot((after.pose.a-before.pose.a)*3200,after.pose.y-before.pose.y)).toBeGreaterThan(.5)
      expect(after.night.failures).toEqual([]);expect(after.fields.every(f=>f.ready&&f.night>.9)).toBe(true)
      for(const p of after.panes.filter(Boolean)){expect(p.bytes).toBeLessThanOrEqual(p.maxBytes);expect(p.failures).toBe(0)}
      visits.push({id,region:destination.region,before,after})
      await xr.setControllerPose('left',left);await xr.waitForFrames(4)
    }
    expect(new Set(visits.map(v=>v.region)).size).toBe(3)
    await xr.endSession();expect(result.errors).toEqual([])
    await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({result,diagnostics,visits},null,2))
  })
})
