// Same input, before -> candidate -> before. Keep both served builds immutable.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const {SPINWARD_METRO_EVIDENCE:output,SPINWARD_METRO_URL:candidate,SPINWARD_METRO_BASELINE:baseline}=process.env
const videoOptions=process.env.SPINWARD_NIGHT_VIDEO==='0'?{}:{recordVideo:{dir:output+'/video',size:{width:1440,height:960}}}
const variants=process.env.SPINWARD_NIGHT_CANDIDATE_ONLY==='1'?[['after',candidate]]:[['before',baseline],['after',candidate],['before-repeat',baseline]]
if(!output||!candidate||!baseline)throw Error('Explicit candidate, baseline and evidence paths required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
try{
 for(const place of (process.env.SPINWARD_NIGHT_PLACES??'shibuya,omiya,tokyo,ikebukuro').split(','))for(const [label,url] of variants){
  const context=await browser.newContext({viewport:{width:1440,height:960},locale:'en-US',...videoOptions})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('about:blank');const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),name=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return name})
  assert.ok(!/SwiftShader|llvmpipe|software/i.test(gpu))
  await page.goto(url+`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&place=${place}&t=.02`)
  await page.waitForFunction(()=>window.__spinwardWatch)
  await page.evaluate(()=>{for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')})
  await page.waitForSelector('#splash',{state:'detached',timeout:90000})
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&!window.__spinward.regional.pendingArrival&&window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0),null,{timeout:90000})
  if(label==='after')await page.waitForFunction(()=>window.__spinwardMetro.nightscape.loaded===3&&window.__spinwardMetro.layers.every(l=>l.panes.running===0&&l.panes.entries.every(e=>!e.wanted||e.status==='resident')))
  await page.waitForTimeout(1200)
  await page.evaluate(()=>{
    document.querySelector('.lil-gui')?.remove()
    const t=window.__nightTrace={phase:'steady',frames:[],samples:[],running:true};let last=performance.now(),sample=0
    const m=window.__spinwardMetro,update=m.update;m.update=function(...args){const at=performance.now();try{return update.apply(this,args)}finally{t.cpu=performance.now()-at}}
    function frame(now){if(!t.running)return;const s=window.__spinward;t.frames.push({phase:t.phase,ms:now-last,cpu:t.cpu,gate:s.regional.state});last=now
      if(now-sample>200){sample=now;t.samples.push({phase:t.phase,a:s.azimuth,y:s.axial,h:s.radius-s.radial,speed:s.relativeSpeed,mode:s.mode,
        panes:m.layers.map(l=>l.panes?.diagnostics()),night:m.nightscape?.diagnostics()})}requestAnimationFrame(frame)}requestAnimationFrame(frame)
  })
  await page.waitForTimeout(3000)
  await page.evaluate(()=>window.__nightTrace.phase='walk');await page.keyboard.down('KeyW');await page.waitForTimeout(2200);await page.keyboard.up('KeyW')
  await page.screenshot({path:output+`/${place}-${label}-walk.png`})
  await page.evaluate(()=>window.__nightTrace.phase='flight')
  await page.keyboard.down('Space');await page.waitForTimeout(5000);await page.keyboard.up('Space')
  await page.keyboard.down('KeyW');await page.waitForTimeout(4000);await page.keyboard.up('KeyW')
  await page.screenshot({path:output+`/${place}-${label}-air.png`})
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(2244);await page.keyboard.up('ArrowRight');await page.waitForTimeout(1800)
  await page.screenshot({path:output+`/${place}-${label}-turn.png`})
  const trace=await page.evaluate(()=>{window.__nightTrace.running=false;return window.__nightTrace})
  const summary={place,label,gpu,errors,phases:{}}
  for(const phase of ['steady','walk','flight']){const f=trace.frames.filter(f=>f.phase===phase),ms=f.map(f=>f.ms).sort((a,b)=>a-b),cpu=f.map(f=>f.cpu).sort((a,b)=>a-b),s=trace.samples.filter(s=>s.phase===phase)
    summary.phases[phase]={frames:f.length,mean:ms.reduce((a,b)=>a+b,0)/ms.length,p50:ms[Math.floor(ms.length*.5)],p95:ms[Math.floor(ms.length*.95)],max:ms.at(-1),cpu95:cpu[Math.floor(cpu.length*.95)],pauseFrames:f.filter(f=>f.gate!=='ready').length,maxSpeed:Math.max(...s.map(s=>s.speed)),maxHeight:Math.max(...s.map(s=>s.h)),distance:s.length?Math.hypot((s.at(-1).a-s[0].a)*3200,s.at(-1).y-s[0].y):0}
  }
  summary.video=await page.video()?.path();await context.close();results.push(summary)
  await fs.writeFile(output+`/${place}-${label}.json`,JSON.stringify({summary,trace},null,2));await fs.writeFile(output+'/paired.json',JSON.stringify(results,null,2));console.log(JSON.stringify(summary))
  assert.deepEqual(errors,[])
  if(label==='after')for(const sample of trace.samples)for(const p of sample.panes.filter(Boolean)){assert.ok(p.bytes<=p.maxBytes&&p.resident<=p.maxResident&&p.pending<=1);assert.equal(p.failures,0)}
 }
}finally{await browser.close()}
