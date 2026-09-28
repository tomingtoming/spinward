import {chromium} from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const url=process.env.PLATEAU_STUDY_URL;if(!url)throw Error('Set PLATEAU_STUDY_URL')
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const context=await browser.newContext({viewport:{width:1600,height:1000},locale:'ja-JP'}),page=await context.newPage()
 await page.addInitScript(()=>{
  window.__cold={frames:[],tasks:[],ready:null};let last=null
  new PerformanceObserver(list=>window.__cold.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']})
  function record(now){if(last!==null)window.__cold.frames.push({time:now,ms:now-last});last=now;if(window.__plateau?.rendered&&window.__plateau.detailsReady&&window.__cold.ready===null)window.__cold.ready=now;requestAnimationFrame(record)}requestAnimationFrame(record)
 })
 await page.goto(url+'/?world=colony&walk=1');await page.waitForFunction(()=>window.__cold.ready!==null);await page.waitForTimeout(4000)
 const result=await page.evaluate(()=>{const p=window.__plateau,g=p.renderer.getContext(),extension=g.getExtension('WEBGL_debug_renderer_info');return{...window.__cold,gpu:extension?g.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unknown',facades:p.facades.get('tokyo').diagnostics(),stream:p.streams.get('tokyo').diagnostics(),draw:p.renderer.info.render,memory:p.renderer.info.memory,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null}})
 assert.doesNotMatch(result.gpu,/unknown|SwiftShader|Software|llvmpipe/i)
 const stats=rows=>{const a=rows.map(f=>f.ms).sort((a,b)=>a-b);return{frames:a.length,max:a.at(-1),p95:a[Math.floor(a.length*.95)],p50:a[Math.floor(a.length*.5)]}}
 result.cold=stats(result.frames.filter(f=>f.time<=result.ready));result.steady=stats(result.frames.filter(f=>f.time>result.ready+500));delete result.frames
 await fs.writeFile(new URL('../webxr/evidence/plateau-citywide-20260923/cold-load.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({ready:result.ready,gpu:result.gpu,cold:result.cold,steady:result.steady,buildings:result.facades.buildings,parts:result.facades.parts,compileMs:result.facades.compileMs,draw:result.draw,memory:result.memory,heap:result.heap,tasks:result.tasks},null,2))
}finally{await browser.close()}
