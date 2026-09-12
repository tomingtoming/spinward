import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser=await chromium.launch({channel:'chrome',headless:true})
const report={errors:[],routes:[]}
try {
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:800}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(`${base}/?debug&lock=0&t=.42&dpr=1`,{waitUntil:'domcontentloaded'})
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardCar?.group.userData.ready)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.waitForTimeout(1000)
 report.routes=await page.evaluate(()=>{
   const nav=window.__spinwardOuting, dest=[...nav.destinations.entries()], r=window.__spinward.radius
   return dest.flatMap(([from,a])=>dest.flatMap(([to,b])=>[false,true].map(driving=>{
     const start=driving?a.bay:a.entrance,goal=driving?b.bay:b.entrance,t=performance.now(),route=start&&goal?nav.route(start,goal,driving):null
     return {from,to,driving,start,goal,route,ms:performance.now()-t}
   })))
 })
 console.log(JSON.stringify(report.routes.map(({route,...r})=>({...r,points:route?.length}))))
 if(report.routes.some(r=>!r.route))throw Error('A neighbourhood route is unavailable')
 await page.getByRole('button',{name:'Places ▾',exact:true}).click()
 await page.locator('.preset-menu:not([hidden])').getByRole('button',{name:'Café',exact:true}).first().click()
 await page.waitForTimeout(1000)
 report.selected=await page.evaluate(()=>window.__spinward.outing)
 await page.screenshot({path:out+'outing-desktop-directions.png'})
 if(report.selected.action!=='guide-cafe')throw Error('Directions did not start')
 console.log(JSON.stringify({selected:report.selected,errors:report.errors}))
}finally{fs.writeFileSync(out+'outing.json',JSON.stringify(report,null,2));await browser.close()}
if(report.errors.length)throw Error(report.errors.join('\n'))
