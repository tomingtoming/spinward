import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_BASELINE:baseline,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!baseline||!output)throw Error('Explicit candidate, baseline and output required')
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  for(const [label,base] of [['before',baseline],['after',url],['before-repeat',baseline]]){
    await page.goto(base+'/?city=tokyo&preset=izma&region=west&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.8')
    await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.mode==='grounded'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    await page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0].rotation.set(.45,0,0,'YXZ'))
    await page.waitForTimeout(2000)
    const result=await page.evaluate(()=>new Promise(resolve=>{
      const deltas=[];let previous=performance.now(),start=previous
      function tick(now){deltas.push(now-previous);previous=now
        if(now-start<6000)return requestAnimationFrame(tick)
        deltas.sort((a,b)=>a-b);const s=window.__spinwardWatch.snapshot
        resolve({fps:deltas.length/(now-start)*1000,p50:deltas[Math.floor(deltas.length*.5)],p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),triangles:s.triangles,drawCalls:s.drawCalls,
          streams:window.__spinwardMetro.layers.map(l=>l.base.diagnostics())})
      }requestAnimationFrame(tick)
    }))
    results.push({label,...result});console.log(label,JSON.stringify({...result,streams:undefined}))
  }
  await fs.mkdir(output,{recursive:true});await fs.writeFile(output+'/paired-performance.json',JSON.stringify({viewport:[1600,1000],dpr:1,tier:'quest',secondsPerSample:6,results},null,2))
}finally{await browser.close()}
