// Same scene and quality, ABBA order, physical desktop GPU. These timings are
// browser animation intervals after warm-up, not physical Quest frame times.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {signalPose} from './signal-views.mjs'
import {nativeDistrictViews} from './native-district-views.mjs'
const base=process.env.SPINWARD_URL,baseline=process.env.BASELINE_JS,out=process.env.OUTPUT
if(!base||!baseline||!out)throw Error('SPINWARD_URL, BASELINE_JS and absolute OUTPUT are required')
const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],samples:[]}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const old=await fs.readFile(baseline)
 for(const name of ['corridor-seam','corridor-band-0'])for(const version of ['before','after','after','before']){
  await page.unroute('**/assets/index-*.js')
  if(version==='before')await page.route('**/assets/index-*.js',r=>r.fulfill({status:200,body:old,contentType:'application/javascript'}))
  await page.goto(`${base}/?debug&stats&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(nativeDistrictViews.find(v=>v.name===name))}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.waitForTimeout(3500)
  const data=await page.evaluate(async()=>{
   const times=[],draws=[],triangles=[];let last
   for(let i=0;i<241;i++)await new Promise(resolve=>requestAnimationFrame(now=>{
    if(last!==undefined)times.push(now-last);last=now
    const p=window.__spinwardWatch.snapshot;draws.push(p.drawCalls);triangles.push(p.triangles);resolve()
   }))
   const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],sorted=[...times].sort((a,b)=>a-b)
   return{frames:times.length,medianMs:median(times),p95Ms:sorted[Math.floor(sorted.length*.95)],meanMs:times.reduce((a,b)=>a+b,0)/times.length,drawCalls:median(draws),triangles:median(triangles),stats:document.querySelector('.stats-overlay')?.textContent}
  })
  report.samples.push({name,version,...data});console.log(JSON.stringify(report.samples.at(-1)))
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
}finally{await fs.writeFile(out,JSON.stringify(report,null,2));await browser.close()}
