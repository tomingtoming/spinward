import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalPose} from './signal-views.mjs'
import {nativeDistrictViews} from './native-district-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'final',unavailable=process.env.EXPECT_UNAVAILABLE==='1'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL(`../webxr/evidence/arrival-guidance-20260914/${label}/`,import.meta.url))
await fs.mkdir(out,{recursive:true})
const report={label,unavailable,errors:[],views:[]},browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 for(const [name,phase] of [['day',.42],['night',.02]]){
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose({...nativeDistrictViews.find(v=>v.name==='arrival-street'),phase})}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardOuting?.destinations.has('guide-park'));await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  for(const [id,destination] of [['guide-square','Central Square'],['guide-park','Park']]){
   await page.getByRole('button',{name:'Places',exact:true}).click();const started=Date.now();await page.getByRole('button',{name:`Directions to ${destination}`,exact:true}).click()
   await page.waitForFunction(({id,unavailable})=>window.__spinward.outing.action===id&&window.__spinward.outing.status===(unavailable?'unavailable':'active'),{id,unavailable})
   const result=await page.evaluate(()=>({outing:window.__spinward.outing,mode:window.__spinward.mode,ground:window.__spinward.groundHeight,points:window.__spinwardOuting.journey.points.length}))
   const uiResponseMs=Date.now()-started;await page.screenshot({path:`${out}${name}-${id}.png`})
   report.views.push({name,id,uiResponseMs,...result})
  }
 }
 if(report.errors.length)throw Error(report.errors.join('; '))
}finally{await fs.writeFile(`${out}desktop.json`,JSON.stringify(report,null,2));await browser.close()}
console.log(JSON.stringify(report))
