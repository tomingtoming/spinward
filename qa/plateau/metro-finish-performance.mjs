// Paired old/new sample under the same host load; optional layers are isolated
// only in this probe, never via shipping behaviour or an application shortcut.
import {chromium,expect} from '@playwright/test'
import fs from 'node:fs/promises'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_BASELINE:baseline,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!baseline||!output)throw Error('Set candidate, baseline and output')
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
try{
  const page=await browser.newPage({viewport:{width:1280,height:960},deviceScaleFactor:1})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  async function boot(base){
    await page.goto(base+'/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
    await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    await page.waitForTimeout(3000)
  }
  async function measure(label){
    const result=await page.evaluate(()=>new Promise(resolve=>{
      const deltas=[];let previous=performance.now(),start=previous
      function tick(now){deltas.push(now-previous);previous=now
        if(now-start<4000)return requestAnimationFrame(tick)
        deltas.sort((a,b)=>a-b);const s=window.__spinwardWatch.snapshot
        resolve({fps:deltas.length/(now-start)*1000,p50:deltas[Math.floor(deltas.length*.5)],p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),triangles:s.triangles,drawCalls:s.drawCalls})
      }requestAnimationFrame(tick)
    }))
    results.push({label,...result});console.log(label,JSON.stringify(result))
  }
  await boot(baseline);await measure('baseline')
  await boot(url);await measure('finish')
  await page.evaluate(()=>{const t=window.__spinwardMetro.trees;t.group.visible=false;t.__update=t.update;t.update=()=>{}})
  await measure('without-trees')
  await page.evaluate(()=>{for(const n of ['source-surface-detail','landmark-surface-detail'])for(const m of window.__spinwardScene.getObjectsByProperty('name',n))m.visible=false})
  await measure('without-trees-or-surfaces')
  await page.evaluate(()=>{const t=window.__spinwardMetro.trees;t.group.visible=true;t.update=t.__update;for(const n of ['source-surface-detail','landmark-surface-detail'])for(const m of window.__spinwardScene.getObjectsByProperty('name',n))m.visible=true})
  await measure('finish-repeat')
  await boot(baseline);await measure('baseline-repeat')
  expect(results.every(r=>Number.isFinite(r.fps))).toBe(true)
  await fs.mkdir(output,{recursive:true});await fs.writeFile(output+'/paired-performance.json',JSON.stringify({viewport:[1280,960],dpr:1,tier:'quest',secondsPerSample:4,results},null,2))
}finally{await browser.close()}
