import {chromium} from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
const url=process.env.PLATEAU_STUDY_URL,root=process.env.PLATEAU_DATA_ROOT;if(!url||!root)throw Error('Set PLATEAU_STUDY_URL and PLATEAU_DATA_ROOT')
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const context=await browser.newContext({viewport:{width:1600,height:1000},locale:'ja-JP',ignoreHTTPSErrors:true}),page=await context.newPage()
 await page.addInitScript(()=>{
  window.__cold={frames:[],tasks:[],ready:null};let last=null
  new PerformanceObserver(list=>window.__cold.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']})
  function record(now){if(last!==null)window.__cold.frames.push({time:now,ms:now-last});last=now;if(window.__plateau?.rendered&&window.__plateau.detailsReady&&window.__cold.ready===null)window.__cold.ready=now;requestAnimationFrame(record)}requestAnimationFrame(record)
 })
 await page.goto(url+'/?'+(process.env.PLATEAU_ENTRY_QUERY??'world=colony&walk=1'));await page.waitForFunction(()=>window.__cold.ready!==null,null,{timeout:120000});await page.waitForTimeout(4000)
 const result=await page.evaluate(()=>{const p=window.__plateau,g=p.renderer.getContext(),extension=g.getExtension('WEBGL_debug_renderer_info');return{...window.__cold,gpu:extension?g.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unknown',facades:p.facades.get('tokyo').diagnostics(),stream:p.streams.get('tokyo').diagnostics(),base:[...p.baseTiles].map(([id,b])=>({id,...b.diagnostics()})),collision:p.walkWorlds.get('tokyo').diagnostics(),draw:p.renderer.info.render,memory:p.renderer.info.memory,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null}})
 assert.doesNotMatch(result.gpu,/unknown|SwiftShader|Software|llvmpipe/i)
 const stats=rows=>{const a=rows.map(f=>f.ms).sort((a,b)=>a-b);return{frames:a.length,max:a.at(-1),p95:a[Math.floor(a.length*.95)],p50:a[Math.floor(a.length*.5)]}}
 result.cold=stats(result.frames.filter(f=>f.time<=result.ready));result.steady=stats(result.frames.filter(f=>f.time>result.ready+500));delete result.frames
 result.residency=await page.evaluate(()=>{
  const w=window.__plateau,geometries=new Set(),arrays=new Set();let geometryArrayBytes=0
  const add=a=>{if(a&&!arrays.has(a)){arrays.add(a);geometryArrayBytes+=a.byteLength}}
  w.scene.traverse(o=>{if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);for(const a of Object.values(o.geometry.attributes))add(a.array);add(o.geometry.index?.array)}add(o.instanceMatrix?.array);add(o.instanceColor?.array)})
  const resources=performance.getEntriesByType('resource');return{geometryArrayBytes,geometries:geometries.size,resourceRequests:resources.length,encodedBodyBytes:resources.reduce((n,r)=>n+r.encodedBodySize,0),transferBytes:resources.reduce((n,r)=>n+r.transferSize,0)}
 })
 await fs.writeFile(path.join(root,'cold-load.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ready:result.ready,gpu:result.gpu,cold:result.cold,steady:result.steady,buildings:result.facades.buildings,parts:result.facades.parts,compileMs:result.facades.compileMs,draw:result.draw,memory:result.memory,heap:result.heap,tasks:result.tasks},null,2))
}finally{await browser.close()}
