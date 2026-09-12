import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {underpassPose} from './underpass-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'desktop'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,errors:[],views:[],walk:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank')
 report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 const open=async (y,phase=.42)=>{
  const pose=underpassPose({at:[-12/3200,y,1.8],aim:[12/3200,y+5,1.8],ground:true,phase})
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${pose}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>['guide-square','guide-cafe','guide-park'].every(id=>window.__spinwardOuting.destinations.has(id)))
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.getByRole('button',{name:'Directions to Central Square',exact:true}).click()
  await page.waitForFunction(()=>window.__spinward.outing.action==='guide-square')
 }
 await open(180)
 report.routes=await page.evaluate(()=>{
  const n=window.__spinwardOuting,d=[...n.destinations].filter(([id])=>['guide-square','guide-cafe','guide-park'].includes(id)),r=window.__spinward.radius
  return d.flatMap(([from,a])=>d.flatMap(([to,b])=>[false,true].map(driving=>{
   const start=driving?a.bay:a.entrance,goal=driving?b.bay:b.entrance,t=performance.now(),route=n.route(start,goal,driving)
   return {from,to,driving,route,ms:performance.now()-t}
  })))
 })
 if(report.routes.some(r=>!r.route))throw Error('An existing destination lost its route')
 report.opposite=await page.evaluate(()=>{
  const s=window.__spinward,t=performance.now(),route=window.__spinwardOuting.route({azimuth:-12/3200,axial:180},{azimuth:12/3200,axial:180},false)
  return {route,ms:performance.now()-t,active:window.__spinwardOuting.journey.points}
 })
 if(label!=='before'&&!report.opposite.route?.some(p=>p.crosswalk&&p.axial>310))throw Error('Unmarked mid-block crossing')
 const shot=async name=>{
  const file=`crosswalk-${tier}-${label}-${name}.png`;await page.screenshot({path:out+file})
  report.views.push({name,file,url:page.url(),state:await page.evaluate(()=>window.__spinward.outing)})
 }
 await shot('detour')
 for(const [name,phase] of [['day',.42],['night',.02]]){
  await open(316,phase);await page.waitForTimeout(500);await shot(name)
  if(label!=='before'){
   const detail=await page.locator('.outing-panel').innerText()
   if(!detail.includes('Crosswalk · check traffic'))throw Error('Crosswalk approach hint absent: '+detail)
  }
 }
 await page.setViewportSize({width:390,height:844});await shot('phone')
 const box=await page.locator('.outing-panel').boundingBox()
 if(box.x<0||box.x+box.width>391)throw Error('Phone directions overflow')
 await page.setViewportSize({width:1440,height:900})
 if(label!=='before'&&process.env.WALK==='1'){
  await open(310)
  const state=()=>page.evaluate(()=>{const s=window.__spinward;return {a:s.azimuth,ax:s.axial,h:s.groundHeight,mode:s.mode,outing:s.outing,
   foot:window.__spinwardBody.surfaces.sample(s.azimuth,s.axial,s.groundHeight,false)}})
  const points=await page.evaluate(()=>window.__spinwardOuting.journey.points)
  const last=points.findLastIndex(p=>p.crosswalk&&p.axial>310)
  if(last<0)throw Error('Crosswalk is absent from selected directions')
  // Follow only the first crossing with real W input; the helper controls gaze,
  // never position. Remaining square-to-cafe/park routes are probed separately.
  for(const goal of points.slice(1,last+2)){
   const deadline=Date.now()+20000
   while(true){
    const s=await state(),dx=Math.atan2(Math.sin(goal.azimuth-s.a),Math.cos(goal.azimuth-s.a))*3200,dy=goal.axial-s.ax
    if(Math.hypot(dx,dy)<.35)break
    if(Date.now()>deadline)throw Error('Walking blocked: '+JSON.stringify({goal,s}))
    await page.evaluate(h=>window.__spinwardOuting.face(h),Math.atan2(dx,dy))
    await page.keyboard.down('KeyW');await page.waitForTimeout(80);await page.keyboard.up('KeyW')
    report.walk.push(await state())
   }
  }
  const end=await state()
  // Street physics retains the shell floor; the visible foot-placement sampler
  // supplies the raised pavement finish. Do not conflate those two heights.
  if(end.a*3200<9.75||end.mode!=='grounded'||Math.abs(end.h)>.05||Math.abs(end.foot-.34)>.03)throw Error('Did not reach opposite pavement: '+JSON.stringify(end))
  for(const s of report.walk)if(Math.abs(s.a*3200)<9.4 && Math.abs(s.ax-(321.2903225806476-5.5))>1.3)throw Error('Walk left the painted crosswalk')
  for(const s of report.walk)if(Math.abs(s.a*3200)<8.5&&!s.outing.detail.includes('Crosswalk'))throw Error('Crosswalk hint disappeared while crossing')
  if(!report.walk.some(s=>s.outing.detail.includes('Crosswalk')))throw Error('Walking never showed crossing hint')
  await shot('walked')
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
 console.log(JSON.stringify({gpu:report.gpu,routes:report.routes.length,maxRouteMs:Math.max(...report.routes.map(r=>r.ms)),opposite:report.opposite,walkSamples:report.walk.length,errors:report.errors}))
}finally{await fs.writeFile(out+`crosswalk-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
