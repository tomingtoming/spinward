import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalPose} from './signal-views.mjs'
import {streetSignalViews} from './street-signal-views.mjs'
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
 const views=streetSignalViews.map(v=>({name:v.name,pose:signalPose(v)}))
 for(const view of views){
  const start=Date.now()
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${view.pose}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.plan)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(500)
  const probe=await page.evaluate(()=>{const scene=window.__spinwardScene,city=window.__spinwardCity,p=city.getCityPlan(),surfaces=[];scene.traverse(o=>{if(o.name.startsWith('street-surface-'))surfaces.push({name:o.name,pieces:o.userData.surfaces,triangles:o.geometry.index.count/3})});const group=window.__spinwardIntersections.group,h=group.getObjectByName('intersection-signal-heads'),l=group.getObjectByName('intersection-signal-lamps');return{signalClock:window.__spinwardIntersections.elapsed,trafficClock:city.getTrafficClock(),controls:h.userData.nativeApproaches??[],heads:h.count,legacyHeads:h.userData.legacyHeads??h.count,lamps:l.count,lampColors:Array.from(l.instanceColor.array.slice(0,l.count*3)),visor:group.getObjectByName('intersection-signal-visors').userData,trafficStops:city.trafficRoutes.filter(r=>r.signals?.length).map(r=>({kind:r.kind,direction:r.direction,stops:r.signals})),sourcePaths:p.streetSurfaces?.sources.length??null,nativeMarkings:!!p.streetMarkings,markings:(()=>{const m=scene.getObjectByName('street-junction-markings'),s=scene.getObjectByName('crosswalk-stripes');return{crossings:m?.userData.crossings??0,pieces:m?.userData.paintPieces??0,triangles:m?m.geometry.index.count/3:0,stopLines:m?.userData.stopLines??0,legacyStripeInstances:s?.count??0}})(),meshes:scene.getObjectsByProperty('isMesh',true).length,surfaces,buildings:p.buildings.length,player:window.__spinward}})
  if(!baseline){
   if(!probe.controls.length||probe.heads!==probe.controls.length+probe.legacyHeads||probe.markings.stopLines!==probe.controls.length)throw Error('Native signal / stop render mismatch')
   if(Math.abs(probe.signalClock-probe.trafficClock)>1e-8)throw Error('Traffic and lamps use different clocks')
   for(let i=0;i<probe.controls.length;i++){
    const c=probe.controls[i],period=c.groups*16,phase=((probe.signalClock+c.phase-c.group*16)%period+period)%period,active=phase<10?0:phase<13?1:2
    for(let a=0;a<3;a++)if((Math.max(...probe.lampColors.slice((i*3+a)*3,(i*3+a+1)*3))>.5)!==(a===active))throw Error('Rendered light disagrees with common controller')
   }
   if(!probe.trafficStops.some(r=>r.stops.some(s=>s.control)))throw Error('Physical vehicle routes lost native signal references')
   if(probe.trafficStops.some(r=>r.stops.some(s=>!s.control&&!s.crossing)))throw Error('A traffic route lacks its control source')
  }
  const file=`street-signals-${tier}-${label}-${view.name}.png`;await page.screenshot({path:out+file});report.views.push({name:view.name,file,loadAndCaptureMs:Date.now()-start,...probe})
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({gpu:report.gpu,views:report.views.map(v=>({name:v.name,meshes:v.meshes,sourcePaths:v.sourcePaths,markings:v.markings,loadAndCaptureMs:v.loadAndCaptureMs})),errors:report.errors}))
}finally{await fs.writeFile(out+`street-signals-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
