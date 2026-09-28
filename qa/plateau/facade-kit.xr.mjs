import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

function watch(page){
  const errors=[],requests=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  page.on('request',r=>requests.push(new URL(r.url()).pathname))
  return{errors,requests}
}
async function ready(page,url){
  await page.goto(url);await page.waitForFunction(()=>window.__plateau?.rendered)
  await page.waitForFunction(()=>window.__plateau.detailsReady)
  const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
async function timing(page){
  return page.evaluate(async()=>{
    const times=[];let last=performance.now();await new Promise(resolve=>{
      const frame=now=>{times.push(now-last);last=now;times.length<250?requestAnimationFrame(frame):resolve()};requestAnimationFrame(frame)
    });const t=times.slice(20).sort((a,b)=>a-b),w=window.__plateau,r=w.renderer.info
    return{frames:t.length,medianMs:t[Math.floor(t.length*.5)],p95Ms:t[Math.floor(t.length*.95)],calls:r.render.calls,triangles:r.render.triangles,geometries:r.memory.geometries,facades:w.facades.get('tokyo')?.diagnostics()}
  })
}

test('shared kit: baseline comparison, three LODs, no baked facade downloads',async({page},info)=>{
  const observed=watch(page),gpu=await ready(page,'/?region=tokyo&walk=1&facades=legacy')
  await page.screenshot({path:info.outputPath('legacy.png')});const legacy=await timing(page)
  observed.requests.length=0
  await ready(page,'/?region=tokyo&walk=1')
  await page.screenshot({path:info.outputPath('shared.png')});const shared=await timing(page)
  expect(observed.requests.filter(p=>p.includes('/frontage-'))).toEqual([])
  expect(shared.facades.buildings).toBe(66)
  const levels={}
  for(const level of ['near','mid','far']){
    await page.evaluate(level=>{window.__plateau.forceFacadeLOD=level},level)
    await page.waitForFunction(level=>window.__plateau.facades.get('tokyo').chunks.every(c=>c.level===level),level)
    await page.screenshot({path:info.outputPath(`${level}.png`)})
    levels[level]=await page.evaluate(()=>{
      const w=window.__plateau,f=w.facades.get('tokyo'),body=w.visibleMeshes('tokyo',['buildings'])
      return{facades:f.diagnostics(),visibleParts:f.group.children.filter(m=>m.visible).reduce((n,m)=>n+m.count,0),bodyVisible:body.length>0,sourceIndices:body.reduce((n,m)=>n+Math.min(m.geometry.drawRange.count,m.geometry.index.count),0)}
    })
  }
  expect(levels.near.visibleParts).toBe(levels.mid.visibleParts)
  expect(levels.far.visibleParts).toBe(0);expect(levels.far.bodyVisible).toBe(true)
  expect(levels.near.sourceIndices).toBe(levels.far.sourceIndices)
  expect(observed.errors).toEqual([])
  await fs.writeFile(info.outputPath('comparison.json'),JSON.stringify({gpu,legacy,shared,levels,errors:observed.errors},null,2))
})

test('shared kit: new eastern block, real key walk and district return',async({page},info)=>{
  const observed=watch(page),gpu=await ready(page,'/?region=tokyo&site=east&walk=1')
  const before=await page.evaluate(()=>window.__plateau.walk)
  expect(before.x).toBe(185);expect(before.y).toBe(30)
  await page.screenshot({path:info.outputPath('east-arrival.png')})
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft')
  await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>=12,[before.x,before.y],{timeout:20000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')
  const after=await page.evaluate(()=>{const w=window.__plateau,s=w.walk,world=w.walkWorlds.get('tokyo');return{...s,blocked:world.blocked(s.x,s.y),ground:world.ground(s.x,s.y)}})
  expect(after.rejected).toBe(0);expect(after.blocked).toBe(false);expect(after.h).toBeCloseTo(after.ground,5)
  await page.screenshot({path:info.outputPath('east-walked.png')})
  const performance=await timing(page)
  await page.locator('[data-site=station]').click();await page.waitForFunction(()=>window.__plateau.walk.x===0)
  expect(observed.errors).toEqual([])
  await fs.writeFile(info.outputPath('east.json'),JSON.stringify({gpu,before,after,performance,errors:observed.errors},null,2))
})

test.describe('kit mobile',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  test('both district controls fit above the walking viewport',async({page},info)=>{
    const observed=watch(page);await ready(page,'/?region=tokyo&walk=1')
    await page.locator('[data-site=east]').tap();await page.waitForFunction(()=>window.__plateau.walk.x===185)
    const layout=await page.evaluate(()=>{
      const aside=document.querySelector('aside').getBoundingClientRect(),sites=document.querySelector('#sites').getBoundingClientRect(),view=document.querySelector('#viewport').getBoundingClientRect()
      return{asideBottom:aside.bottom,sitesBottom:sites.bottom,viewTop:view.top,overflow:document.documentElement.scrollWidth>innerWidth}
    })
    expect(layout.sitesBottom).toBeLessThanOrEqual(layout.asideBottom);expect(layout.viewTop).toBeGreaterThanOrEqual(layout.asideBottom);expect(layout.overflow).toBe(false)
    await page.screenshot({path:info.outputPath('mobile-east.png')});expect(observed.errors).toEqual([])
  })
})

test.describe('kit stereo',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('new district in both eyes, head roll, and shared LOD selection',async({page,xr},info)=>{
    const observed=watch(page),gpu=await ready(page,'/?region=tokyo&site=east&walk=1')
    await xr.enterVR();await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(4)
    const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(diagnostic.rendering.views.length).toBe(2)
    const captures=[]
    for(const level of ['near','mid']){
      await page.evaluate(l=>{window.__plateau.forceFacadeLOD=l},level);await xr.waitForFrames(4)
      const chunks=await page.evaluate(()=>window.__plateau.facades.get('tokyo').diagnostics().chunks)
      expect(chunks.every(c=>c.level===level)).toBe(true)
      captures.push(await xr.screenshot(info.outputPath(`east-${level}-stereo.png`),{canvas:'canvas',metadata:true}))
    }
    await page.evaluate(()=>{window.__plateau.forceFacadeLOD=null});await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,.25]});await xr.waitForFrames(4)
    captures.push(await xr.screenshot(info.outputPath('east-roll-stereo.png'),{canvas:'canvas',metadata:true}))
    await xr.endSession();expect(observed.errors).toEqual([])
    await fs.writeFile(info.outputPath('xr-kit.json'),JSON.stringify({gpu,diagnostic,captures,errors:observed.errors},null,2))
  })
})
