import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import path from 'node:path'

const ready=page=>page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady,null,{timeout:90000})
const menu=async page=>{if(await page.locator('#menu-toggle').getAttribute('aria-expanded')!=='true')await page.click('#menu-toggle')}
async function probe(page){
  return page.evaluate(()=>{const w=window.__plateau;return{state:w.state,walk:w.walk,contact:w.groundProbe(),collision:[...w.walkWorlds].map(([id,v])=>({id,...v.diagnostics()})),base:[...w.baseTiles].map(([id,v])=>({id,...v.diagnostics()})),facades:[...w.streams].map(([id,v])=>({id,...v.diagnostics()})),memory:w.renderer.info.memory,heap:performance.memory?.usedJSHeapSize}})
}
test('main bands: repeat city and terminal travel releases streamed data',async({page},info)=>{
  test.setTimeout(300000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?preset=three-bands');await ready(page)
  const gpu=await page.evaluate(()=>{const g=window.__plateau.renderer.getContext();return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)})
  expect(gpu).not.toMatch(/Software|SwiftShader|llvmpipe/i)
  const samples=[]
  for(let cycle=0;cycle<3;cycle++)for(const region of ['tokyo','tama','azumino'])for(const id of ['outer--1-3','outer-1-3','home']){
    await page.evaluate(({region,id})=>{const w=window.__plateau;w.show(region);w.visitDestination(id)},{region,id});await ready(page);await page.waitForTimeout(3300);await ready(page)
    const p=await probe(page);samples.push({cycle,region,id,...p})
    for(const c of p.collision){expect(c.decodedBytes).toBeLessThanOrEqual(4*1024*1024);if(c.id!==region||id.startsWith('outer-'))expect(c.decodedBytes).toBe(0)}
    for(const b of p.base){expect(b.nearDecodedBytes).toBeLessThanOrEqual(12*1024*1024);expect(b.far.decodedBytes).toBeLessThanOrEqual(48*1024*1024)}
    for(const f of p.facades)expect(f.recipeBytes).toBeLessThanOrEqual(6*1024*1024)
    expect(p.contact.length).toBeGreaterThan(0);expect(Math.abs(p.contact[0].distance-1.65)).toBeLessThan(.05)
  }
  for(const region of ['tokyo','tama','azumino'])for(const id of ['outer--1-3','outer-1-3','home']){
    const counts=samples.filter(s=>s.region===region&&s.id===id&&s.cycle>0).map(s=>s.memory.geometries)
    expect(Math.max(...counts)-Math.min(...counts)).toBeLessThanOrEqual(2)
  }
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('residency.json'),JSON.stringify({gpu,samples,errors},null,2))
})

test('main bands: missing ground stops movement and visible retry restores it',async({page},info)=>{
  test.setTimeout(150000)
  const study=await (await page.request.get('/study.json')).json(),sample=study.samples[0],manifest=await (await page.request.get('/'+sample.walkTiles)).json(),[x,y]=manifest.arrival.spawn
  const tile=manifest.tiles.find(t=>x>=t.bounds[0]&&x<t.bounds[2]&&y>=t.bounds[1]&&y<t.bounds[3]);let fail=true,attempts=0
  await page.route('**/'+tile.path,r=>{attempts++;return fail?r.abort('failed'):r.continue()})
  await page.goto('/?preset=three-bands');await page.waitForFunction(()=>window.__plateau?.rendered)
  await page.waitForFunction(()=>window.__plateau.walkWorlds.get('tokyo').diagnostics().failures>=3,null,{timeout:30000})
  const before=await probe(page);await page.keyboard.down('KeyW');await page.keyboard.press('Space');await page.waitForTimeout(700);await page.keyboard.up('KeyW')
  const after=await probe(page);expect([after.walk.x,after.walk.y,after.walk.h]).toEqual([before.walk.x,before.walk.y,before.walk.h]);expect(attempts).toBe(3)
  await expect(page.locator('#retry-details')).toBeVisible();await page.screenshot({path:info.outputPath('missing-ground.png')})
  fail=false;await page.click('#retry-details');await ready(page);expect(attempts).toBe(4)
  await page.keyboard.down('KeyW');await page.waitForTimeout(700);await page.keyboard.up('KeyW')
  const recovered=await probe(page);expect(Math.hypot(recovered.walk.x-before.walk.x,recovered.walk.y-before.walk.y)).toBeGreaterThan(.5)
  await fs.writeFile(info.outputPath('recovery.json'),JSON.stringify({attempts,before,after,recovered},null,2))
})

test('main bands: startup data failure shows the main reload screen and recovers',async({page})=>{
  let fail=true;await page.route('**/study.json',r=>fail?r.fulfill({status:503,body:'unavailable'}):r.continue())
  await page.goto('/?preset=three-bands');await expect(page.locator('.splash__reload')).toBeVisible()
  fail=false;await page.click('.splash__reload');await ready(page);await expect(page.locator('#splash')).toHaveCount(0)
})

test('main bands: mobile menu and jump leave room for the city',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/?preset=three-bands');await ready(page)
  await menu(page);await page.click('[data-region=tama]');await ready(page);await page.click('#jump')
  await page.waitForFunction(()=>!window.__plateau.motion.grounded);await page.waitForFunction(()=>window.__plateau.motion.grounded)
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','false')
  await page.screenshot({path:info.outputPath('mobile-city.png')})
})

test('main entry still opens the existing playground',async({page},info)=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?preset=playground&debug&metrics=off');await page.waitForFunction(()=>window.__spinward,null,{timeout:90000})
  await expect(page.locator('#splash')).toHaveCount(0);expect(await page.evaluate(()=>!!window.__plateau)).toBe(false)
  await page.screenshot({path:info.outputPath('existing-playground.png')});expect(errors).toEqual([])
})

test('main bands: body contact follows bridges and all six city seams',async({page},info)=>{
  test.setTimeout(240000)
  const root=process.env.PLATEAU_DATA_ROOT;if(!root)throw Error('Set PLATEAU_DATA_ROOT')
  const cases=JSON.parse(await fs.readFile(path.join(root,'band-transition-probes.json'))),report=[]
  await page.goto('/?preset=three-bands');await ready(page)
  for(const item of cases){
    const [a,b]=item.points,yaw=Math.atan2(-(b[0]-a[0]),b[1]-a[1])
    await page.evaluate(({region,point,yaw})=>{const w=window.__plateau;w.show(region);w.navigation.data.destinations.push({id:'qa-contact',label:'contact',point,ground:0,yaw});w.visitDestination('qa-contact')},{region:item.region,point:a,yaw});await ready(page)
    let maxContactErrorM=0
    for(let i=0;i<item.points.length;i++){
      const point=item.points[i],state=await page.evaluate(point=>{const w=window.__plateau,p=w.walk;return w.advanceWalk(point[0]-p.x,point[1]-p.y)},point)
      expect(Math.hypot(state.x-point[0],state.y-point[1])).toBeLessThan(.003)
      if(i%8===0||i===item.points.length-1){await ready(page);const p=await probe(page);expect(p.contact.length).toBeGreaterThan(0);const error=Math.abs(p.contact[0].distance-1.65);maxContactErrorM=Math.max(maxContactErrorM,error);expect(error).toBeLessThan(.055)}
    }
    report.push({region:item.region,id:item.id,samples:item.points.length,maxContactErrorM})
    await page.evaluate(()=>{const n=window.__plateau.navigation;n.data.destinations=n.data.destinations.filter(d=>d.id!=='qa-contact')})
  }
  await fs.writeFile(info.outputPath('transitions.json'),JSON.stringify({report},null,2))
})
