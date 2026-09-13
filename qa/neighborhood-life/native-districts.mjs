import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalPose} from './signal-views.mjs'
import {nativeDistrictViews} from './native-district-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'final',tier=process.env.TIER??'quest',baseline=process.env.BASELINE_JS
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,errors:[],views:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL/.test(m.text()))report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 if(baseline){const body=await fs.readFile(baseline);await page.route('**/assets/index-*.js',r=>r.fulfill({status:200,body,contentType:'application/javascript'}))}
 const selected=process.env.VIEWS?.split(',')
 const views=nativeDistrictViews.filter(v=>!selected||selected.includes(v.name)).map(v=>({name:v.name,pose:signalPose(v)}))
 if(!views.length)throw Error('No matching views')
 for(const view of views){
  const start=Date.now()
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${view.pose}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.curvedNeighborhood.plan)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(500)
  if(!baseline&&view.name==='spine')await page.waitForFunction(()=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id.startsWith('native:')&&a.visible))
  const probe=await page.evaluate(()=>{
   const city=window.__spinwardCity,p=city.getCityPlan(),routes=city.trafficRoutes,positions=city.getTrafficPositions(),lamps=window.__spinwardStreetLamps
   const place=p.nativeDistricts?.find(d=>d.layout==='place-led'),graph=p.streetNetwork
   const placeTraffic=place?positions.filter(v=>v.height<1&&Math.abs(Math.atan2(Math.sin(v.azimuth-place.azimuth),Math.cos(v.azimuth-place.azimuth)))*3200<place.width/2&&Math.abs(v.axial-place.axial)<place.length/2).map(v=>({position:v,onRoad:graph.query(v.azimuth,v.axial,0,0).some(s=>{
    const path=graph.streets[s.street],dx=s.end.x-s.start.x,dy=s.end.y-s.start.y,px=Math.atan2(Math.sin(v.azimuth-path.azimuth),Math.cos(v.azimuth-path.azimuth))*3200-s.start.x,py=v.axial-path.axial-s.start.y
    const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)))
    return Math.hypot(px-t*dx,py-t*dy)<=path.width/2-.4
   })})):[]
   return{placeTraffic,buildings:p.buildings.length,districts:p.nativeDistricts?.map(d=>({id:d.id,centres:d.centres,azimuth:d.azimuth,axial:d.axial,width:d.width,length:d.length,buildings:d.buildings.length,roads:d.streets.length,growth:d.growth,
    land:d.land?{blocks:d.land.blocks.length,parcels:d.land.parcels.length,unallocatedArea:d.land.unallocatedArea,built:d.buildings.map(b=>({id:b.nativeParcel,azimuth:b.azimuth,axial:b.axial,width:b.width,depth:b.depth,height:b.height,access:b.access}))}:undefined}))??[],
    nativeCars:routes.flatMap((r,i)=>r.native?[{id:r.id,path:r.native.source.path.id,paths:r.native.sources?.map(s=>s.path.id),position:positions[i],stops:r.signals?.length??0}]:[]),
    walkers:window.__spinwardWalkers.group.userData,
    lamps:lamps?{focusAzimuth:lamps.focusAzimuth,focusAxial:lamps.focusAxial,capacity:lamps.posts.capacity,count:lamps.posts.mesh.count,
     spots:lamps.spots.filter(s=>s.heading!==undefined),
     matrices:Array.from({length:lamps.posts.mesh.count},(_,i)=>Array.from(lamps.posts.mesh.instanceMatrix.array.slice(i*16,i*16+16)))}:null,
    pavementEdgeTriangles:window.__spinwardScene.getObjectByName('district-pavement-edges')?.geometry.attributes.position.count/3,
    geometry:window.__spinwardScene.getObjectsByProperty('isMesh',true).filter(m=>m.name.startsWith('street-surface-')).map(m=>({name:m.name,triangles:m.geometry.index.count/3})),
    player:window.__spinward,signals:window.__spinwardIntersections.group.getObjectByName('intersection-signal-heads').userData.nativeApproaches}
  })
  const insideDistrict=p=>probe.districts.some(d=>Math.abs(p.axial-d.axial)<d.length/2&&Math.abs(Math.atan2(Math.sin(p.azimuth-d.azimuth),Math.cos(p.azimuth-d.azimuth)))*3200<d.width/2)
  // A distant camera can be outside every traffic activation window. Require
  // nearby cars when the player is actually inside a rebuilt district.
  if(!baseline&&(probe.districts.length!==11||insideDistrict(probe.player)&&!probe.nativeCars.some(c=>insideDistrict(c.position))))throw Error('Native districts or actual nearby cars on the rebuilt road are missing')
  if(!baseline&&probe.walkers.people>probe.walkers.capacity)throw Error('Walker capacity exceeded')
  if(!baseline&&probe.placeTraffic.some(v=>!v.onRoad))throw Error('A car is following a removed road through the park district')
  if(!baseline&&!probe.districts.some(d=>d.growth?.links.some(l=>l.added&&l.before>l.after*1.8)&&d.growth.deferredLinks.length===0))throw Error('Generated access and detour reduction are missing')
  if(!baseline&&!probe.districts.some(d=>d.land?.blocks>2&&d.land.parcels>=d.buildings&&d.land.built.every(b=>b.id&&b.access)))throw Error('Polygonal land subdivision or its building entrances are missing')
  if(!baseline&&view.name==='park-walk'&&!probe.placeTraffic.length)throw Error('No actual park-district traffic sampled')
  if(!baseline&&process.env.CHECK_CORRIDOR_TRAFFIC==='1'&&view.name==='corridor-seam'){
   probe.corridorTraffic=await page.evaluate(async()=>{
    const city=window.__spinwardCity,d=city.getCityPlan().nativeDistricts.find(d=>d.id==='district-0-region-1'),boundary=d.axial-d.length/2,previous=new Map(),crossings=[],seen=new Set(),until=performance.now()+45000
    let frames=0,maxStep=0
    while(performance.now()<until){
     const positions=city.getTrafficPositions();frames++
     city.trafficRoutes.forEach((route,i)=>{
      if(route.native?.sources.length!==3)return
      const p=positions[i],old=previous.get(route.id);seen.add(route.id)
      if(old){
       const step=Math.hypot(Math.atan2(Math.sin(p.azimuth-old.azimuth),Math.cos(p.azimuth-old.azimuth))*3200,p.axial-old.axial)
       maxStep=Math.max(maxStep,step)
       if((p.axial-boundary)*(old.axial-boundary)<0&&step<10)crossings.push({id:route.id,from:old,to:p,paths:route.native.sources.map(s=>s.path.id)})
      }
      previous.set(route.id,p)
     })
     await new Promise(r=>setTimeout(r,100))
    }
    return{boundary,frames,cars:seen.size,crossings,maxStep}
   })
   if(!probe.corridorTraffic.crossings.length)throw Error('No same-identity car observed crossing the district boundary')
  }
  const file=`native-districts-${tier}-${label}-${view.name}.png`;await page.screenshot({path:out+file});report.views.push({name:view.name,file,loadAndCaptureMs:Date.now()-start,...probe})
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({gpu:report.gpu,views:report.views.map(v=>({name:v.name,buildings:v.buildings,districts:v.districts,cars:v.nativeCars.length})),errors:report.errors}))
}finally{await fs.writeFile(out+`native-districts-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
