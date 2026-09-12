import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'desktop'
if(!base)throw Error('SPINWARD_URL required')
const output=fileURLToPath(new URL('.',import.meta.url)),evidence={label,tier,views:[],errors:[],consoleErrors:[]}
const views=[
 {name:'covered',a:-.02,ax:-349,h:.34,aim:[-.007,-352,2]},
 {name:'outside',a:-.02,ax:-363,h:0,aim:[-.007,-351,2]},
 {name:'river',a:.1763264639508575+13.5/3200,ax:1445.8064516129052+3.375,h:1.2,aim:[.1763264639508575+13.5/3200,1445.8064516129052+28,3]},
 {name:'deck',a:-.02,ax:-339.29,h:18,aim:[-.007,-339.29,19.8]}
]
const pose=v=>{const point=([a,ax,h])=>new Vector3(Math.cos(a)*(3200-h),ax,Math.sin(a)*(3200-h));const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([v.a,v.ax,v.h+1.8]),point(v.aim),new Vector3(-Math.cos(v.a),0,-Math.sin(v.a))));return `m=g&a=${v.a}&ax=${v.ax}&gh=${v.h}&q=${q.toArray()}&t=.42&rain`}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},deviceScaleFactor:1});await context.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text())})
 await page.goto('about:blank');evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info'),r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 const state=()=>page.evaluate(()=>({a:window.__spinward.azimuth,ax:window.__spinward.axial,h:window.__spinward.groundHeight,rain:window.__spinward.rain,mode:window.__spinward.mode,asset:document.querySelector('script[src*="/assets/"]')?.src}))
 const visit=async v=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${pose(v)}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.riverLayer?.group.userData.blenderReady);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(3500)}
 for(const v of views){await visit(v);const s=await state();for(let i=0;i<3;i++){await page.waitForTimeout(350);await page.screenshot({path:output+`rain-${tier}-${label}-${v.name}-${i}.png`})}evidence.views.push({name:v.name,...s});console.log(v.name,JSON.stringify(s));if(label!=='before'){const covered=['covered','river'].includes(v.name);if(s.rain.strength<.5||Math.abs(s.rain.shelter-(covered?1:0))>.05||Math.abs(s.rain.audibility-(covered?.45:1))>.05)throw Error('Unexpected rain cover '+v.name)}}
 if(label!=='before'&&process.env.WALK==='1'){
  await visit({...views[0],ax:-351.54,aim:[-.02,-375,2]});const samples=[await state()];await page.keyboard.down('KeyW');try{for(let i=0;i<8;i++){await page.waitForTimeout(1000);samples.push(await state());if(i%2===0)await page.screenshot({path:output+`rain-${tier}-${label}-exit-${i}.png`})}}finally{await page.keyboard.up('KeyW')}
  evidence.walk=samples;const last=samples.at(-1);if(samples[0].rain.shelter<.95||last.rain.shelter>.05||last.ax>samples[0].ax-9||!samples.every(s=>s.mode==='grounded'))throw Error('Rain shelter transition failed');console.log('walk',JSON.stringify(samples))
 }
 if(evidence.errors.length||evidence.consoleErrors.length)throw Error(JSON.stringify([evidence.errors,evidence.consoleErrors]))
}finally{await fs.writeFile(output+`rain-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
