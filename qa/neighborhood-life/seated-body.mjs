import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)), base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/?debug&m=g&a=.11945310290992955&ax=-300.843252130732&t=.42')
  await page.waitForFunction(()=>window.__spinward?.room?.seats?.length&&window.__spinwardBody.group.userData.ready)
  await page.keyboard.press('e');await page.waitForFunction(()=>window.__spinward.room.seat)
  await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())})
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(850);await page.keyboard.up('ArrowDown')
  const samples=[]
  for(const name of ['seated','stood']) {
    if(name==='stood'){await page.keyboard.press('e');await page.waitForTimeout(700)}
    await page.screenshot({path:out+'body-'+name+'-down.png'})
    samples.push(await page.evaluate(()=>({body:window.__spinwardBody.group.userData,visible:window.__spinwardBody.group.visible,seat:window.__spinward.room.seat})))
  }
  if(errors.length||samples[0].body.mode!=='seated'||samples[1].body.mode!=='standing'||samples.some(s=>!s.visible))throw Error(JSON.stringify({errors,samples}))
  fs.writeFileSync(out+'body-seating.json',JSON.stringify({errors,samples},null,2))
  console.log(JSON.stringify({errors,modes:samples.map(s=>s.body.mode)}))
} finally {await browser.close()}
