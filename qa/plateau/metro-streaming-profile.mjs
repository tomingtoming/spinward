// Observe the shipped build without changing its demand, physics or readiness.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {X509Certificate,createHash} from 'node:crypto'
import {releaseEndpoints} from './metro-release-network.mjs'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit preview URL and output directory required')
const endpoints=releaseEndpoints(url,process.env.SPINWARD_METRO_DATA_URL)
await fs.mkdir(output,{recursive:true})
const args=[]
if(url.startsWith('https://127.0.0.1:')||url.startsWith('https://localhost:')){
  const certificate=new X509Certificate(await fs.readFile(new URL('../../node_modules/.vite/basic-ssl/_cert.pem',import.meta.url)))
  args.push('--ignore-certificate-errors-spki-list='+createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64'))
}
const browser=await chromium.launch({channel:'chrome',headless:true,args})
try{
  const page=await browser.newPage({viewport:{width:1280,height:960},deviceScaleFactor:1})
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),r=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return r})
  assert.ok(!/unknown|SwiftShader|software|llvmpipe/i.test(gpu))
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.addInitScript(()=>{
    window.__streamTrace={tasks:[],requests:[],responseReads:[],phases:[],frames:[],samples:[],demands:[],loads:[],reindexes:[],requestCpu:[],started:performance.now()}
    const trace=window.__streamTrace
    new PerformanceObserver(list=>{for(const e of list.getEntries())trace.tasks.push({at:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true})
    const fetch=window.fetch
    window.fetch=async(...args)=>{
      const row={path:args[0] instanceof Request?args[0].url:String(args[0]),at:performance.now()};trace.requests.push(row)
      try{const r=await fetch(...args);row.headers=performance.now();row.status=r.status;return r}
      catch(e){row.error=String(e);throw e}
    }
    const read=Response.prototype.arrayBuffer
    Response.prototype.arrayBuffer=async function(){
      const at=performance.now(),bytes=await read.call(this)
      trace.responseReads.push({path:this.url,at,ms:performance.now()-at,bytes:bytes.byteLength});return bytes
    }
    let previous=performance.now(),lastSample=0
    function frame(now){
      const s=window.__spinward
      trace.frames.push({at:now,ms:now-previous,gate:s?.regional?.state??'boot'})
      previous=now
      if(s&&now-lastSample>100){lastSample=now;trace.samples.push({at:now,a:s.azimuth,y:s.axial,radial:s.radial,ground:s.groundHeight,mode:s.mode,speed:s.speed,relativeSpeed:s.relativeSpeed,critical:s.regional.critical,missingCritical:s.regional.missingCritical,prefetch:s.regional.prefetch,retained:s.regional.retained,loads:s.regional.loads,aborts:s.regional.aborts,gate:s.regional.state,pending:s.regional.pending,entries:s.regional.entries,bytes:s.regional.bytes})}
      requestAnimationFrame(frame)
    }requestAnimationFrame(frame)
  })
  for(const scenario of (process.env.SPINWARD_STREAM_SCENARIOS??'walk,flight').split(',')){
    console.log('start',scenario)
    await page.goto(url+'/?city=tokyo&preset=izma&region=west&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42'+(process.env.SPINWARD_STREAM_PLACE?'&place='+process.env.SPINWARD_STREAM_PLACE:''))
    await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
    const release=await page.evaluate(()=>({path:window.__spinward.metro.release?.path,requests:window.__streamTrace.requests.map(r=>r.path)}))
    if(release.path)expectReleaseOrigin(release)
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    const delayMs=Number(process.env.SPINWARD_STREAM_LATENCY_MS??0),bandwidth=Number(process.env.SPINWARD_STREAM_BANDWIDTH??0)
    if(delayMs||bandwidth){
      const cdp=await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      if(process.env.SPINWARD_RELEASE_NETWORK_MODEL==='rule')await cdp.send('Network.emulateNetworkConditionsByRule',{matchedNetworkConditions:[{urlPattern:'',latency:delayMs,downloadThroughput:bandwidth||-1,uploadThroughput:bandwidth||-1}]})
      else await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:delayMs,downloadThroughput:bandwidth||-1,uploadThroughput:bandwidth||-1})
    }
    await page.evaluate(()=>{
      const trace=window.__streamTrace,c=window.__spinwardMetro.collision
      const snapshot=e=>({id:e.tile.id,status:e.status,bounds:e.tile.bounds,heightRange:e.tile.heightRange,band:e.tile.band,bytes:e.tile.decodedBytes})
      const distance=(tile,f)=>{
        const b=tile.bounds,a=-(tile.band*Math.PI*2/3+(b[0]+b[2])/2/3200),y=-(b[1]+b[3])/2
        return Math.hypot(Math.max(0,Math.abs(Math.atan2(Math.sin(f.azimuth-a),Math.cos(f.azimuth-a))*3200)-(b[2]-b[0])/2),Math.max(0,Math.abs(f.axial-y)-(b[3]-b[1])/2))
      }
      const request=c.request,load=c.load,reindex=c.reindex;let wasReady=true
      c.request=function(foci,preparation){
        const at=performance.now(),ready=request.call(this,foci,preparation);trace.requestCpu.push({at,ms:performance.now()-at})
        if(ready!==wasReady){
          const missing=this.entries.filter(e=>(preparation?e.critical:e.wanted)&&e.status!=='resident').map(e=>({...snapshot(e),nearestFocusM:Math.min(...foci.map(f=>distance(e.tile,f)))}))
          const s=window.__spinward
          trace.demands.push({at,ready,foci,missing,body:{a:s.azimuth,y:s.axial,radial:s.radial,mode:s.mode}});wasReady=ready
        }
        return ready
      }
      c.load=async function(tile,signal){
        const row={id:tile.id,at:performance.now(),wireBytes:tile.decodedBytes};trace.loads.push(row)
        try{const meshes=await load.call(this,tile,signal);row.done=performance.now();row.triangles=meshes.reduce((n,m)=>n+m.attributes.index.length/3,0);return meshes}
        catch(e){row.done=performance.now();row.error=String(e);throw e}
      }
      c.reindex=function(){const at=performance.now();reindex.call(this);trace.reindexes.push({at,ms:performance.now()-at,parts:this.index.all.length})}
      trace.phases.push({name:'steady',at:performance.now()})
    })
    await page.waitForTimeout(2500)
    await page.evaluate(scenario=>window.__streamTrace.phases.push({name:scenario,at:performance.now()}),scenario)
    if(scenario==='endurance'){
      for(let cycle=0;cycle<3;cycle++){
        const began=Date.now()
        await page.keyboard.down('Space');await page.waitForTimeout(5000);await page.keyboard.up('Space')
        await page.keyboard.down('KeyW');await page.waitForTimeout(4000);await page.keyboard.up('KeyW')
        await page.keyboard.down('ArrowRight');await page.waitForTimeout(2244);await page.keyboard.up('ArrowRight')
        await page.screenshot({path:output+`/flight-${cycle}.png`})
        await page.waitForTimeout(Math.max(0,40000-(Date.now()-began)))
        console.log('cycle',cycle,await page.evaluate(()=>({mode:window.__spinward.mode,y:window.__spinward.axial,height:3200-window.__spinward.radial,relativeSpeed:window.__spinward.relativeSpeed,stream:window.__spinward.regional})))
      }
    }else if(scenario==='walk'){
      await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(30000)
      await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')
    }else if(scenario==='cruise'){
      await page.keyboard.down('Space');await page.waitForTimeout(5000)
      await page.keyboard.down('KeyW');await page.waitForTimeout(6000);await page.keyboard.up('Space')
      await page.waitForTimeout(19000);await page.keyboard.up('KeyW')
    }else{
      await page.keyboard.down('Space');await page.waitForTimeout(3500);await page.keyboard.up('Space')
      await page.keyboard.down('KeyW');await page.waitForTimeout(26500);await page.keyboard.up('KeyW')
    }
    await page.evaluate(()=>window.__streamTrace.phases.push({name:'settle',at:performance.now()}))
    await page.waitForTimeout(2000)
    await page.screenshot({path:output+'/'+scenario+'-final.png'})
    const result=await page.evaluate(()=>({...window.__streamTrace,ended:performance.now(),final:window.__spinward,streams:window.__spinwardMetro.layers.map(l=>({base:l.base.diagnostics(),facade:l.facade.diagnostics()}))}))
    const start=result.phases.find(p=>p.name===scenario).at,end=result.phases.find(p=>p.name==='settle').at
    const frames=result.frames.filter(f=>f.at>=start&&f.at<end),deltas=frames.map(f=>f.ms).sort((a,b)=>a-b)
    const intervals=[]
    for(const event of result.demands){if(!event.ready)intervals.push({start:event.at,missing:event.missing});else if(intervals.length)intervals.at(-1).end=event.at}
    for(const i of intervals)i.durationMs=(i.end??result.ended)-i.start
    const cpu=result.requestCpu.map(c=>c.ms).sort((a,b)=>a-b)
    result.summary={scenario,gpu,errors,networkModel:process.env.SPINWARD_RELEASE_NETWORK_MODEL??'legacy',latencyMs:delayMs,bandwidthBytesPerSecond:bandwidth,seconds:(end-start)/1000,frames:frames.length,frameP50:deltas[Math.floor(deltas.length*.5)],frameP95:deltas[Math.floor(deltas.length*.95)],frameMax:deltas.at(-1),pauseCount:intervals.length,pauseMs:intervals.reduce((n,i)=>n+i.durationMs,0),intervals,
      requestCpuP50:cpu[Math.floor(cpu.length*.5)],requestCpuP95:cpu[Math.floor(cpu.length*.95)],requestCpuMax:cpu.at(-1),collisionLoads:result.loads.length,reindexMax:Math.max(0,...result.reindexes.map(r=>r.ms)),longTasks:result.tasks.filter(t=>t.at>=start&&t.at<end),displacement:result.samples.filter(s=>s.at>=start&&s.at<end).filter((_,i,a)=>i===0||i===a.length-1)}
    await fs.writeFile(output+'/'+scenario+'.json',JSON.stringify(result,null,2))
    console.log(JSON.stringify(result.summary))
    assert.deepEqual(errors,[])
    assert.deepEqual(result.requests.filter(r=>r.status>=400&&endpoints.owns(new URL(r.path,url).href)),[],'No failed application or city CDN responses')
    assert.ok(result.samples.every(s=>s.entries<=96&&s.bytes<=144*1024*1024),'Collision residency remains bounded through flight')
  }
}finally{await browser.close()}

function expectReleaseOrigin(release){
  assert.ok(release.requests.some(p=>new URL(p,url).href===endpoints.wire(release.path)),'Observe the configured public city release')
}
