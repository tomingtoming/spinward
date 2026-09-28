import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {X509Certificate,createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {releaseEndpoints} from './metro-release-network.mjs'

const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit HTTPS candidate and evidence directory required')
const endpoints=releaseEndpoints(url,process.env.SPINWARD_METRO_DATA_URL)
await fs.mkdir(output,{recursive:true})
// Trust only this local test certificate, keeping certificate-error handling
// out of the cache comparison. Navigation and reload are different cache cases.
const certificate=new X509Certificate(await fs.readFile(new URL('../../node_modules/.vite/basic-ssl/_cert.pem',import.meta.url)))
const spki=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64')
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'spinward-release-cache-'))
const browser=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`,'--disk-cache-size=536870912','--remote-debugging-port=0'],viewport:{width:1280,height:960},deviceScaleFactor:1,locale:'en-US'}),results=[]
await fs.writeFile(output+'/browser.json',JSON.stringify({profile,pid:process.pid}))
const bounded=(promise,ms=5000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('diagnostic timeout')),ms)})]).finally(()=>clearTimeout(timer))}
function wireAtUsable(requests,timings){
 const local=requests.filter(r=>endpoints.owns(r.url)),cdpBytes=local.reduce((n,r)=>n+(r.bytes??r.partial),0)
 // Chrome reports the worker script request on the page target but can omit
 // loadingFinished. Resource Timing accounts for its compressed body/cache hit.
 const workerURLs=new Set([...local.map(r=>r.url),...timings.map(r=>r.name)].filter(u=>endpoints.isApp(u)&&/\/tile-worker-[^/]+\.js$/.test(u)))
 let workerTimingBytes=0
 for(const name of workerURLs){
  const events=local.filter(r=>r.url===name),resources=timings.filter(r=>r.name===name)
  if(events.every(r=>r.done)&&events.length)continue
  assert.ok(resources.length,'Missing worker transfer observation')
  workerTimingBytes+=Math.max(0,resources.reduce((n,r)=>n+r.transferSize,0)-events.reduce((n,r)=>n+(r.bytes??r.partial),0))
 }
 const cityBytes=local.filter(r=>endpoints.isData(r.url)).reduce((n,r)=>n+(r.bytes??r.partial),0)
 return{wireBytes:cdpBytes+workerTimingBytes,cdpBytes,workerTimingBytes,cityBytes,appBytes:cdpBytes-cityBytes+workerTimingBytes}
}
async function capture(page,file){
 try{await page.screenshot({path:file,timeout:10000})}
 catch(error){
  // Some Chrome/Metal composites stall page.screenshot while WebGL keeps
  // rendering. Preserve that distinction and capture the actual rendered frame.
  const png=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(window.__spinwardRenderer.domElement.toDataURL('image/png')))))
  await fs.writeFile(file,Buffer.from(png.split(',')[1],'base64'))
  await fs.writeFile(file+'.capture.json',JSON.stringify({mode:'canvas-only',pageScreenshotError:String(error)}))
 }
}
try{
 for(const place of (process.env.SPINWARD_RELEASE_PLACES??'shibuya,omiya,tokyo').split(',')){
  const context=browser
  const page=await context.newPage(),cdp=await context.newCDPSession(page),requests=new Map(),errors=[]
  page.setDefaultNavigationTimeout(30000)
  const stage=async name=>{await fs.writeFile(output+'/stage.json',JSON.stringify({place,stage:name,at:new Date().toISOString()}));console.log(place+': '+name)}
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),n=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return n})
  assert.ok(!/SwiftShader|llvmpipe|software/i.test(gpu))
  await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache')
  await cdp.send('Network.setBlockedURLs',{urls:['*static.cloudflareinsights.com*']})
  const networkModel=process.env.SPINWARD_RELEASE_NETWORK_MODEL??'legacy'
  if(networkModel==='rule')await cdp.send('Network.emulateNetworkConditionsByRule',{matchedNetworkConditions:[{urlPattern:'',latency:100,downloadThroughput:1250000,uploadThroughput:1250000}]})
  else await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000})
  cdp.on('Network.requestWillBeSent',e=>requests.set(e.requestId,{url:e.request.url,started:e.timestamp,partial:0}))
  cdp.on('Network.dataReceived',e=>{const r=requests.get(e.requestId);if(r)r.partial+=e.encodedDataLength})
  cdp.on('Network.responseReceived',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{status:e.response.status,headers:e.response.headers,cache:e.response.fromDiskCache||e.response.fromServiceWorker})})
  cdp.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{bytes:e.encodedDataLength,done:e.timestamp})})
  cdp.on('Network.loadingFailed',e=>{const r=requests.get(e.requestId);if(r)Object.assign(r,{failure:e.errorText,canceled:e.canceled})})
  let atUsable
  page.on('console',m=>{if(m.text().startsWith('METRO_USABLE '))atUsable={browserMs:Number(m.text().slice(13)),requests:[...requests.values()].map(r=>({...r}))}})
  await page.addInitScript(()=>{
   const poll=()=>{
    const s=window.__spinward
    if(window.__spinwardWatch&&!window.__releaseTimeFrozen){window.__releaseTimeFrozen=true;for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')}
    if(s?.metro?.operational&&s.regional.state==='ready'&&!s.regional.pendingArrival&&!document.querySelector('#splash')){
     window.__firstUsableTimings=performance.getEntriesByType('resource').map(r=>({name:r.name,initiator:r.initiatorType,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize}))
     window.__firstUsable=performance.now();console.log('METRO_USABLE '+window.__firstUsable);return
    }requestAnimationFrame(poll)
   };requestAnimationFrame(poll)
  })
  const target=url+`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&place=${place}&t=.02`
  try{
   await stage('cold navigation');await page.goto(target,{waitUntil:'domcontentloaded'})
   await page.waitForFunction(()=>window.__firstUsable,null,{timeout:90000})
   const arrival=await page.evaluate(()=>{
    const m=window.__spinwardMetro,s=window.__spinward,p=m.places.find(p=>p.id===m.arrivalId)
    return{id:m.arrivalId,region:m.selected,listed:!!p,actual:{azimuth:s.azimuth,axial:s.axial},expected:p?m.visit('metro-'+p.id):null}
   })
   assert.equal(arrival.id,place);assert.ok(arrival.listed&&arrival.expected,'The requested named place must exist in this release')
   assert.ok(Math.abs(arrival.actual.axial-arrival.expected.axial)<3,'Arrival must be at the requested axial coordinate')
   assert.ok(Math.abs(Math.atan2(Math.sin(arrival.actual.azimuth-arrival.expected.azimuth),Math.cos(arrival.actual.azimuth-arrival.expected.azimuth)))*3200<3,'Arrival must be in the requested band')
   const resourceTiming=await page.evaluate(()=>window.__firstUsableTimings)
   const releasePath=await page.evaluate(()=>window.__spinward.metro.release.path)
   assert.ok(atUsable.requests.some(r=>r.url===endpoints.wire(releasePath)),'Set SPINWARD_METRO_DATA_URL to the data root actually used by this build; do not omit CDN bytes')
   const transfer=wireAtUsable(atUsable.requests,resourceTiming)
   const initial={place,arrival,gpu,networkModel,dataRoot:endpoints.dataRoot,cacheModel:'persistent Chrome profile, 512 MiB disk cache',usableMs:atUsable.browserMs,...transfer,completed:atUsable.requests.filter(r=>r.done).length,inFlight:atUsable.requests.filter(r=>!r.done&&!r.failure).length}
   const initialRequests=atUsable.requests
   await fs.writeFile(output+`/${place}-initial.json`,JSON.stringify({...initial,resourceTiming,requests:initialRequests},null,2))
   console.log(JSON.stringify(initial));await capture(page,output+`/${place}-usable.png`)
   if(process.env.SPINWARD_RELEASE_INITIAL_ONLY==='1'){assert.deepEqual(errors,[]);results.push({...initial,errors});continue}
   await stage('background scenery');await page.waitForFunction(()=>window.__spinward.metro.ready&&window.__spinward.metro.night.loadedBands===3,null,{timeout:180000})
   await page.waitForTimeout(2000)
   const status=await page.evaluate(()=>window.__spinward.metro)
   await capture(page,output+`/${place}-settled.png`)
   const firstRequests=[...requests.values()];requests.clear();atUsable=null
   await stage('leave');await page.goto('about:blank');await stage('revisit');await page.goto(target,{waitUntil:'domcontentloaded'});await stage('revisit readiness');await page.waitForFunction(()=>window.__firstUsable,null,{timeout:90000})
   const revisit={usableMs:atUsable.browserMs,...wireAtUsable(atUsable.requests,await page.evaluate(()=>window.__firstUsableTimings)),cached:atUsable.requests.filter(r=>r.cache).length}
   const result={...initial,revisit,status,errors,firstRequests,initialRequests}
   results.push(result);await fs.writeFile(output+`/${place}.json`,JSON.stringify(result,null,2))
   assert.deepEqual(errors,[])
  }catch(error){
   const state=await bounded(page.evaluate(()=>window.__spinward)).catch(e=>({unavailable:String(e)}))
   await fs.writeFile(output+`/${place}-failure.json`,JSON.stringify({error:String(error),errors,requests:[...requests.values()],state},null,2));throw error
  }finally{await page.close()}
 }
 await fs.writeFile(output+'/summary.json',JSON.stringify(results.map(({firstRequests,initialRequests,status,...r})=>r),null,2))
 if(process.env.SPINWARD_RELEASE_ENFORCE_BUDGETS==='1')for(const r of results){
  assert.ok(r.wireBytes<=10000000,`${r.place}: ${r.wireBytes} exceeds 10 MB`)
  assert.ok(r.usableMs<=10000,`${r.place}: ${r.usableMs} ms exceeds 10 seconds`)
  if(r.revisit)assert.ok(r.revisit.wireBytes<r.wireBytes*.1,`${r.place}: revisit must avoid at least 90% of the initial transfer`)
 }
}finally{await browser.close();await fs.rm(profile,{recursive:true,force:true})}
