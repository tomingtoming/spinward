// Zero-time focus changes on both surface axes and three actual city plans.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',out=fileURLToPath(new URL('.',import.meta.url))
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],reports=[]
const save=()=>fs.writeFileSync(out+'traffic-streaming.json',JSON.stringify({errors,reports},null,2))
try {
 for(const preset of ['izma','cooper','elysium']) {
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`${base}/?debug&lock=0&preset=${preset}&t=.42&tier=${preset==='cooper'?'phone':'desktop'}&dpr=1`)
  await page.waitForSelector('#splash',{state:'detached'})
  await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked)
  await page.waitForTimeout(2000)
  const cases=await page.evaluate(()=>{
   const c=window.__spinwardCity,results=[]
   const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a))
   const snapshot=()=>{
    const positions=c.getTrafficPositions(),map=new Map()
    c.trafficRoutes.forEach((r,i)=>{if(!(c.neighborhoodTurn&&i===c.trafficRoutes.length-1))map.set(r.id,{...positions[i],variant:r.variant,color:r.color,route:r})})
    return map
   }
   const center={azimuth:c.cityFocusAzimuth,axial:c.cityFocusAxial}
   for(const [axis,distance] of [['axial',32],['axial',64],['axial',-32],['axial',0],['tangent',32],['tangent',64],['tangent',-32],['tangent',0],['axial',320],['axial',0]]) {
    c.update(.1)
    const before=snapshot(),az=center.azimuth+(axis==='tangent'?distance/c.radius:0),ax=center.axial+(axis==='axial'?distance:0)
    c.setFocusSurface(az,ax,1.6)
    const after=snapshot(),defects=[],overlaps=[]
    for(const [id,old] of before) {
     const near=Math.hypot(wrap(old.azimuth-az)*c.radius,old.axial-ax)<150
     const next=after.get(id)
     if(!next){if(near)defects.push({id,type:'disappeared',old});continue}
     const span=next.route,retained=span.kind==='street'||old.axial>span.spanStart+.01&&old.axial<span.spanStart+span.spanLength-.01
     const moved=Math.hypot(wrap(next.azimuth-old.azimuth)*c.radius,next.axial-old.axial)
     if(retained&&(moved>.001||Math.abs(next.speed-old.speed)>.001||next.variant!==old.variant||next.color!==old.color))defects.push({id,type:'changed',moved,oldSpeed:old.speed,speed:next.speed})
    }
    const lanes=new Map()
    for(const [id,car] of after) {
     const r=car.route;if(c.radius-r.surfaceRadius>=1)continue
     const key=[r.kind,r.laneAzimuth,r.laneAxial,r.direction].join(':')
     const lane=lanes.get(key)??[];lane.push({id,along:r.kind==='avenue'?car.axial:wrap(car.azimuth-r.laneAzimuth)*c.radius});lanes.set(key,lane)
    }
    for(const lane of lanes.values()) {
     lane.sort((a,b)=>a.along-b.along)
     for(let i=1;i<lane.length;i++)if(lane[i].along-lane[i-1].along<4.4)overlaps.push({cars:[lane[i-1].id,lane[i].id],gap:lane[i].along-lane[i-1].along})
    }
    results.push({axis,distance,defects,overlaps,count:c.trafficRoutes.length})
   }
   return results
  })
  reports.push({preset,cases});save()
  console.log(JSON.stringify({preset,defects:cases.flatMap(c=>c.defects),overlaps:cases.flatMap(c=>c.overlaps),counts:cases.map(c=>c.count)}))
  await page.close()
 }
 if(errors.length||reports.some(r=>r.cases.some(c=>c.defects.length||c.overlaps.length)))throw Error('Traffic focus continuity failed')
} catch(error){errors.push(String(error));save();throw error} finally{save();await browser.close()}
