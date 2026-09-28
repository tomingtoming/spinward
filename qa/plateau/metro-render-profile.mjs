// Paired cold-start / continuous-render evidence. No production behavior is stubbed.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL and evidence directory required')
const mode=process.env.SPINWARD_RENDER_MODE??'boot',regions=(process.env.SPINWARD_RENDER_REGIONS??'west').split(',')
const highFlight=process.env.SPINWARD_RENDER_HIGH==='1'
const reps=Number(process.env.SPINWARD_RENDER_REPS??3),latencies=(process.env.SPINWARD_RENDER_LATENCIES??'0,250').split(',').map(Number)
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const results=[]
async function setup(region,latency,record){
  const context=await browser.newContext({viewport:{width:1280,height:960},deviceScaleFactor:1,...(record?{recordVideo:{dir:output+'/video',size:{width:1280,height:960}}}:{})})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const cdp=await context.newCDPSession(page)
  if(process.env.SPINWARD_RENDER_CPU==='1'){await cdp.send('Profiler.enable');await cdp.send('Profiler.start')}
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.clearBrowserCache')
  if(latency)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency,downloadThroughput:1048576,uploadThroughput:1048576})
  await page.addInitScript(()=>{
    const trace=window.__renderTrace={tasks:[],frames:[],samples:[],work:[],requests:[],webgl:[],links:0,programs:[],errors:[],firstUsable:null,firstNear:null,firstConverged:null,phases:[]}
    const programIds=new WeakMap(),shaderSources=new WeakMap(),programShaders=new WeakMap()
    const shaderSource=WebGL2RenderingContext.prototype.shaderSource,attachShader=WebGL2RenderingContext.prototype.attachShader
    WebGL2RenderingContext.prototype.shaderSource=function(shader,source){shaderSources.set(shader,source);return shaderSource.call(this,shader,source)}
    WebGL2RenderingContext.prototype.attachShader=function(program,shader){const list=programShaders.get(program)??[];list.push(shader);programShaders.set(program,list);return attachShader.call(this,program,shader)}
    for(const name of ['linkProgram','getProgramInfoLog','getShaderInfoLog','getProgramParameter','getUniformLocation','getAttribLocation','bufferData','texImage2D']){
      const original=WebGL2RenderingContext.prototype[name]
      WebGL2RenderingContext.prototype[name]=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{const ms=performance.now()-at;if(name==='linkProgram'){
        trace.links++;programIds.set(args[0],trace.links);trace.programs.push({id:trace.links,at,sources:(programShaders.get(args[0])??[]).map(s=>shaderSources.get(s))})
      }if(ms>2)trace.webgl.push({at,ms,name,program:programIds.get(args[0])})}}
    }
    new PerformanceObserver(list=>{for(const e of list.getEntries())trace.tasks.push({at:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true})
    const fetch=window.fetch
    window.fetch=async(...args)=>{const row={path:args[0] instanceof Request?args[0].url:String(args[0]),at:performance.now()};trace.requests.push(row);try{const r=await fetch(...args);row.headers=performance.now();row.status=r.status;return r}catch(e){row.error=String(e);throw e}}
    const read=Response.prototype.arrayBuffer
    Response.prototype.arrayBuffer=async function(){const data=await read.call(this);const r=[...trace.requests].reverse().find(r=>r.path===this.url||new URL(r.path,location.href).href===this.url);if(r){r.done=performance.now();r.bytes=data.byteLength}return data}
    const wrapped=new WeakMap()
    function wrap(object,name,label){
      if(!object||typeof object[name]!=='function')return
      let names=wrapped.get(object);if(!names){names=new Set();wrapped.set(object,names)}if(names.has(name))return;names.add(name)
      const original=object[name];object[name]=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{const ms=performance.now()-at;if(ms>.1)trace.work.push({at,ms,kind:label})}}
    }
    let previous=performance.now(),lastSample=0
    function frame(now){
      const m=window.__spinwardMetro,s=window.__spinward
      if(m){
        wrap(m,'update','world.update')
        for(const l of m.layers){
          const bp=Object.getPrototypeOf(l.base)
          for(const n of ['mesh','transform','refreshFar','update'])wrap(bp,n,'base.'+n)
          const fp=Object.getPrototypeOf(l.facade)
          for(const n of ['addSite','removeSite','updateLOD'])wrap(fp,n,'facade.'+n)
        }
        const ready=s?.regional?.state==='ready'&&!s.regional.pendingArrival
        if(ready&&s.mode==='grounded'&&trace.firstUsable===null){
          trace.firstUsable=now
          trace.arrivalScenery={trees:m.trees?.group.parent===m.group?m.trees.group.userData.trees:0,bootstrap:m.bootstrapReady}
        }
        if(ready&&m.layers.some(l=>l.base.sample.id===m.selected&&l.base.group.children.some(o=>o.visible&&o.userData.level==='near'&&o.name==='terrain'))&&trace.firstNear===null)trace.firstNear=now
        if(ready&&m.ready&&m.layers.length===3&&m.layers.every(l=>l.base.ready)&&trace.firstConverged===null)trace.firstConverged=now
      }
      trace.frames.push({at:now,ms:now-previous,gate:s?.regional?.state??'boot'});previous=now
      if(s&&now-lastSample>250){lastSample=now;trace.samples.push({at:now,mode:s.mode,axial:s.axial,azimuth:s.azimuth,radial:s.radial,relativeSpeed:s.relativeSpeed,gate:s.regional.state,
        collision:s.metro?.collision,layers:s.metro?.layers,renderer:window.__spinwardRenderer?.info?.memory,
        heap:performance.memory?.usedJSHeapSize})}
      requestAnimationFrame(frame)
    }requestAnimationFrame(frame)
  })
  const place=mode!=='boot'&&region==='west'?'&place=omiya':''
  await page.goto(`${url}/?city=tokyo&preset=izma&region=${region}&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42${place}`,{waitUntil:'domcontentloaded',timeout:180000})
  await page.waitForFunction(()=>window.__renderTrace.firstUsable!==null&&window.__renderTrace.firstNear!==null,null,{timeout:240000})
  return{context,page,errors,cdp}
}
function summarize(trace){
  const grouped={};for(const row of trace.work){const g=grouped[row.kind]??={count:0,total:0,max:0,over50:0};g.count++;g.total+=row.ms;g.max=Math.max(g.max,row.ms);g.over50+=row.ms>50}
  const paths={};for(const r of trace.requests)if(/tiles\/.*bin/.test(r.path))paths[r.path]=(paths[r.path]??0)+1
  return{firstUsable:trace.firstUsable,firstNear:trace.firstNear,firstConverged:trace.firstConverged,longTasks:trace.tasks,work:grouped,requests:trace.requests.length,duplicateTileRequests:Object.entries(paths).filter(([,n])=>n>1),maxHeap:Math.max(0,...trace.samples.map(s=>s.heap??0)),pauseFrames:trace.frames.filter(f=>f.at>(trace.phases[0]?.at??Infinity)&&f.gate!=='ready').length}
}
try{
  for(const region of regions)for(const latency of latencies)for(let rep=0;rep<(mode==='boot'?reps:1);rep++){
    console.log('start',mode,region,latency,rep)
    const {context,page,errors,cdp}=await setup(region,latency,mode==='flight')
    const id=`${mode}-${region}-${latency}-${rep}`
    try{
      if(mode==='boot')await page.waitForTimeout(500)
      else{
        if(process.env.SPINWARD_RENDER_EARLY!=='1'){
          await page.waitForFunction(()=>window.__spinwardMetro.ready&&window.__spinwardMetro.layers.length===3&&window.__spinwardMetro.layers.every(l=>l.base.ready),null,{timeout:240000})
          await page.waitForTimeout(1500)
        }
        await page.evaluate(()=>window.__renderTrace.phases.push({name:'flight',at:performance.now()}))
        for(let cycle=0;cycle<(mode==='turn'||highFlight?1:3);cycle++){
          const start=Date.now()
          // Cancel inherited spin with real lateral thrust. A straight inertial
          // climb alone keeps its tangential momentum and cannot reach the axis.
          const strafe=highFlight?await page.evaluate(()=>{
            const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],a=window.__spinward.azimuth
            const right=camera.position.clone().set(1,0,0).transformDirection(camera.matrixWorld)
              .transformDirection(window.__spinwardCity.group.matrixWorld.clone().invert())
            return right.dot(camera.position.clone().set(Math.sin(a),0,-Math.cos(a)))>0?'KeyA':'KeyD'
          }):null
          await page.keyboard.down('Space')
          if(strafe)await page.keyboard.down(strafe)
          try{
            if(highFlight)await page.waitForFunction(()=>3200-window.__spinward.radial>2100,null,{timeout:40000})
            else await page.waitForTimeout(5000)
          }finally{await page.keyboard.up('Space');if(strafe)await page.keyboard.up(strafe)}
          await page.keyboard.down('KeyW');await page.waitForTimeout(4000);await page.keyboard.up('KeyW')
          await page.keyboard.down('ArrowRight');await page.waitForTimeout(2244);await page.keyboard.up('ArrowRight')
          await page.screenshot({path:output+`/${id}-air-${cycle}.png`})
          await page.waitForTimeout(Math.max(0,(highFlight?150000:mode==='turn'?16000:40000)-(Date.now()-start)))
          console.log('cycle',id,cycle,await page.evaluate(()=>({mode:window.__spinward.mode,axial:window.__spinward.axial,height:3200-window.__spinward.radial})))
        }
        await page.evaluate(()=>window.__renderTrace.phases.push({name:'end',at:performance.now()}))
        await page.screenshot({path:output+`/${id}-final.png`})
      }
      const trace=await page.evaluate(()=>({...window.__renderTrace,final:window.__spinward,
        inactiveBuildingBatches:window.__spinwardScene.getObjectsByProperty('name','blender-colony-buildings').filter(g=>g.userData.buildings===0).map(g=>g.children.length)})),summary=summarize(trace)
      if(process.env.SPINWARD_RENDER_ASSERT_EMPTY==='1')assert.ok(trace.inactiveBuildingBatches.every(n=>n===0),'Empty procedural districts must not create GPU batches')
      if(process.env.SPINWARD_RENDER_ASSERT_TREES==='1')assert.ok(trace.arrivalScenery?.trees>0&&trace.arrivalScenery.bootstrap,'Initial movement requires the arrival woodland as well as its base scenery')
      if(process.env.SPINWARD_RENDER_CPU==='1'){
        const {profile}=await cdp.send('Profiler.stop'),endNow=await page.evaluate(()=>performance.now())
        await fs.writeFile(output+'/'+id+'-cpu.json',JSON.stringify({profile,endNow}))
      }
      Object.assign(summary,{region,latency,rep,mode,errors})
      if(mode==='flight')summary.video=await page.video().path()
      results.push(summary)
      await fs.writeFile(output+'/'+id+'.json',JSON.stringify({...trace,summary},null,2))
      await fs.writeFile(output+'/summary.json',JSON.stringify(results,null,2))
      console.log('done',id,JSON.stringify({firstUsable:summary.firstUsable,firstNear:summary.firstNear,duplicates:summary.duplicateTileRequests.length,work:summary.work,pauseFrames:summary.pauseFrames,errors}))
    }finally{await context.close()}
  }
}finally{await browser.close()}
