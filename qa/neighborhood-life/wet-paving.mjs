import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'quest'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,views:[],errors:[]}
const views=[
 {name:'street-day',a:-.2468443273,ax:-610,h:0,aim:[-.2468443273,-635,0],phase:.42},
 {name:'street-night',a:-.2468443273,ax:-610,h:0,aim:[-.2468443273,-635,0],phase:.02},
 {name:'covered-edge',a:-.02,ax:-351.54,h:.34,aim:[-.008,-351.54,.34],phase:.42},
 {name:'bridge-under',a:.17632646395+13.5/3200,ax:1449.18145,h:1.2,aim:[.17632646395+13.5/3200,1474,1.2],phase:.42},
 {name:'bridge-top',a:.176564105884,ax:1450.39463,h:5.34,aim:[.183,1455,5.2],phase:.42},
 {name:'garden',a:.302,ax:584,h:.34,aim:[.309,594,.34],phase:.42,visit:'garden'}
]
const pose=v=>{const p=([a,ax,h])=>new Vector3(Math.cos(a)*(3200-h),ax,Math.sin(a)*(3200-h));const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p([v.a,v.ax,v.h+1.8]),p(v.aim),new Vector3(-Math.cos(v.a),0,-Math.sin(v.a))));return `m=g&a=${v.a}&ax=${v.ax}&gh=${v.h}&q=${q.toArray()}&t=${v.phase}&rain`}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 if(process.env.BASELINE_JS){const bytes=await fs.readFile(process.env.BASELINE_JS);await page.route('**/assets/index-*.js',r=>r.fulfill({status:200,body:bytes,contentType:'application/javascript'}));report.baselineFile=process.env.BASELINE_JS}
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 const state=()=>page.evaluate(()=>{const c=window.__spinwardCity,m=c.getPavementMaterials?.()??[];return{player:window.__spinward,meshes:window.__spinwardScene.getObjectsByProperty('isMesh',true).length,materialCount:m.length,wetShaders:m.filter(x=>x.customProgramCacheKey().includes('wet-paving')).length,asset:document.querySelector('script[src*="/assets/"]')?.src}})
 for(const v of views.filter(v=>!process.env.VIEW||process.env.VIEW.split(',').includes(v.name))){
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${v.visit?'visit='+v.visit+'&t='+v.phase+'&rain':pose(v)}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.riverLayer?.group.userData.blenderReady)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(1800)
  const s=await state();report.views.push({name:v.name,...s});await page.screenshot({path:out+`wet-paving-${tier}-${label}-${v.name}.png`})
  if(!process.env.BASELINE_JS){if(s.player.rain.pavementWetness<.99||s.materialCount!==14||s.wetShaders!==14)throw Error('Wet paving connection missing')}
 }
 if(!process.env.BASELINE_JS&&process.env.DRYING==='1'){
  const before=await state();await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Rain',exact:true}).click();await page.keyboard.press('Escape');await page.waitForTimeout(10000)
  const after=await state();report.drying={before,after};await page.screenshot({path:out+`wet-paving-${tier}-${label}-drying.png`})
  if(after.player.raining||after.player.rain.strength>.01||after.player.rain.pavementWetness<.85||after.player.rain.pavementWetness>=.98)throw Error('Wet paving did not persist after rain stopped')
 }
 if(report.errors.length)throw Error(JSON.stringify(report.errors))
 console.log(JSON.stringify({views:report.views.map(v=>({name:v.name,rain:v.player.rain})),drying:report.drying?.after.player.rain,errors:report.errors}))
}finally{await fs.writeFile(out+`wet-paving-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
