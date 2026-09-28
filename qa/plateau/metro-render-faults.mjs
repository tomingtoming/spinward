// Fault injection at the real visual-arrival boundary, without overriding the
// physics gate. A late GPU preparation must not repopulate a departed habitat.
import {chromium,expect} from '@playwright/test'
import fs from 'node:fs/promises'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL and evidence directory required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[]
try{
  const page=await browser.newPage({viewport:{width:1280,height:960}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const failedCover='**/render-v2/bootstrap/east.bin.gz'
  await page.route(failedCover,r=>r.fulfill({status:503,body:'QA: initial visual cover unavailable'}))
  await page.goto(url+'/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
  await page.waitForFunction(()=>window.__spinward?.regional.state==='failed',null,{timeout:30000})
  const before=await page.evaluate(()=>window.__spinward)
  await page.keyboard.down('KeyW');await page.keyboard.down('Space');await page.waitForTimeout(800)
  await page.keyboard.up('KeyW');await page.keyboard.up('Space')
  const held=await page.evaluate(()=>window.__spinward)
  expect(held.frameAngle).toBe(before.frameAngle);expect(held.axial).toBe(before.axial);expect(held.radial).toBe(before.radial)
  expect(held.metro.operational).toBe(false)
  await page.screenshot({path:output+'/missing-initial-cover.png'})
  await page.unroute(failedCover)
  await page.evaluate(()=>window.__spinwardOuting.action('respawn-inner-wall'))
  await page.waitForFunction(()=>window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded',null,{timeout:60000})
  const recovered=await page.evaluate(()=>window.__spinward)
  await page.evaluate(()=>{
    const m=window.__spinwardMetro,prepare=m.prepareVisual
    window.__originalVisualPrepare=prepare;window.__holdNextVisual=true
    m.prepareVisual=async function(object){
      await prepare(object)
      if(window.__holdNextVisual){window.__holdNextVisual=false;await new Promise(resolve=>{window.__releaseVisual=resolve;window.__visualHeld=true})}
    }
    window.__spinwardOuting.action('preset-apply-cooper')
  })
  await page.waitForFunction(()=>window.__spinward.metro===null)
  await page.evaluate(()=>window.__spinwardOuting.action('preset-apply-izma'))
  await page.waitForFunction(()=>window.__visualHeld,null,{timeout:30000})
  await page.evaluate(()=>window.__spinwardOuting.action('preset-apply-cooper'))
  await page.waitForFunction(()=>window.__spinward.metro===null)
  await page.evaluate(()=>{window.__spinwardMetro.prepareVisual=window.__originalVisualPrepare;window.__releaseVisual()})
  await page.waitForTimeout(500)
  const departed=await page.evaluate(()=>({active:window.__spinwardMetro.active,children:window.__spinwardMetro.group.children.length,trees:!!window.__spinwardMetro.trees}))
  expect(departed).toEqual({active:false,children:0,trees:false})
  await page.evaluate(()=>window.__spinwardOuting.action('preset-apply-izma'))
  await page.waitForFunction(()=>window.__spinward.metro?.ready&&window.__spinward.regional.state==='ready',null,{timeout:60000})
  await page.evaluate(()=>window.__spinwardOuting.action('respawn-inner-wall'))
  await page.waitForFunction(()=>window.__spinward.mode==='grounded'&&!window.__spinward.regional.pendingArrival&&window.__spinward.regional.state==='ready')
  const returned=await page.evaluate(()=>window.__spinward)
  expect(errors).toEqual([])
  await page.screenshot({path:output+'/returned.png'})
  await fs.writeFile(output+'/faults.json',JSON.stringify({before,held,recovered,departed,returned,errors},null,2))
  console.log('Initial visual failure held physics; retry recovered; late preparation left the departed habitat empty.')
}finally{await browser.close()}
