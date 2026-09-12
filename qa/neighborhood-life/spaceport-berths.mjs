import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {spaceportViews,spaceportPose} from './spaceport-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'before',tier=process.env.TIER??'desktop',fallback=process.env.FALLBACK==='1'
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
 if(fallback)await page.route('**/docking-collar.glb',r=>r.abort())
 for(const v of spaceportViews){
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${spaceportPose(v)}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  if(label!=='before')await page.waitForFunction(fallback=>window.__spinwardScene.getObjectByName('spaceport')?.userData.collarAsset===(fallback?'fallback':'blender'),fallback)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape');await page.waitForTimeout(500)
  if(v.name==='night'&&label!=='before')await page.waitForFunction(()=>window.__spinwardScene.getObjectByName('spaceport-navigation-lamps').material.color.g>.3)
  const probe=await page.evaluate(()=>{
   const port=window.__spinwardScene.getObjectByName('spaceport');if(!port)return null
   const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],ships=port.getObjectByName('spaceport-docked-ships').geometry.getAttribute('position')
   const contacts=port.userData.berths.filter(b=>b.occupied).map(b=>{
    const index=port.userData.berths.indexOf(b),lod=port.getObjectByName(`docking-collar-${index}`),g=lod.levels[0].object.geometry;g.computeBoundingBox()
    const at=port.worldToLocal(lod.localToWorld(camera.position.clone().set(0,0,g.boundingBox.max.z)))
    let gap=Infinity
    for(let i=0;i<ships.count;i++)if(Math.hypot(ships.getX(i)-b.x,ships.getZ(i)-b.z)<3)gap=Math.min(gap,(ships.getY(i)-at.y)*b.endSign)
    if(Math.abs(gap)>.005)throw Error('Shuttle seal detached from loaded collar')
    return {index,gap,front:at.toArray()}
   })
   return {berths:port.userData.berths,asset:port.userData.collarAsset,
    contacts,navColor:port.getObjectByName('spaceport-navigation-lamps').material.color.toArray(),
    lods:port.getObjectsByProperty('isLOD',true).map(l=>({name:l.name,level:l.getCurrentLevel(),matrix:l.matrixWorld.elements})),
    sceneLights:window.__spinwardScene.getObjectsByProperty('isLight',true).length}
  })
  if(label!=='before'){
   if(probe.lods.length!==4)throw Error('Expected four docking collars')
   if(v.name==='far'&&probe.lods.some(l=>l.level!==2))throw Error('Subpixel collars remain in far view')
   if(v.name==='medium'&&probe.lods[0].level!==1)throw Error('Middle collar LOD was not exercised')
   if(v.name==='occupied'&&probe.lods[0].level!==0)throw Error('Near collar LOD was not exercised')
  }
  const file=`spaceport-${tier}-${label}-${v.name}.png`;await page.screenshot({path:out+file})
  evidence.views.push({name:v.name,url:page.url(),file,probe})
 }
 if(evidence.errors.length)throw Error(evidence.errors.join('\n'))
}finally{await fs.writeFile(out+`spaceport-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
