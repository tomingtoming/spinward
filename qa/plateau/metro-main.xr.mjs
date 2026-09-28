import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {Matrix4,Quaternion,Vector3} from 'three'
import {findRenderedSupport} from './rendered-support.mjs'
const regions=(process.env.SPINWARD_METRO_REGIONS??'south,central,north').split(',')
const defaultRegion=process.env.SPINWARD_METRO_DEFAULT_REGION??regions[0]
const expectFinish=process.env.SPINWARD_METRO_FINISH_EXPECTED==='1'

test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus||page.isClosed())return
  const failure=await page.evaluate(()=>({state:window.__spinward,body:window.__spinwardBody?.group.userData,flight:window.__qaFlight})).catch(()=>null)
  await fs.writeFile(info.outputPath('failure-state.json'),JSON.stringify(failure,null,2))
  await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{})
})

async function boot(page,region=defaultRegion,pose=''){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info'),name=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return name})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto(`/?city=tokyo&preset=izma${region?`&region=${region}`:''}&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42${pose}`)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
  await page.waitForFunction(()=>window.__spinward.mode==='grounded')
  await page.waitForTimeout(1200)
  if(expectFinish){
    await page.waitForFunction(()=>window.__spinwardScene.getObjectsByProperty('name','source-surface-detail').some(m=>m.visible))
    const finish=await page.evaluate(()=>window.__spinward.metro.finish)
    expect(finish.version).toBe(1);expect(finish.trees.trees).toBeGreaterThan(2000)
    expect(finish.trees.near).toBeLessThanOrEqual(384)
  }
  return gpu
}
const state=page=>page.evaluate(()=>{const s=window.__spinward;return{a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,mode:s.mode,regional:s.regional,metro:s.metro}})
async function visibleSupport(page){
  await page.waitForFunction(()=>window.__spinwardMetro.ready&&window.__spinwardMetro.layers.every(l=>l.base.ready))
  const probe=await page.evaluate(()=>{
    const c=window.__spinwardCity,s=window.__spinward,meshes=[]
    c.group.updateWorldMatrix(true,true)
    const inverse=c.group.matrixWorld.clone().invert()
    for(const l of window.__spinwardMetro.layers)for(const m of l.base.group.children)
      if(['terrain','buildings'].includes(m.name)&&m.userData.level==='near')meshes.push({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array),matrix:inverse.clone().multiply(m.matrixWorld).elements})
    return{a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,r:s.radius,meshes}
  })
  // Landings can touch a roof edge after a Coriolis arc. Require a rendered
  // floor within the real body's finite contact volume, not just its centre ray.
  const support=findRenderedSupport(probe)
  expect(support,'rendered near ground contacts the physical body '+JSON.stringify({a:probe.a,y:probe.y,h:probe.h,radial:probe.radial,meshes:probe.meshes.length,nearest:support?null:findRenderedSupport(probe,{radius:2,separation:0})})).not.toBeNull()
  expect(Math.abs(support.drawnHeight-probe.h),'drawn terrain agrees with player collision').toBeLessThan(.08)
  expect(support.clearance,'player remains above drawn ground').toBeGreaterThan(-.12)
  return support
}
for(const region of regions)test(`main PC ${region}: streets, jump and flight use original physics`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await boot(page,region)
  const before=await state(page)
  const placement=await page.evaluate(region=>{
    const m=window.__spinwardMetro,sample=m.study.samples.find(s=>s.id===region),arrival=m.arrivals[region]
    const port=window.__spinwardScene.getObjectByName('spaceport-structure')
    port.geometry.computeBoundingBox()
    return{band:sample.band,spawn:arrival.spawn,rotation:m.group.matrix.elements,
      portY:(port.geometry.boundingBox.min.y+port.geometry.boundingBox.max.y)/2}
  },region)
  expect(placement.portY).toBeLessThan(-19000)
  expect(Math.abs(before.y+placement.spawn[1]),'positive source Y faces the port').toBeLessThan(.1)
  const expectedAngle=-(placement.band*Math.PI*2/3+placement.spawn[0]/3200)
  expect(Math.abs(Math.atan2(Math.sin(before.a-expectedAngle),Math.cos(before.a-expectedAngle)))).toBeLessThan(.0001)
  await page.screenshot({path:info.outputPath('street.png')})
  await page.keyboard.down('KeyW');await page.waitForTimeout(2500);await page.keyboard.up('KeyW')
  const walked=await state(page)
  expect(Math.hypot((walked.a-before.a)*3200,walked.y-before.y)).toBeGreaterThan(1)
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__spinward.mode==='free-fly')
  await page.waitForFunction(h=>3200-window.__spinward.radial>h+.7,walked.h)
  await page.waitForFunction(()=>window.__spinward.mode==='grounded')
  const landed=await state(page)
  expect(Math.abs(landed.h-walked.h)).toBeLessThan(.4)
  await page.keyboard.down('Space');await page.waitForTimeout(1600);await page.keyboard.up('Space')
  const airborne=await state(page);expect(airborne.mode).toBe('free-fly');expect(3200-airborne.radial-landed.h).toBeGreaterThan(4)
  await page.evaluate(()=>{window.__qaFlight=[];let last=0;const sample=now=>{if(now-last>500){last=now;const s=window.__spinward;window.__qaFlight.push({a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,speed:s.speed,mode:s.mode,regional:s.regional.state})};if(window.__qaFlight.length<65&&window.__spinward.mode!=='grounded')requestAnimationFrame(sample)};requestAnimationFrame(sample)})
  await page.screenshot({path:info.outputPath('flight.png')})
  await page.waitForFunction(()=>window.__spinward.mode==='grounded',null,{timeout:30000})
  const final=await state(page),support=await visibleSupport(page);expect(final.regional.state).toBe('ready');expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({gpu,placement,before,walked,landed,airborne,final,support,errors},null,2))
})

test('main PC below sea level: original hull does not cover actual terrain',async({page},info)=>{
  test.skip(!regions.includes('south')&&!process.env.SPINWARD_METRO_BELOW_POSE,'This crop needs an independently selected below-datum probe')
  const gpu=await boot(page,process.env.SPINWARD_METRO_BELOW_REGION??'south',process.env.SPINWARD_METRO_BELOW_POSE??'&m=g&a=-.0625&ax=-16840&gh=-.6944978833')
  const before=await state(page);expect(before.h).toBeLessThan(-.5)
  const support=await visibleSupport(page)
  await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
  const shoes=await page.evaluate(()=>['left','right'].map(side=>{
    const root=window.__spinwardBody.root;root.updateMatrixWorld(true)
    const shoe=root.getObjectByName(side+'_shoe'),p=shoe.getWorldPosition(shoe.position.clone())
    return{side,height:3200-Math.hypot(p.x,p.z)}
  }))
  for(const shoe of shoes)expect(shoe.height,'body must not float at datum zero').toBeLessThan(-.3)
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__spinward.mode==='free-fly')
  await page.waitForFunction(()=>window.__spinward.mode==='grounded')
  const landed=await state(page);expect(landed.h).toBeLessThan(-.5)
  expect(Math.abs(landed.h-before.h)).toBeLessThan(.1)
  await page.screenshot({path:info.outputPath('below-sea-level.png')})
  await fs.writeFile(info.outputPath('probe.json'),JSON.stringify({gpu,before,support,landed,shoes},null,2))
})

test('main PC steady frame and streaming sample',async({page},info)=>{
  const gpu=await boot(page)
  expect(await page.evaluate(()=>window.__spinwardWatch.snapshot.oldTownRespawnEnabled)).toBe(false)
  const places=await page.evaluate(()=>({available:[...window.__spinwardWatch.snapshot.availablePlaces],named:window.__spinwardMetro.places.map(p=>'visit-metro-'+p.id)}))
  expect(places.available).toEqual(['visit-landscape',...places.named])
  await visibleSupport(page);await page.waitForTimeout(2000)
  const sample=await page.evaluate(()=>new Promise(resolve=>{
    const values=[];let previous=performance.now(),start=previous
    const tick=now=>{values.push(now-previous);previous=now
      if(now-start<4000){requestAnimationFrame(tick);return}
      const w=window.__spinwardWatch.snapshot,s=window.__spinward
      resolve({frameMs:values,elapsedMs:now-start,frames:values.length,watch:{fps:w.fps,triangles:w.triangles,drawCalls:w.drawCalls},metro:s.metro})
    };requestAnimationFrame(tick)
  }))
  expect(sample.metro.collision.ready).toBe(true);expect(sample.metro.collision.failed).toEqual([])
  const sorted=[...sample.frameMs].sort((a,b)=>a-b)
  const timing={averageFps:sample.frames/sample.elapsedMs*1000,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)}
  await fs.writeFile(info.outputPath('timing.json'),JSON.stringify({gpu,timing,...sample},null,2))
})

test('inland B default arrival is the Shibuya crossing, with the palace at the port end',async({page},info)=>{
  test.skip(!regions.includes('west'),'Inland-B crop acceptance')
  const gpu=await boot(page,null),before=await state(page)
  const source=await page.evaluate(()=>{
    const m=window.__spinwardMetro
    return{selected:m.selected,arrival:m.arrivals[m.arrivalId],pins:m.study.sourcePins,layout:m.study.layout}
  })
  expect(source.layout).toBe('inland-b');expect(source.selected).toBe('west')
  expect(source.arrival.distanceFromRequestedCenterM).toBeLessThan(30)
  expect(20000-source.pins.imperialPalace.local[1]).toBeLessThan(3000)
  expect(before.y).toBeLessThan(-19250)
  const support=await visibleSupport(page)
  if(expectFinish)await page.waitForFunction(()=>window.__spinwardScene.getObjectsByProperty('name','landmark-surface-detail').some(m=>m.visible))
  await page.screenshot({path:info.outputPath('shibuya-default.png')})
  await fs.writeFile(info.outputPath('arrival.json'),JSON.stringify({gpu,before,source,support},null,2))
})

for(const place of ['omiya','saitama-shintoshin'])test(`inland B ${place}: source station district and ground support`,async({page},info)=>{
  test.skip(!regions.includes('west'),'Inland-B crop acceptance')
  const gpu=await boot(page,null,`&place=${place}`),before=await state(page)
  const source=await page.evaluate(()=>{const m=window.__spinwardMetro;return{selected:m.selected,arrivalId:m.arrivalId,arrival:m.arrivals[m.arrivalId]}})
  expect(source.selected).toBe('west');expect(source.arrivalId).toBe(place)
  expect(Math.abs(before.y+source.arrival.spawn[1])).toBeLessThan(.1)
  const support=await visibleSupport(page)
  await page.screenshot({path:info.outputPath(place+'.png')})
  await page.keyboard.down('KeyW');await page.waitForTimeout(2200);await page.keyboard.up('KeyW')
  const after=await state(page);expect(Math.hypot((after.a-before.a)*3200,after.y-before.y)).toBeGreaterThan(1)
  await fs.writeFile(info.outputPath('station.json'),JSON.stringify({gpu,source,before,after,support},null,2))
})



test('Places: every Tokyo destination lands on rendered source ground and permits walking',async({page},info)=>{
  test.setTimeout(240000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/TypeError|ReferenceError|Error:/.test(m.text()))errors.push(m.text())});const gpu=await boot(page)
  const places=await page.evaluate(()=>window.__spinwardMetro.places)
  expect(places).toHaveLength(16)
  const visits=[]
  for(const place of places){
    await page.getByRole('button',{name:'Places',exact:true}).click()
    await expect(page.locator('.places-menu .place-row:visible')).toHaveCount(16)
    if(place.id==='shibuya')await page.screenshot({path:info.outputPath('places-desktop.png')})
    await page.getByRole('button',{name:`Go now to ${place.label}`,exact:true}).click()
    await page.waitForFunction(({y,event})=>window.__spinward.tour===event&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&Math.abs(window.__spinward.axial+y)<.2,{y:place.spawn[1],event:'visit-metro-'+place.id})
    await page.waitForFunction(()=>{const s=window.__spinward;return s.mode==='grounded'&&s.radius-s.radial-s.groundHeight<.34},null,{timeout:10000})
    const before=await state(page),support=await visibleSupport(page)
    expect(Math.abs(before.h-place.ground),place.id+' remains on the ground, not a roof').toBeLessThan(.15)
    await page.screenshot({path:info.outputPath(`arrival-${place.id}.png`)})
    await page.keyboard.down('KeyW');await page.waitForTimeout(800);await page.keyboard.up('KeyW')
    const after=await state(page)
    expect(Math.hypot((after.a-before.a)*3200,after.y-before.y),place.id+' can walk away').toBeGreaterThan(1)
    expect(after.mode).toBe('grounded')
    visits.push({id:place.id,before,after,support})
  }
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('visits.json'),JSON.stringify({gpu,visits,errors},null,2))
})

test('Places: phone list scrolls to its last destination',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await boot(page)
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await expect(page.locator('.places-menu .place-row:visible')).toHaveCount(16)
  await page.screenshot({path:info.outputPath('places-phone-top.png')})
  const last=page.getByRole('button',{name:'Go now to 蓮田駅周辺',exact:true})
  await last.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('places-phone-bottom.png')})
  const bounds=await page.locator('.places-menu').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390)
  await last.click()
  await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.axial>16000)
  expect(await page.locator('.places-menu').isVisible()).toBe(false)
})

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
test.describe('main stereo',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('Places: VR wrist pages visit three bands and return to Shibuya',async({page,xr},info)=>{
    test.setTimeout(180000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/TypeError|ReferenceError|Error:/.test(m.text()))errors.push(m.text())});const gpu=await boot(page)
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.25,0,0]});await xr.setControllerPose('left',left);await xr.setControllerPose('right',{position:right,quaternion:[0,0,0,1]})
    await xr.waitForFrames(4);await press(page,xr,'nav-places')
    const pages=[]
    pages.push(await page.evaluate(()=>window.__spinwardWatch.layouts.places.placeButtons.map(b=>b.id)))
    await xr.screenshot(info.outputPath('places-vr-first.png'),{canvas:'canvas',metadata:true})
    const visited=[]
    for(const id of ['palace','ikebukuro','omiya','shibuya']){
      if(id==='omiya'){
        await press(page,xr,'nav-places-more')
        pages.push(await page.evaluate(()=>window.__spinwardWatch.layouts['places-more'].placeButtons.map(b=>b.id)))
        await xr.screenshot(info.outputPath('places-vr-second.png'),{canvas:'canvas',metadata:true})
      }
      if(id==='shibuya')await press(page,xr,'nav-places')
      await press(page,xr,'visit-metro-'+id)
      const destination=await page.evaluate(id=>window.__spinwardMetro.places.find(p=>p.id===id),id)
      await page.waitForFunction(y=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&Math.abs(window.__spinward.axial+y)<.2,destination.spawn[1])
      await page.waitForFunction(()=>{const s=window.__spinward;return s.mode==='grounded'&&s.radius-s.radial-s.groundHeight<.34},null,{timeout:10000})
      await xr.waitForFrames(4);visited.push({id,state:await state(page),support:await visibleSupport(page)})
    }
    expect(pages.flat()).toHaveLength(16);expect(new Set(pages.flat()).size).toBe(16)
    await xr.endSession();expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('places-vr.json'),JSON.stringify({gpu,diagnostics,pages,visited,errors},null,2))
  })
  test('VR tall facade angle sweep: continuous windows and bounded streams',async({page,xr},info)=>{
    test.skip(!regions.includes('west'),'Inland-B tall facade regression')
    const gpu=await boot(page,'west'),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const frames=[]
    for(const yaw of [0,.02,-.02,1.1]){
      await xr.setHeadPose({position:[0,1.6,0],euler:[.45,yaw,0]});await xr.waitForFrames(4)
      frames.push(await xr.screenshot(info.outputPath(`facade-${yaw}.png`),{canvas:'canvas',metadata:true,timeout:5000}))
    }
    const streams=await page.evaluate(()=>window.__spinwardMetro.layers.map(l=>l.base.diagnostics()))
    for(const s of streams){expect(s.nearDecodedBytes).toBeLessThanOrEqual(24*1024*1024);expect(s.far.decodedBytes).toBeLessThanOrEqual(48*1024*1024);expect(s.failures+s.far.failures).toBe(0)}
    await xr.endSession();expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('facade.json'),JSON.stringify({gpu,frames,streams,errors},null,2))
  })
  test('VR body, wrist presets, walking and Tokyo return',async({page,xr},info)=>{
    test.setTimeout(240000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(()=>{const original=navigator.xr.requestSession.bind(navigator.xr);navigator.xr.requestSession=async(...args)=>{const session=await original(...args);if(args[0]==='immersive-vr')window.__qaSession=session;return session}})
    const gpu=await boot(page)
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
    // Supplied six-DoF poses are tracked. Only correct IWER fixture confidence;
    // production's emulated-position guard stays enabled.
    await page.evaluate(()=>{for(const s of window.__qaSession.inputSources)if(s.gripSpace)s.gripSpace[IWER.P_SPACE].emulated=false})
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.25,0,0]});await xr.setControllerPose('left',left);await xr.setControllerPose('right',{position:right,quaternion:[0,0,0,1]})
    await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
    const frames=[],worlds=[]
    frames.push(await xr.screenshot(info.outputPath('tokyo-wrist.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    const before=await state(page)
    await xr.setControllerPose('left',{position:[-.35,.85,-.3],quaternion:[0,0,0,1]})
    await xr.setAxes('left',0,-.65);await xr.settle(2200);await xr.setAxes('left',0,0)
    const walked=await state(page);expect(Math.hypot((walked.a-before.a)*3200,walked.y-before.y)).toBeGreaterThan(1)
    const support=await visibleSupport(page)
    await xr.setControllerPose('left',{position:[-.22,1.15,-.22],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.22,1.15,-.22],quaternion:[0,0,0,1]})
    await xr.waitForFrames(3)
    await xr.setHeadPose({position:[0,1.6,0],euler:[-1,0,0]})
    frames.push(await xr.screenshot(info.outputPath('tokyo-body.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    const body=await page.evaluate(()=>window.__spinwardBody.group.userData)
    expect(body.tracked).toBe(true);expect(body.hands).toEqual([true,true]);expect(body.armReach).toEqual([true,true])
    if(expectFinish){
      const models=await page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('name','xr-controller-model').map(m=>m.visible))
      expect(models).toEqual([false,false])
    }
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.25,0,0]});await xr.setControllerPose('left',left);await xr.waitForFrames(3)
    for(const id of ['cooper','elysium','playground','izma']){
      await press(page,xr,'nav-habitat');await press(page,xr,`preset-apply-${id}`)
      await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival)
      await xr.waitForFrames(3);await press(page,xr,'nav-home')
      if(id==='izma'){
        await page.waitForFunction(()=>window.__spinward.metro?.ready)
        await press(page,xr,'nav-places');await press(page,xr,await page.evaluate(()=>window.__spinwardMetro.places?.length?'visit-metro-shibuya':'visit-landscape'))
        await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded')
      }else{
        expect(await page.evaluate(()=>window.__spinward.metro)).toBeNull()
        expect(await page.evaluate(()=>window.__spinwardMetro.group.children.length)).toBe(0)
        expect(await page.evaluate(()=>window.__spinwardMetro.trees??null)).toBeNull()
      }
      worlds.push({id,state:await state(page),radius:await page.evaluate(()=>window.__spinward.radius)})
      frames.push(await xr.screenshot(info.outputPath(id+'-return.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    }
    expect(worlds.map(w=>w.radius)).toEqual([3200,30000,18,3200])
    const finalSupport=await visibleSupport(page)
    await xr.endSession();expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('vr.json'),JSON.stringify({gpu,diagnostics,before,walked,support,finalSupport,body,worlds,frames,errors},null,2))
  })
  test('VR hardware remains visible when the body is hidden',async({page,xr},info)=>{
    test.skip(!expectFinish,'Finish acceptance')
    await page.addInitScript(()=>{const original=navigator.xr.requestSession.bind(navigator.xr);navigator.xr.requestSession=async(...args)=>{const session=await original(...args);if(args[0]==='immersive-vr')window.__qaSession=session;return session}})
    await boot(page,defaultRegion,'&body=0')
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    await page.evaluate(()=>{for(const s of window.__qaSession.inputSources)if(s.gripSpace)s.gripSpace[IWER.P_SPACE].emulated=false})
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.4,0,0]})
    await xr.setControllerPose('left',{position:[-.22,1.25,-.32],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.22,1.25,-.32],quaternion:[0,0,0,1]})
    await xr.waitForFrames(4)
    await page.waitForFunction(()=>window.__spinwardScene.getObjectsByProperty('name','xr-controller-model').every(m=>m.getObjectsByProperty('isMesh',true).length>0))
    expect(await page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('name','xr-controller-model').map(m=>m.visible))).toEqual([true,true])
    expect(await page.evaluate(()=>window.__spinwardBody.group.visible)).toBe(false)
    await xr.screenshot(info.outputPath('hardware-fallback.png'),{canvas:'canvas',metadata:true,timeout:5000})
    await xr.endSession()
  })
})
