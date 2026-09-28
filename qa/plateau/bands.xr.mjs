import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'

async function ready(page,url='/?world=colony&walk=1'){
  await page.goto(url);await page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady,null,{timeout:120000})
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('#study-world').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
const watch=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));return errors}
async function probe(page,height=1.65){
  const p=await page.evaluate(()=>{const w=window.__plateau,world=w.walkWorlds.get(w.state.selected),s=w.walk;return{region:w.state.selected,walk:s,ground:world.ground(s.x,s.y),blocked:world.blocked(s.x,s.y),contact:w.groundProbe(),collision:world.diagnostics(),base:[...w.baseTiles].map(([id,b])=>({id,...b.diagnostics()})),facades:[...w.streams].map(([id,f])=>({id,...f.diagnostics()})),draw:w.renderer.info.render,memory:w.renderer.info.memory,heap:performance.memory?.usedJSHeapSize}})
  expect(p.blocked).toBe(false);expect(p.walk.h).toBeCloseTo(p.ground,3);expect(p.contact.length).toBeGreaterThan(0)
  p.contactErrorM=Math.abs(p.contact[0].distance-height);expect(p.contactErrorM).toBeLessThan(.05)
  expect(p.collision.decodedBytes).toBeLessThanOrEqual(4*1024*1024)
  for(const b of p.base){expect(b.nearDecodedBytes).toBeLessThanOrEqual(12*1024*1024);expect(b.far.decodedBytes).toBeLessThanOrEqual(48*1024*1024)}
  for(const f of p.facades)expect(f.recipeBytes).toBeLessThanOrEqual(6*1024*1024)
  return p
}
async function travel(page,id){await page.selectOption('#destination',id);await page.click('#travel');await page.waitForFunction(()=>window.__plateau.detailsReady,null,{timeout:90000})}

test('bands: all station and outer arrivals on three complete bands',async({page},info)=>{
  test.setTimeout(600000);const errors=watch(page),gpu=await ready(page),visits=[]
  for(const region of ['tokyo','tama','azumino']){
    await page.click(`[data-region=${region}]`);await page.waitForFunction(()=>window.__plateau.detailsReady)
    const destinations=await page.evaluate(()=>window.__plateau.navigation.data.destinations)
    for(const stop of destinations){
      await travel(page,stop.id);const state=await probe(page);visits.push({id:stop.id,...state})
      if(stop.id==='home'||stop.id.startsWith('outer-')||stop.id===destinations[1].id)await page.screenshot({path:info.outputPath(region+'-'+stop.id.replaceAll(':','-')+'.png')})
    }
    await page.click('#return-home');await page.waitForFunction(()=>window.__plateau.detailsReady);const before=await probe(page)
    await page.keyboard.down('KeyW');await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>1,[before.walk.x,before.walk.y],{timeout:15000});await page.keyboard.up('KeyW');await probe(page)
  }
  await page.click('#walk');await page.click('[data-mode=colony]');await page.waitForFunction(()=>window.__plateau.detailsReady);await page.screenshot({path:info.outputPath('three-full-bands.png')})
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('arrivals.json'),JSON.stringify({gpu,visits,errors},null,2))
})

test('bands: repeated outer-core travel releases collision and facade residency',async({page},info)=>{
  test.setTimeout(300000);const errors=watch(page);await ready(page);const samples=[]
  for(let cycle=0;cycle<3;cycle++)for(const region of ['tokyo','tama','azumino']){
    await page.click(`[data-region=${region}]`);await page.waitForFunction(()=>window.__plateau.detailsReady)
    for(const id of ['outer--1-3','outer-1-3','home']){
      await travel(page,id);await page.waitForTimeout(3300);await page.waitForFunction(()=>window.__plateau.detailsReady);samples.push({cycle,id,...await probe(page)})
    }
  }
  for(const s of samples)if(s.id.startsWith('outer-'))expect(s.collision.decodedBytes).toBe(0)
  for(const region of ['tokyo','tama','azumino'])for(const id of ['outer--1-3','outer-1-3','home']){
    const counts=samples.filter(s=>s.region===region&&s.id===id&&s.cycle>0).map(s=>s.memory.geometries)
    expect(Math.max(...counts)-Math.min(...counts)).toBeLessThanOrEqual(2)
  }
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('residency.json'),JSON.stringify({samples,errors},null,2))
})

test('bands: mobile regional map, guide, return and touch movement',async({page},info)=>{
  test.setTimeout(240000);await page.setViewportSize({width:390,height:844});const errors=watch(page),gpu=await ready(page),probes=[]
  for(const region of ['tokyo','tama','azumino']){
    await page.click('#menu-toggle');await page.click(`[data-region=${region}]`);await page.selectOption('#destination','outer-1-1');await page.locator('#city-map').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(region+'-map.png')})
    await page.click('#guide');await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','false')
    await page.click('#menu-toggle');await page.click('#travel');await page.waitForFunction(()=>window.__plateau.detailsReady);await page.screenshot({path:info.outputPath(region+'-outer-mobile.png')})
    await page.locator('[aria-label="前へ"]').dispatchEvent('pointerdown',{pointerId:1});await page.waitForTimeout(600);await page.locator('[aria-label="前へ"]').dispatchEvent('pointerup',{pointerId:1});probes.push(await probe(page))
    await page.click('#menu-toggle');await page.click('#return-home');await page.waitForFunction(()=>window.__plateau.detailsReady)
  }
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('mobile.json'),JSON.stringify({gpu,probes,errors},null,2))
})

test.describe('bands stereo',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('bands: actual wrist controls and walking at both ends of every band',async({page,xr},info)=>{
    test.setTimeout(420000);const errors=watch(page),gpu=await ready(page),probes=[];await xr.enterVR()
    async function hand(){await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]});await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.waitForFrames(5)}
    async function click(id){const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),id),origin=[.2,1.35,-.15];await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(3);expect(await page.evaluate(()=>window.__plateau.wrist.hover)).toBe(id);await xr.pressButton('right','trigger');await xr.waitForFrames(5)}
    for(const region of ['tokyo','tama','azumino']){
      await hand();if(region!=='tokyo')await click(region);await page.waitForFunction(()=>window.__plateau.detailsReady)
      for(const id of ['outer--1-3','outer-1-3']){
        await click('destinations')
        for(let i=0;i<40;i++){const current=await page.evaluate(()=>{const w=window.__plateau.wrist;return w.navigation.data.destinations[w.destinationIndex].id});if(current===id)break;await click('next')}
        await xr.screenshot(info.outputPath(region+'-'+id+'-wrist.png'),{canvas:'#study-world',metadata:true});await click('travel:'+id);await page.waitForFunction(()=>window.__plateau.detailsReady)
        await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(5);const before=await probe(page,1.685)
        await xr.setAxes('left',0,-.8);await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>1,[before.walk.x,before.walk.y],{timeout:15000});await xr.setAxes('left',0,0);await xr.waitForFrames(5);probes.push(await probe(page,1.685));await xr.screenshot(info.outputPath(region+'-'+id+'-stereo.png'),{canvas:'#study-world',metadata:true})
        await hand();await click('home');await page.waitForFunction(()=>window.__plateau.detailsReady)
      }
    }
    const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0');await xr.endSession();expect(errors).toEqual([]);await fs.writeFile(info.outputPath('vr.json'),JSON.stringify({gpu,diagnostic,probes,errors},null,2))
  })
})

test('bands: missing ground pauses walking and recovers through the visible retry control',async({page},info)=>{
  test.setTimeout(240000);const errors=watch(page)
  const study=await (await page.request.get('/study.json')).json(),sample=study.samples.find(s=>s.id==='tokyo'),manifest=await (await page.request.get('/'+sample.walkTiles)).json(),[x,y]=manifest.arrival.spawn
  const tile=manifest.tiles.find(t=>x>=t.bounds[0]&&x<t.bounds[2]&&y>=t.bounds[1]&&y<t.bounds[3]);let fail=true,attempts=0
  await page.route('**/'+tile.path,route=>{attempts++;return fail?route.abort('failed'):route.continue()})
  await page.goto('/?world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.rendered,null,{timeout:120000})
  await page.waitForFunction(()=>window.__plateau.walkWorlds.get('tokyo').diagnostics().failures>=3,null,{timeout:30000})
  const before=await page.evaluate(()=>({...window.__plateau.walk}));await page.keyboard.down('KeyW');await page.waitForTimeout(700);await page.keyboard.up('KeyW')
  const after=await page.evaluate(()=>({...window.__plateau.walk}));expect([after.x,after.y]).toEqual([before.x,before.y]);expect(attempts).toBe(3)
  await expect(page.locator('#retry-details')).toBeVisible();await page.screenshot({path:info.outputPath('missing-ground.png')});fail=false;await page.click('#retry-details');await page.waitForFunction(()=>window.__plateau.detailsReady,null,{timeout:120000})
  const recovered=await probe(page);expect(attempts).toBe(4);expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('recovery.json'),JSON.stringify({tile:tile.id,attempts,before,after,recovered,errors},null,2))
})
