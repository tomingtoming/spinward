import {chromium,expect} from '@playwright/test'
import fs from 'node:fs/promises'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL and output required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  const page=await browser.newPage({viewport:{width:1280,height:960}})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto(url+'/?city=tokyo&preset=izma&place=omiya&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
  await page.waitForFunction(()=>window.__spinward?.regional?.state==='ready'&&window.__spinward.metro?.ready&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
  // Inject failure in the real asynchronous collision source, then request a
  // destination through the actual app action. No physics/readiness stubbing.
  await page.evaluate(()=>{
    const c=window.__spinwardMetro.collision,load=c.load
    window.__faultLoads=[];window.__faultEnabled=true
    c.load=async function(tile,signal){
      if(window.__faultEnabled){window.__faultLoads.push(tile.id);throw Error('QA injected missing collision response')}
      return load.call(this,tile,signal)
    }
    window.__spinwardOuting.action('respawn-overlook')
  })
  await page.waitForFunction(()=>window.__spinward.regional.state==='failed',null,{timeout:15000})
  const before=await page.evaluate(()=>window.__spinward)
  await page.keyboard.down('KeyW');await page.keyboard.down('Space');await page.waitForTimeout(1200)
  await page.keyboard.up('KeyW');await page.keyboard.up('Space')
  const held=await page.evaluate(()=>window.__spinward)
  expect(held.frameAngle).toBe(before.frameAngle);expect(held.axial).toBe(before.axial);expect(held.radial).toBe(before.radial)
  expect(held.regional.pendingArrival).toBe(true);expect(held.regional.error).toContain('QA injected')
  await page.screenshot({path:output+'/missing-critical.png'})
  await page.evaluate(()=>{window.__faultEnabled=false;window.__spinwardOuting.action('respawn-overlook')})
  await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:30000})
  const arrival=await page.evaluate(()=>window.__spinward)
  expect(Math.abs(arrival.axial-held.axial)).toBeGreaterThan(100)
  await page.evaluate(()=>window.__spinwardOuting.action('respawn-inner-wall'))
  await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded')
  const recovered=await page.evaluate(()=>({state:window.__spinward,failures:window.__faultLoads}))
  expect(recovered.state.regional.failed).toEqual([])
  await page.screenshot({path:output+'/recovered.png'})
  await fs.writeFile(output+'/faults.json',JSON.stringify({before,held,arrival,recovered},null,2))
  console.log(JSON.stringify({failedLoads:recovered.failures.length,pausedFrame:before.frameAngle,recovered:recovered.state.regional}))
}finally{await browser.close()}
