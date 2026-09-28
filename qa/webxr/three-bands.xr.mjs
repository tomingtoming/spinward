import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'
const menu=async(page,open=true)=>{if((await page.locator('#menu-toggle').getAttribute('aria-expanded'))!==String(open))await page.click('#menu-toggle')}
// IWER 2.4.0 marks grip XRSpaces as emulated even for supplied six-DoF poses.
// Make tracking confidence explicit in this fixture; retain the app's guard.
const trackedGrips=page=>page.evaluate(()=>{
  for(const source of window.__plateau.renderer.xr.getSession().inputSources)
    if(source.gripSpace)source.gripSpace[IWER.P_SPACE].emulated=false
})
test.beforeEach(async({page})=>page.setDefaultTimeout(45000))
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus||page.isClosed())return
  const state=await page.evaluate(()=>{const w=window.__plateau;return w?{walk:w.walk,state:w.state,collision:[...w.walkWorlds].map(([id,v])=>({id,...v.diagnostics()})),base:[...w.baseTiles].map(([id,v])=>({id,...v.diagnostics()})),facades:[...w.streams].map(([id,v])=>({id,...v.diagnostics()})),riding:w.transit.riding?.id}:null}).catch(()=>null)
  await fs.writeFile(info.outputPath('failure-state.json'),JSON.stringify(state,null,2))
})

test('three bands main entry: shared body, rotating jump and night',async({page},info)=>{
  test.setTimeout(240000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?preset=three-bands')
  await page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady,null,{timeout:120000})
  const gpu=await page.evaluate(()=>{const g=window.__plateau.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const visits=[]
  for(const region of ['tokyo','tama','azumino']){
    await menu(page);await page.click(`[data-region=${region}]`);await menu(page,false)
    await page.waitForFunction(()=>window.__plateau.detailsReady&&window.__plateau.body.view.group.userData.ready)
    await page.screenshot({path:info.outputPath(region+'-day.png')})
    const before=await page.evaluate(()=>({...window.__plateau.walk}))
    await page.evaluate(()=>{const w=window.__plateau;w.jumpSamples=[];let n=0;const sample=()=>{w.jumpSamples.push({...w.walk,motion:{...w.motion}});if(n++<110)requestAnimationFrame(sample)};requestAnimationFrame(sample)})
    await page.keyboard.press('Space')
    await page.waitForFunction(()=>!window.__plateau.motion.grounded)
    await page.waitForFunction(()=>window.__plateau.motion.grounded)
    const after=await page.evaluate(()=>({...window.__plateau.walk})),samples=await page.evaluate(()=>window.__plateau.jumpSamples)
    expect(Math.max(...samples.map(p=>p.h))-before.h).toBeGreaterThan(.65)
    expect(Math.abs(after.h-before.h)).toBeLessThan(.1)
    expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(.25)
    const ground=await page.evaluate(()=>window.__plateau.groundProbe())
    expect(ground.length).toBeGreaterThan(0);expect(Math.abs(ground[0].distance-1.65)).toBeLessThan(.05)
    visits.push({region,before,after,samples,ground})
    // Genuine pointer input looks at the feet; body orientation is reviewed
    // independently against the street plane in these images.
    const viewport=await page.locator('#study-world').boundingBox()
    await page.mouse.move(viewport.x+viewport.width*.65,viewport.y+viewport.height*.2)
    await page.mouse.down();await page.mouse.move(viewport.x+viewport.width*.65,viewport.y+viewport.height*.7,{steps:12});await page.mouse.up()
    await page.screenshot({path:info.outputPath(region+'-feet.png')})
  }
  await menu(page);await page.click('[data-region=tokyo]');await page.waitForFunction(()=>window.__plateau.detailsReady)
  await page.click('#daylight');await menu(page,false);await page.waitForTimeout(500)
  await page.screenshot({path:info.outputPath('tokyo-night.png')})
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('main-body.json'),JSON.stringify({gpu,visits,errors},null,2))
})

test('three bands main entry: physical station access, boarding and continuous ride',async({page},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?preset=three-bands');await page.waitForFunction(()=>window.__plateau?.detailsReady)
  await menu(page);await page.selectOption('#destination','outer-1-3');await page.click('#travel')
  await page.waitForFunction(()=>window.__plateau.detailsReady)
  const before=await page.evaluate(()=>({...window.__plateau.walk}))
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyA')
  await page.waitForFunction(x=>window.__plateau.walk.x<x-10,before.x);await page.keyboard.up('KeyA')
  await page.keyboard.down('KeyS')
  await page.waitForFunction(y=>window.__plateau.walk.y<y-6.2,before.y)
  await page.keyboard.up('KeyS')
  await page.keyboard.down('KeyD');await page.waitForFunction(x=>window.__plateau.walk.x>=x-.1,before.x);await page.keyboard.up('KeyD');await page.keyboard.up('ShiftLeft')
  // Fix the timetable phase, independently of load time. From this point the
  // actual simulation clock and controls move the passenger, never a test pose.
  await page.evaluate(()=>{const t=window.__plateau.transit;t.service.time=-t.service.tables[0].offset+3;t.service.step(0)})
  await menu(page);await expect(page.locator('#board-transit')).toBeEnabled()
  await page.screenshot({path:info.outputPath('tokyo-platform.png')})
  await page.click('#board-transit')
  expect(await page.evaluate(()=>!!window.__plateau.transit.riding)).toBe(true)
  await page.screenshot({path:info.outputPath('tokyo-aboard.png')})
  const observations=[]
  // Skip only the stationary dwell, then observe acceleration and floor
  // ownership with real frame stepping over six seconds.
  await page.evaluate(()=>{const t=window.__plateau.transit;t.service.time=-t.service.tables[0].offset+24;t.service.step(0)})
  for(let i=0;i<7;i++){
    await page.waitForTimeout(1000)
    observations.push(await page.evaluate(()=>({walk:{...window.__plateau.walk},position:[...window.__plateau.transit.riding.position],speed:window.__plateau.transit.riding.speed})))
  }
  expect(observations.at(-1).speed).toBeGreaterThan(observations[0].speed+3)
  expect(observations.at(-1).walk.x-observations[0].walk.x).toBeGreaterThan(12)
  expect(await page.locator('#board-transit').isDisabled()).toBe(true)
  await page.screenshot({path:info.outputPath('departing-tokyo.png')})
  const viewport=await page.locator('#study-world').boundingBox()
  await page.mouse.move(viewport.x+viewport.width*.7,viewport.y+viewport.height*.2);await page.mouse.down()
  await page.mouse.move(viewport.x+viewport.width*.7,viewport.y+viewport.height*.68,{steps:12});await page.mouse.up()
  await page.screenshot({path:info.outputPath('aboard-body.png')})
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('transit.json'),JSON.stringify({before,observations,errors},null,2))
})

test.describe('three bands in WebXR',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('shared body, controller jump and tracked head on the real city',async({page,xr},info)=>{
    test.setTimeout(180000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto('/?preset=three-bands');await page.waitForFunction(()=>window.__plateau?.detailsReady)
    const gpu=await page.evaluate(()=>{const gl=window.__plateau.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})
    expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
    await xr.enterVR();await xr.waitForFrames(4)
    expect(await page.evaluate(()=>window.__plateau.body.view.group.userData.hands)).toEqual([false,false])
    await trackedGrips(page);await xr.setHeadPose({position:[0,1.65,0],euler:[-1.05,0,0]})
    await xr.setControllerPose('left',{position:[-.22,1.1,-.35],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.22,1.1,-.35],quaternion:[0,0,0,1]});await xr.waitForFrames(8)
    await xr.screenshot(info.outputPath('vr-body-stereo.png'),{canvas:'#study-world',metadata:true})
    await xr.setHeadPose({position:[0,1.65,0],euler:[-.55,0,0]})
    await xr.setControllerPose('left',{position:[-.23,1.32,-.43],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.23,1.32,-.43],quaternion:[0,0,0,1]});await xr.waitForFrames(8)
    await xr.screenshot(info.outputPath('vr-hands-stereo.png'),{canvas:'#study-world',metadata:true})
    const bodyProbe=await page.evaluate(()=>window.__plateau.body.view.group.userData)
    expect(bodyProbe.hands).toEqual([true,true])
    await fs.writeFile(info.outputPath('body-probe.json'),JSON.stringify(bodyProbe,null,2))
    const before=await page.evaluate(()=>({...window.__plateau.walk}))
    await xr.setAxes('left',0,-.8);await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>.75,[before.x,before.y]);await xr.setAxes('left',0,0)
    await xr.pressButton('right','a-button')
    await page.waitForFunction(()=>!window.__plateau.motion.grounded)
    await page.waitForFunction(()=>window.__plateau.motion.grounded)
    const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.endSession();await page.waitForFunction(()=>window.__plateau.motion.grounded)
    expect(errors).toEqual([]);await fs.writeFile(info.outputPath('vr.json'),JSON.stringify({gpu,diagnostic,errors},null,2))
  })
})

test.describe('three-band round journey',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  for(const immersive of [false,true])test(`${immersive?'XR':'PC'}: ride through all bands, leave onto platform, explore and return`,async({page,xr},info)=>{
    test.setTimeout(360000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto('/?preset=three-bands');await page.waitForFunction(()=>window.__plateau?.detailsReady)
    if(immersive){await xr.enterVR();await trackedGrips(page);await xr.setHeadPose({position:[0,1.65,0],euler:[-.25,0,0]})}
    async function wrist(id){
      await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]})
      await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.waitForFrames(5)
      const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),id),origin=[.2,1.35,-.15]
      await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(3)
      expect(await page.evaluate(()=>window.__plateau.wrist.hover)).toBe(id);await xr.pressButton('right','trigger');await xr.waitForFrames(5)
    }
    const visits=[]
    for(const [leg,region] of ['tokyo','tama','azumino','tama'].entries()){
      // Route phase is accelerated for this integration sweep; source walking,
      // actual wrist/DOM boarding and every rendered carriage sample remain live.
      await page.evaluate(region=>{const w=window.__plateau;w.show(region);w.visitDestination('outer-1-3');for(const [x,y] of [[-5,0],[-5,0],[0,-6.2],[5,0],[5,0]])w.advanceWalk(x,y)},region)
      await page.waitForFunction(()=>window.__plateau.detailsReady)
      await page.evaluate(leg=>{const t=window.__plateau.transit,table=t.service.tables[0];t.service.time=-table.offset+table.legs[leg].start+3;t.service.step(0)},leg)
      if(immersive)await wrist('transit');else{await menu(page);await page.click('#board-transit')}
      expect(await page.evaluate(()=>!!window.__plateau.transit.riding)).toBe(true)
      const samples=[]
      for(const fraction of [.15,.5,.85]){
        await page.evaluate(({leg,fraction})=>{const t=window.__plateau.transit,table=t.service.tables[0],route=table.legs[leg];t.service.time=-table.offset+route.start+24+(route.duration-24)*fraction;t.service.step(0)},{leg,fraction})
        if(immersive)await xr.waitForFrames(8);else await page.waitForTimeout(180)
        samples.push(await page.evaluate(()=>{const w=window.__plateau,t=w.transit,train=t.riding;return{walk:{...w.walk},train:{position:[...train.position],speed:train.speed,next:train.next.id},body:{...w.body.view.group.userData}}}))
        if(fraction===.5){if(immersive)await xr.screenshot(info.outputPath(`leg-${leg}-stereo.png`),{canvas:'#study-world',metadata:true});else await page.screenshot({path:info.outputPath(`leg-${leg}-pc.png`)})}
      }
      for(const s of samples){expect(s.train.speed).toBeGreaterThan(0);expect(s.walk.h).toBeCloseTo(s.train.position[2]+.62,4);expect(s.body.ready).toBe(true)}
      const next=await page.evaluate(leg=>{const t=window.__plateau.transit,table=t.service.tables[0],route=table.legs[leg];t.service.time=-table.offset+route.start+route.duration+3;t.service.step(0);return route.to.id},leg)
      if(immersive){await xr.waitForFrames(8);await wrist('transit')}else{await menu(page);await expect(page.locator('#board-transit')).toBeEnabled();await page.click('#board-transit')}
      expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe(next)
      expect(await page.evaluate(()=>!!window.__plateau.transit.riding)).toBe(false)
      const contact=await page.evaluate(()=>{const w=window.__plateau,p=w.walk,world=w.walkWorlds.get(w.state.selected);return{walk:{...p},ground:world.ground(p.x,p.y),blocked:world.blocked(p.x,p.y)}})
      expect(contact.blocked).toBe(false);expect(contact.walk.h).toBeCloseTo(contact.ground,3)
      visits.push({leg,region,next,samples,contact})
      console.log(`${immersive?'XR':'PC'} arrived ${next}`)
      // Visit the actual source neighbourhood after leaving the train; the
      // fast-travel access to the urban core is explicitly part of this test.
      await page.evaluate(()=>window.__plateau.visitDestination('home'));await page.waitForFunction(()=>window.__plateau.detailsReady)
      if(immersive){await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.setAxes('left',0,-.5);await xr.waitForFrames(40);await xr.setAxes('left',0,0)}
      else{await page.keyboard.down('KeyW');await page.waitForTimeout(700);await page.keyboard.up('KeyW')}
    }
    expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe('tokyo')
    if(immersive)await xr.endSession()
    expect(errors).toEqual([]);await fs.writeFile(info.outputPath('round-journey.json'),JSON.stringify({acceleratedTimetable:true,coreAccess:'existing fast travel',immersive,visits,errors},null,2))
  })
})
