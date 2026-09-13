import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalPose,signalViews} from './signal-views.mjs'
import {curvedWalkerPose,curvedWalkerViews} from './curved-walker-views.mjs'
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
 const views=[{name:'junction',pose:signalPose(signalViews[0])},{name:'junction-night',pose:signalPose(signalViews.at(-1))},
  {name:'junction-overhead',pose:signalPose({at:[22/3200,295,55],aim:[0,321.29,.2],phase:.42})},
  ...curvedWalkerViews.map(v=>({name:`garden-${v.name}`,pose:curvedWalkerPose(v)}))]
 for(const view of views){
  const start=Date.now()
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${view.pose}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.plan)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(500)
  const probe=await page.evaluate(()=>{const scene=window.__spinwardScene,city=window.__spinwardCity,p=city.getCityPlan(),surfaces=[];scene.traverse(o=>{if(o.name.startsWith('street-surface-'))surfaces.push({name:o.name,pieces:o.userData.surfaces,triangles:o.geometry.index.count/3})});return{sourcePaths:p.streetSurfaces?.sources.length??null,meshes:scene.getObjectsByProperty('isMesh',true).length,surfaces,buildings:p.buildings.length,player:window.__spinward}})
  if(!baseline&&(probe.sourcePaths!==13173||!probe.surfaces.some(s=>s.name==='street-surface-sidewalks')))throw Error('Native surface renderer missing')
  const file=`street-surfaces-${tier}-${label}-${view.name}.png`;await page.screenshot({path:out+file});report.views.push({name:view.name,file,loadAndCaptureMs:Date.now()-start,...probe})
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({gpu:report.gpu,views:report.views.map(v=>({name:v.name,meshes:v.meshes,sourcePaths:v.sourcePaths,surfaces:v.surfaces,loadAndCaptureMs:v.loadAndCaptureMs})),errors:report.errors}))
}finally{await fs.writeFile(out+`street-surfaces-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
