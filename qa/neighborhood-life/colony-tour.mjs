import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',out=fileURLToPath(new URL('.',import.meta.url))
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const reports=[],errors=[]
 const configs=[
  {preset:'izma',time:'.42',tier:'desktop',stops:['Surface','Old Town','Overlook','Axis','Exterior']},
  {preset:'izma',time:'.9',tier:'desktop',stops:['Surface','Old Town','Overlook','Axis','Exterior']},
  {preset:'cooper',time:'.42',tier:'desktop',stops:['Surface','Overlook','Axis','Exterior']},
  {preset:'elysium',time:'.42',tier:'desktop',stops:['Surface','Overlook','Axis','Exterior']},
  {preset:'playground',time:'.42',tier:'desktop',stops:['Surface','Overlook','Axis','Exterior']},
  {preset:'izma',time:'.9',tier:'phone',stops:['Surface','Old Town','Overlook','Axis','Exterior']},
 ].filter(c=>!process.env.PRESET||c.preset===process.env.PRESET)
  .map(c=>({...c,stops:process.env.STOPS?process.env.STOPS.split(','):c.stops}))
 for(const config of configs){
  const phone=config.tier==='phone'
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:phone?{width:390,height:844}:{width:1440,height:1000},hasTouch:phone,deviceScaleFactor:1})
  page.on('pageerror',e=>errors.push({config,message:e.message}))
  await page.goto(base+`/?debug&stats&preset=${config.preset}&t=${config.time}&tier=${config.tier}&dpr=1`)
  await page.waitForSelector('#splash',{state:'detached'})
  for(const stop of config.stops){
   if(phone)await page.getByRole('button',{name:'Travel ▾',exact:true}).click()
   await page.getByRole('button',{name:stop,exact:true}).click()
   await page.waitForTimeout(1800)
   await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove()})
   const name=`${process.env.PREFIX??'tour'}-${config.preset}-${config.time==='.42'?'day':'night'}-${config.tier}-${stop.toLowerCase().replaceAll(' ','-')}`
   const data=await page.evaluate(()=>({state:window.__spinward,body:{visible:window.__spinwardBody.group.visible,...window.__spinwardBody.group.userData},walkers:{visible:window.__spinwardWalkers.group.visible,...window.__spinwardWalkers.group.userData},stats:document.querySelector('.stats-overlay')?.textContent}))
   if(stop==='Exterior')data.view=await page.evaluate(()=>{
    const c=window.__spinwardScene.getObjectByName('coffee-held').parent
    const p=c.getWorldPosition(c.position.clone()),d=c.getWorldDirection(c.position.clone())
    return {camera:p.toArray(),forward:d.toArray(),centre:c.position.clone().set(0,0,0).project(c).toArray(),alignment:d.dot(p.clone().negate().normalize())}
   })
   const event={'Surface':'surface','Old Town':'old-town','Overlook':'overlook','Axis':'axis','Exterior':'exterior'}[stop]
   if(data.state.tour!==event)throw Error(`Stale destination card at ${stop}: ${data.state.tour}`)
   await page.screenshot({path:out+name+'.png'})
   reports.push({name,...data});console.log(JSON.stringify({name,stats:data.stats,mode:data.state.mode,altitude:data.state.altitude,bodyVisible:data.body.visible}))
  }
  await page.close()
 }
 fs.writeFileSync(out+(process.env.PREFIX??'colony-tour')+'.json',JSON.stringify({errors,reports},null,2))
 if(errors.length)throw Error(JSON.stringify(errors))
}finally{await browser.close()}
