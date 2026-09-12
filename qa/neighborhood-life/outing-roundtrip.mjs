import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser=await chromium.launch({channel:'chrome',headless:true}), report={errors:[],legs:[]}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:800}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(`${base}/?debug&lock=0&t=.42&dpr=1&visit=car-share`)
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCar?.group.userData.ready)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 const state=()=>page.evaluate(()=>window.__spinward)
 const sleep=ms=>page.waitForTimeout(ms)
 const dist=(a,b,r=3200)=>Math.hypot(Math.atan2(Math.sin(a.azimuth-b.azimuth),Math.cos(a.azimuth-b.azimuth))*r,a.axial-b.axial)
 const shot=label=>page.screenshot({path:out+`outing-${label}.png`})
 const walkTo=async goal=>{
  const started=Date.now();await page.keyboard.down('w')
  try{while(Date.now()-started<45000){
   const s=await state();if(dist(s,goal,s.radius)<.75)return
   const h=Math.atan2(Math.atan2(Math.sin(goal.azimuth-s.azimuth),Math.cos(goal.azimuth-s.azimuth))*s.radius,goal.axial-s.axial)
   await page.evaluate(h=>window.__spinwardOuting.face(h),h);await sleep(80)
  }throw Error('Walking leg timed out '+JSON.stringify({goal,state:await state()}))}finally{await page.keyboard.up('w')}
 }
 // One debug setup at the approach to each district. Movement, braking,
 // parking, walking, coffee and re-entry use real controls after that setup.
 for(const id of ['guide-cafe','guide-park','guide-square']){
   const bay=await page.evaluate(id=>window.__spinwardOuting.destinations.get(id).bay,id)
   await page.evaluate(({bay,id})=>{
     window.__spinwardDrive.enterAt(bay.azimuth-Math.sin(bay.heading)*18/3200,bay.axial-Math.cos(bay.heading)*18,bay.heading)
     window.__spinwardOuting.action(id)
   },{bay,id})
   await sleep(1200);await page.keyboard.press('w');await sleep(500);await shot(id+'-drive')
   const before=await state();let elapsed=Date.now(),maxSpeed=0
   while(Date.now()-elapsed<25000){
     const s=await state(),d=dist(s.drive,bay,s.radius),v=s.drive.speed;maxSpeed=Math.max(maxSpeed,v)
     if(d<1.5&&v<.45)break
     if(d<v*v/10+1 || v>4){await page.keyboard.up('w');await page.keyboard.down('Space')}
     else {await page.keyboard.up('Space');await page.keyboard.down('w')}
     await sleep(80)
   }
   await page.keyboard.up('w');await page.keyboard.down('Space');await sleep(400);await page.keyboard.up('Space')
   const stopped=await state();if(!stopped.outing.canPark)throw Error('Could not park '+JSON.stringify(stopped.drive))
   await page.getByRole('button',{name:'Park',exact:true}).click()
   await page.waitForFunction(()=>!window.__spinward.drive.driving&&window.__spinward.mode==='grounded')
   await sleep(700);const parked=await state();
   await page.evaluate(bay=>{const s=window.__spinward;window.__spinwardOuting.face(Math.atan2((bay.azimuth-s.azimuth)*s.radius,bay.axial-s.axial))},bay);await sleep(300);await shot(id+'-parked')
   if(parked.outing.action!==id)throw Error('Parking lost the outing')
   const entrance=await page.evaluate(id=>window.__spinwardOuting.destinations.get(id).entrance,id)
   if(id==='guide-cafe'){
     await walkTo(entrance)
     const coffee=await page.evaluate(()=>window.__spinwardCity.getInteriorVisit('coffee'))
     await walkTo({azimuth:entrance.azimuth,axial:coffee.axial-1.5})
     await walkTo(coffee)
     await page.waitForFunction(()=>!!document.querySelector('.coffee-action')&&!document.querySelector('.coffee-action').hidden)
     await shot('cafe-counter')
     await page.keyboard.press('c');await page.waitForFunction(()=>window.__spinward.room.coffee.phase==='ready');await page.keyboard.press('c');await sleep(500)
     await shot('cafe-coffee');report.coffee=await state()
     if(report.coffee.room.coffee.phase!=='holding')throw Error('Coffee did not begin')
     await page.evaluate(()=>window.__spinwardOuting.action('guide-car'))
     report.indoorReturn=await page.evaluate(()=>({status:window.__spinwardOuting.journey.status,points:window.__spinwardOuting.journey.points}))
     if(report.indoorReturn.status==='unavailable')throw Error('No route back from café')
     // Walk through the same doorway; the parked car must stay where it was.
     await walkTo({azimuth:entrance.azimuth,axial:coffee.axial-1.5});await walkTo(entrance)
   }else if(id==='guide-park'){
     await walkTo(entrance)
     const park=await page.evaluate(()=>window.__spinwardCity.getPublicPark())
     await walkTo({azimuth:park.azimuth+10/3200,axial:park.axial})
     await walkTo({azimuth:park.azimuth+10/3200,axial:park.axial-12})
     await walkTo({azimuth:park.azimuth+4/3200,axial:park.axial-12})
     const seat=await page.evaluate(()=>window.__spinward.room.seats.find(s=>s.id==='park-bench-1'))
     await walkTo({azimuth:seat.exit.azimuth,axial:seat.exit.axialPosition})
     await page.keyboard.press('e');await sleep(500);report.seated=await state();await shot('park-bench')
     if(!report.seated.room.seat)throw Error('Park bench was unusable')
     await page.keyboard.press('e');await sleep(500)
     await walkTo({azimuth:park.azimuth+10/3200,axial:park.axial-12});await walkTo({azimuth:park.azimuth+10/3200,axial:park.axial});await walkTo(entrance)
   }
   await page.evaluate(()=>window.__spinwardOuting.action('guide-car'))
   const points=await page.evaluate(()=>window.__spinwardOuting.journey.points)
   if(!points.length)throw Error('No return route')
   // Stop within reach on the pavement, before crossing into the car itself.
   for(const p of points.slice(1)) {if(dist(await state(),bay)<5)break;await walkTo(p)}
   const returned=await state();if(dist(returned.drive,parked.drive)>.1)throw Error('Parked car moved while walking')
   await page.keyboard.press('e');await page.waitForFunction(()=>window.__spinward.drive.driving && window.__spinward.outing.action===null)
   report.legs.push({id,before:before.drive,stopped:stopped.drive,parked:parked.drive,returned:returned.drive,maxSpeed})
   console.log(JSON.stringify({id,maxSpeed,parked:parked.drive,returnStatus:returned.outing.status}))
 }
 await shot('returned-car')
 // Phone layout uses the same route action through Travel.
 await page.setViewportSize({width:390,height:844});await sleep(300)
 await page.getByRole('button',{name:'Places',exact:true}).click()
 await page.locator('.preset-menu:not([hidden])').getByRole('button',{name:'Directions to Park',exact:true}).click()
 await sleep(400);await shot('phone-directions')
 const dimensions=await page.locator('.outing-panel').boundingBox();if(dimensions.x<0||dimensions.x+dimensions.width>391)throw Error('Phone route card overflow')
 await page.getByRole('button',{name:'Menu',exact:true}).click()
 await page.getByRole('button',{name:'Street ▾',exact:true}).click()
 await page.getByRole('button',{name:'Switch Street / Experiment',exact:true}).click()
 await page.waitForFunction(()=>window.__spinward.drive.mode==='experiment')
 report.final=await state()
}finally{fs.writeFileSync(out+'outing-roundtrip.json',JSON.stringify(report,null,2));await browser.close()}
if(report.errors.length)throw Error(report.errors.join('\n'))
