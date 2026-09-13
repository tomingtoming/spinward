import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalPose} from './signal-views.mjs'
import {nativeDistrictViews} from './native-district-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'final',tier=process.env.TIER??'quest',baseline=process.env.BASELINE_JS
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,errors:[],views:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL/.test(m.text()))report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 if(baseline){const body=await fs.readFile(baseline);await page.route('**/assets/index-*.js',r=>r.fulfill({status:200,body,contentType:'application/javascript'}))}
 const selected=process.env.VIEWS?.split(',')
 const views=nativeDistrictViews.filter(v=>!selected||selected.includes(v.name)).map(v=>({name:v.name,pose:signalPose(v)}))
 if(!views.length)throw Error('No matching views')
 for(const view of views){
  const start=Date.now()
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${view.pose}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.plan)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(500)
  if(!baseline&&view.name==='spine')await page.waitForFunction(()=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id.startsWith('native:')&&a.visible))
  const probe=await page.evaluate(()=>{
   const city=window.__spinwardCity,p=city.getCityPlan(),routes=city.trafficRoutes,positions=city.getTrafficPositions()
   return{buildings:p.buildings.length,districts:p.nativeDistricts?.map(d=>({id:d.id,buildings:d.buildings.length,roads:d.streets.length}))??[],
    nativeCars:routes.flatMap((r,i)=>r.native?[{id:r.id,path:r.native.source.path.id,position:positions[i],stops:r.signals?.length??0}]:[]),
    walkers:window.__spinwardWalkers.group.userData,
    pavementEdgeTriangles:window.__spinwardScene.getObjectByName('district-pavement-edges')?.geometry.attributes.position.count/3,
    geometry:window.__spinwardScene.getObjectsByProperty('isMesh',true).filter(m=>m.name.startsWith('street-surface-')).map(m=>({name:m.name,triangles:m.geometry.index.count/3})),
    player:window.__spinward,signals:window.__spinwardIntersections.group.getObjectByName('intersection-signal-heads').userData.nativeApproaches}
  })
  if(!baseline&&(probe.districts.length!==3||!probe.nativeCars.some(c=>c.position.axial>5141&&c.position.axial<6425)))throw Error('Native districts or actual cars on the rebuilt road are missing')
  if(!baseline&&probe.walkers.people>probe.walkers.capacity)throw Error('Walker capacity exceeded')
  const file=`native-districts-${tier}-${label}-${view.name}.png`;await page.screenshot({path:out+file});report.views.push({name:view.name,file,loadAndCaptureMs:Date.now()-start,...probe})
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({gpu:report.gpu,views:report.views.map(v=>({name:v.name,buildings:v.buildings,districts:v.districts,cars:v.nativeCars.length})),errors:report.errors}))
}finally{await fs.writeFile(out+`native-districts-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
