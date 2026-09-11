// Same warmed scene, reversed order: isolate the new nearby population from
// the existing cafe/crossing residents. Desktop GPU measurements only.
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/?debug&stats&m=g&a=0&ax=-200&t=.42&dpr=1')
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardWalkers.group.userData.people===8)
 await page.waitForTimeout(3000)
 const reports=[]
 for(const enabled of [false,true,true,false]){
  await page.evaluate(value=>window.__spinwardWalkers.enabled=value,enabled)
  await page.waitForTimeout(1000)
  const data=await page.evaluate(async()=>{
   const times=[];let last=performance.now()
   for(let i=0;i<240;i++)await new Promise(resolve=>requestAnimationFrame(now=>{times.push(now-last);last=now;resolve()}))
   times.shift();times.sort((a,b)=>a-b)
   const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean)
   const ext=gl.getExtension('WEBGL_debug_renderer_info')
   return {median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',stats:document.querySelector('.stats-overlay')?.textContent}
  })
  if(/SwiftShader|llvmpipe/i.test(data.renderer))throw Error('Software renderer is not a device performance measurement')
  reports.push({enabled,...data})
 }
 if(errors.length)throw Error(JSON.stringify(errors))
 fs.writeFileSync(fileURLToPath(new URL('street-walkers-performance.json',import.meta.url)),JSON.stringify({errors,reports},null,2))
 console.log(JSON.stringify(reports))
}finally{await browser.close()}
