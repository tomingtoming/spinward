import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {skylinePose} from './skyline-views.mjs'
import {nightDistrictViews} from './night-district-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'after',tier=process.env.TIER??'desktop'
if(!base)throw Error('Set SPINWARD_URL to an owned production preview')
const out=fileURLToPath(new URL('.',import.meta.url)),report={label,tier,views:[],errors:[]}
const hash=s=>createHash('sha256').update(s).digest('hex')
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},deviceScaleFactor:1})
 page.on('pageerror',e=>report.errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|context.*lost/i.test(m.text()))report.errors.push(m.text())})
 await page.goto('about:blank')
 report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 for(const v of nightDistrictViews){
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${skylinePose(v)}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>!!window.__spinwardCity?.colonyBuildings?.modules)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape');await page.waitForTimeout(1000)
  const data=await page.evaluate(()=>{
   const scene=window.__spinwardScene,city=window.__spinwardCity
   const material=scene.getObjectsByProperty('isMesh',true).flatMap(o=>Array.isArray(o.material)?o.material:[o.material]).find(m=>m.onBeforeCompile.toString().includes('cityEmissiveMap'))
   if(!material)throw Error('City shell shader missing')
   // Read the actual material closure into a disposable shader stub, without
   // recompiling it or changing any application uniform.
   const shader={uniforms:{},vertexShader:'',fragmentShader:''};material.onBeforeCompile(shader)
   const u=shader.uniforms,a=u.cityAlbedoMap.value.image,e=u.cityEmissiveMap.value.image
   const pixels=e.getContext('2d').getImageData(0,0,e.width,e.height).data
   let sum=0,lit=0,max=0;const colours=new Set()
   for(let i=0;i<pixels.length;i+=4){const y=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=y;max=Math.max(max,y);if(y>5)lit++;if(y>8)colours.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2])}
   return {albedo:a.toDataURL(),emissive:e.toDataURL(),width:e.width,height:e.height,glow:u.uCityGlow.value,fade:u.uCityFade.value.toArray(),mean:sum/(pixels.length/4),lit,colours:colours.size,max,
    geometry:scene.getObjectsByProperty('isMesh',true).length,plan:city.getCityPlan(),stats:city.colonyBuildings.group.userData}
  })
  const {albedo,emissive,plan,...probe}=data
  const albedoHash=hash(albedo),emissiveHash=hash(emissive),planHash=hash(JSON.stringify(plan))
  if(!report.textures){report.textures={albedoHash,emissiveHash,planHash};await fs.writeFile(out+`night-districts-${tier}-${label}-emissive.png`,Buffer.from(emissive.split(',')[1],'base64'))}
  if(albedoHash!==report.textures.albedoHash||emissiveHash!==report.textures.emissiveHash||planHash!==report.textures.planHash)throw Error('City bake changed with camera or time')
  if(v.phase>.4&&probe.glow>.001)throw Error('Night field remains on in daylight')
  const file=`night-districts-${tier}-${label}-${v.name}.png`;await page.screenshot({path:out+file})
  report.views.push({name:v.name,file,url:page.url(),...probe});console.log(v.name,JSON.stringify({mean:probe.mean,colours:probe.colours,glow:probe.glow}))
 }
 if(label!=='before'){
  const before=JSON.parse(await fs.readFile(out+`night-districts-${tier}-before.json`,'utf8'))
  if(before.textures.albedoHash!==report.textures.albedoHash||before.textures.planHash!==report.textures.planHash)throw Error('Daytime bake or city plan changed')
  if(before.textures.emissiveHash===report.textures.emissiveHash)throw Error('Night bake did not change')
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+`night-districts-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
