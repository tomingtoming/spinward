// Ten-minute return flights. Measurements live in Node, not accumulating in the
// measured page. GC at rest distinguishes live residency from an uncollected heap.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'

const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL and evidence directory required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),samples=[],errors=[]
try{
  const context=await browser.newContext({viewport:{width:1280,height:960},deviceScaleFactor:1}),page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const cdp=await context.newCDPSession(page),system=await browser.newBrowserCDPSession()
  await cdp.send('Performance.enable')
  await page.goto(url+'/?city=tokyo&preset=izma&region=west&place=omiya&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
  await page.waitForFunction(()=>window.__spinwardMetro?.ready&&window.__spinwardMetro.layers.every(l=>l.base.ready)&&window.__spinward.regional.state==='ready',null,{timeout:240000})
  await page.waitForTimeout(2000)
  const start=Date.now()
  for(let cycle=0;cycle<=15;cycle++){
    if(cycle){
      const began=Date.now()
      await page.keyboard.down('Space');await page.waitForTimeout(5000);await page.keyboard.up('Space')
      await page.keyboard.down('KeyW');await page.waitForTimeout(4000);await page.keyboard.up('KeyW')
      await page.keyboard.down('ArrowRight');await page.waitForTimeout(2244);await page.keyboard.up('ArrowRight')
      await page.waitForTimeout(Math.max(0,40000-(Date.now()-began)))
    }
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics=await cdp.send('Performance.getMetrics'),m=Object.fromEntries(metrics.metrics.map(m=>[m.name,m.value]))
    const snapshot=await page.evaluate(()=>({mode:window.__spinward.mode,axial:window.__spinward.axial,azimuth:window.__spinward.azimuth,
      gate:window.__spinward.regional,metro:window.__spinwardMetro.diagnostics(),gpu:{...window.__spinwardRenderer.info.memory,programs:window.__spinwardRenderer.info.programs.length}}))
    const processes=await system.send('SystemInfo.getProcessInfo'),pids=processes.processInfo.map(p=>p.id).filter(Number.isInteger)
    const ps=await promisify(execFile)('/bin/ps',['-o','pid=,rss=','-p',pids.join(',')])
    const rss=ps.stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number))
    const row={cycle,seconds:(Date.now()-start)/1000,heap:m.JSHeapUsedSize,rssBytes:rss.reduce((n,[,kb])=>n+kb*1024,0),processes:rss,...snapshot}
    samples.push(row)
    assert.equal(row.gate.state,'ready');assert.equal(row.metro.visualFailure??null,null)
    assert.ok(row.metro.nativeTiles.bytes<=8*1024*1024)
    assert.ok(row.metro.collision.bytes<=144*1024*1024)
    for(const layer of row.metro.layers){
      assert.ok(layer.base.nearDecodedBytes<=24*1024*1024&&layer.base.resident.length<=25)
      assert.ok(layer.base.far.decodedBytes<=48*1024*1024&&layer.base.far.resident.length<=32)
      assert.ok(layer.recipes<=6*1024*1024)
      if(layer.lowrise)assert.ok(layer.lowrise.bytes<=8*1024*1024&&layer.lowrise.resident<=32)
    }
    await fs.writeFile(output+'/memory.json',JSON.stringify({start,forcedGC:true,samples,errors},null,2))
    console.log('memory',cycle,Math.round(row.heap/1048576)+' MiB heap',Math.round(row.rssBytes/1048576)+' MiB process RSS',row.gpu,'axial',row.axial)
  }
  assert.equal(errors.length,0);assert.ok(samples.at(-1).seconds>=600)
  await page.screenshot({path:output+'/final.png'})
}finally{await browser.close()}
