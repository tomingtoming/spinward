import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {curvedWalkerViews,curvedWalkerPose} from './curved-walker-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'final',tier=process.env.TIER??'quest',baseline=process.env.BASELINE_JS
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,baseline,errors:[],views:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 if(baseline){const body=await fs.readFile(baseline);await page.route('**/assets/index-*.js',r=>r.fulfill({status:200,body,contentType:'application/javascript'}))}
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 const open=async query=>{
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${query}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.plan&&window.__spinwardCar?.group.userData.ready)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(1200)
 }
 const probe=()=>page.evaluate(()=>{
  const city=window.__spinwardCity,plan=city.getCityPlan(),g=plan.streetNetwork
  return{asset:document.querySelector('script[src*="/assets/index-"]').src,meshes:window.__spinwardScene.getObjectsByProperty('isMesh',true).length,
   player:window.__spinward,graph:g?{streets:g.streets.length,segments:g.segments.length,nodes:g.nodes.length,edges:g.edges.length,components:new Set(g.components).size}:null}
 })
 const shot=async name=>{const state=await probe();report.views.push({name,...state});await page.screenshot({path:out+`street-network-${tier}-${label}-${name}.png`});return state}
 for(const view of curvedWalkerViews.slice(0,2)){await open(curvedWalkerPose(view));await shot(view.name)}
 if(!baseline){
  report.curve=await page.evaluate(()=>{
   const p=window.__spinwardCity.curvedNeighborhood.plan,n=window.__spinwardOuting
   const ends=p.streetLinks.map(s=>({azimuth:s.azimuth+s.knots[0].point[0]/3200,axial:s.axial+s.knots[0].point[1]}))
   const start=performance.now(),forward=n.route(ends[0],ends[1],true),reverse=n.route(ends[1],ends[0],true)
   return{forward,reverse,queryMs:performance.now()-start}
  })
  for(const route of [report.curve.forward,report.curve.reverse])if(!route||!route.some(p=>Math.abs((p.groundHeight??0)-.2)<1e-6))throw Error('Curve missing from shared driving routes')
 }
 await open('visit=car-share&t=.42');await shot('car-share')
 if(!baseline){
  await page.keyboard.press('e');await page.waitForFunction(()=>window.__spinward.drive.driving)
  await page.getByRole('button',{name:'Places',exact:true}).click();await page.getByRole('button',{name:'Directions to Café',exact:true}).click()
  await page.waitForFunction(()=>window.__spinward.outing.action==='guide-cafe'&&window.__spinward.outing.status==='active')
  report.guided=await shot('driving-directions');const before=await probe()
  try{await page.keyboard.down('w');await page.waitForTimeout(700)}finally{await page.keyboard.up('w')}
  await page.keyboard.down('Space');await page.waitForTimeout(600);await page.keyboard.up('Space')
  report.moved=await shot('driving-moved')
  const a=before.player.drive,b=report.moved.player.drive
  if(Math.hypot((a.azimuth-b.azimuth)*3200,a.axial-b.axial)<.1)throw Error('Real vehicle input did not move the car')
  if(!report.views.every(v=>v.graph?.streets===13176&&v.graph.components===3))throw Error('Shared graph missing')
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({views:report.views.map(v=>({name:v.name,meshes:v.meshes,graph:v.graph})),queryMs:report.curve?.queryMs,errors:report.errors}))
}finally{await fs.writeFile(out+`street-network-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
