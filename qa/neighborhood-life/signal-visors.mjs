import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {signalViews,signalPose} from './signal-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'desktop',fallback=process.env.FALLBACK==='1'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),evidence={label,tier,fallback,views:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>evidence.errors.push(e.message))
 await page.goto('about:blank')
 evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 if(fallback)await page.route('**/signal-visors.glb',r=>r.abort())
 for(const view of signalViews){
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${signalPose(view)}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  if(label!=='before')await page.waitForFunction(fallback=>window.__spinwardIntersections.group.getObjectByName('intersection-signal-visors')?.userData.asset===(fallback?'fallback':'blender'),fallback)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape');await page.waitForTimeout(500)
  const probe=await page.evaluate(()=>{
   const group=window.__spinwardIntersections.group,details=group.getObjectByName('intersection-signal-visors'),heads=group.getObjectByName('intersection-signal-heads'),lamps=group.getObjectByName('intersection-signal-lamps')
   return {stats:details?.userData,heads:heads.count,lamps:lamps.count,
    lampColors:Array.from(lamps.instanceColor.array.slice(0,lamps.count*3)),
    batches:details?.children.map(m=>({name:m.name,count:m.count,triangles:(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3})),
    lights:window.__spinwardScene.getObjectsByProperty('isLight',true).length}
  })
  if(label!=='before'){
   if(probe.batches.reduce((n,b)=>n+b.count,0)>48)throw Error('Visor count budget exceeded')
   if(probe.batches.reduce((n,b)=>n+b.count*b.triangles,0)>17856)throw Error('Visor triangle budget exceeded')
   if(view.name==='close'&&!probe.batches[0].count)throw Error('Near LOD not exercised')
   if(view.name==='medium'&&!probe.batches[1].count)throw Error('Middle LOD not exercised')
   if(view.name==='far'&&probe.batches.some(b=>b.count))throw Error('Subpixel visors remain in far view')
  }
  if(probe.lamps!==probe.heads*3)throw Error('Lamp count changed')
  for(let h=0;h<probe.heads;h++){
   const colors=probe.lampColors.slice(h*9,h*9+9)
   if([0,1,2].filter(a=>Math.max(...colors.slice(a*3,a*3+3))>.5).length!==1)throw Error('Invalid signal aspect')
  }
  const file=`signal-${tier}-${label}-${view.name}.png`;await page.screenshot({path:out+file})
  evidence.views.push({name:view.name,url:page.url(),file,probe})
 }
 if(evidence.errors.length)throw Error(evidence.errors.join('\n'))
 console.log(JSON.stringify({gpu:evidence.gpu,views:evidence.views.map(v=>({name:v.name,stats:v.probe.stats})),errors:evidence.errors}))
}finally{await fs.writeFile(out+`signal-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
