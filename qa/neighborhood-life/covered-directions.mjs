import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {underpassPose} from './underpass-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'desktop'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,views:[],walk:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank')
 report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 const open=async(a=-.025,y=-351.5403225806452,phase=.42,destination='Central Square')=>{
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${underpassPose({at:[a,y,1.8],aim:[a+.02,y,1.8],ground:true,phase})}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>['guide-square','guide-cafe','guide-park'].every(id=>window.__spinwardOuting.destinations.has(id)))
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.getByRole('button',{name:`Directions to ${destination}`,exact:true}).click()
  await page.waitForFunction(action=>window.__spinward.outing.action===action,destination==='Café'?'guide-cafe':'guide-square')
  await page.waitForTimeout(500)
 }
 const state=()=>page.evaluate(()=>{const s=window.__spinward;return {a:s.azimuth,ax:s.axial,h:s.groundHeight,mode:s.mode,outing:s.outing,triangles:window.__spinwardCity.civicDetails.group.userData.underpassTriangles}})
 const shot=async(name)=>{const file=`covered-directions-${tier}-${label}-${name}.png`;await page.screenshot({path:out+file});report.views.push({name,file,url:page.url(),state:await state()})}
 await open()
 report.routes=await page.evaluate(()=>{
  const n=window.__spinwardOuting,p=window.__spinwardCity.civicDetails.underpass,r=window.__spinward.radius,d=[...n.destinations].filter(([id])=>['guide-square','guide-cafe','guide-park'].includes(id))
  const routes=d.flatMap(([from,a])=>d.flatMap(([to,b])=>[false,true].map(driving=>{const t=performance.now(),route=n.route(driving?a.bay:a.entrance,driving?b.bay:b.entrance,driving);return{from,to,driving,route,ms:performance.now()-t}})))
  return {p,routes,active:n.journey.points,status:n.journey.status}
 })
 if(report.routes.routes.some(r=>!r.route))throw Error('An existing destination lost its route')
 if(label==='before'){if(report.routes.status!=='unavailable')throw Error('Baseline no longer reproduces disconnected walk')}
 else if(!report.routes.active.some(p=>p.coveredWalk))throw Error('Covered path absent from real selected route')
 await shot('day')
 await open(-.025,-351.5403225806452,.02);await shot('night')
 await page.setViewportSize({width:390,height:844});await shot('phone')
 const box=await page.locator('.outing-panel').boundingBox();if(box.x<0||box.x+box.width>391)throw Error('Phone directions overflow')
 await page.setViewportSize({width:1440,height:900})
 if(label!=='before'&&process.env.WALK==='1'){
  const p=report.routes.p
  await open(p.azimuth-p.length/2/3200+1/3200,p.axial-8,.42,'Café')
  const points=await page.evaluate(()=>window.__spinwardOuting.journey.points),last=points.findLastIndex(p=>p.coveredWalk)
  if(points.filter(p=>p.coveredWalk).length<2)throw Error('Entry did not choose the covered link')
  report.walkRoute=points
  await shot('entry')
  let middle=false
  for(const goal of points.slice(1,last+2)){
   const deadline=Date.now()+120000
   let closest=Infinity,progressAt=Date.now()
   while(true){
    const s=await state(),dx=Math.atan2(Math.sin(goal.azimuth-s.a),Math.cos(goal.azimuth-s.a))*3200,dy=goal.axial-s.ax
    const remaining=Math.hypot(dx,dy)
    if(remaining<.35)break
    if(remaining<closest-.05){closest=remaining;progressAt=Date.now()}
    if(Date.now()-progressAt>4000)throw Error('No walking progress: '+JSON.stringify({goal,s}))
    if(Date.now()>deadline)throw Error('Walk blocked: '+JSON.stringify({goal,s}))
    await page.evaluate(h=>window.__spinwardOuting.face(h),Math.atan2(dx,dy))
    await page.keyboard.down('KeyW');await page.waitForTimeout(90);await page.keyboard.up('KeyW')
    const sample=await state();report.walk.push(sample)
    const x=(sample.a-p.azimuth)*3200
    if(Math.abs(x)<p.length/2-5){
     if(sample.mode!=='grounded'||Math.abs(sample.h-.34)>.04||Math.abs(sample.ax-p.axial)>.95)throw Error('Walk left the supported clear band')
     if(!sample.outing.detail.includes('Covered walk'))throw Error('Covered instruction disappeared inside the walk')
    }
    if(!middle&&Math.abs(x)<2){await shot('middle');middle=true}
   }
  }
  const end=await state();report.end=end
  if((end.a-p.azimuth)*3200<p.length/2-5||Math.abs(end.ax-p.axial)<1)throw Error('Did not turn out onto the avenue pavement')
  await shot('exited')
 }
 await page.locator('.outing-panel').getByRole('button',{name:'Cancel directions'}).click()
 await page.waitForFunction(()=>window.__spinward.outing.action===null)
 if(report.errors.length)throw Error(report.errors.join('\n'))
 console.log(JSON.stringify({gpu:report.gpu,routes:report.routes.routes.length,maxRouteMs:Math.max(...report.routes.routes.map(r=>r.ms)),views:report.views.length,walkSamples:report.walk.length,end:report.end,errors:report.errors}))
}finally{await fs.writeFile(out+`covered-directions-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
