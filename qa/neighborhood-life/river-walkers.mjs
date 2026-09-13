import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { riverWalkerViews, riverPose } from './river-walker-views.mjs'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'desktop',label=process.env.LABEL??'final',disabled=process.env.PEOPLE==='0'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={tier,label,disabled,views:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 for(const v of riverWalkerViews.filter(v=>!process.env.VIEW||v.name===process.env.VIEW)) {
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&people=${disabled?'0':'1'}&${riverPose(v)}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardWalkers)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape')
  const probe=()=>page.evaluate(()=>{
   const w=window.__spinwardWalkers,p=window.__spinward
   return {asset:document.querySelector('script[src*="/assets/"]').src,visible:w.group.visible,...w.group.userData,
    riverRoutes:w.riverRoutes.map(r=>({id:r.id,points:r.path.length,length:r.length})),player:{azimuth:p.azimuth,axial:p.axial,height:p.groundHeight,mode:p.mode},
    anchors:w.walkers.map(w=>{
     let soleHeight=Infinity
     const point=w.root.position.clone()
     for(const side of ['left','right']){
      const shoe=w.root.getObjectByName(`${side}_shoe`),vertices=shoe.geometry.getAttribute('position')
      for(let i=0;i<vertices.count;i++){
       point.fromBufferAttribute(vertices,i).applyMatrix4(shoe.matrixWorld)
       soleHeight=Math.min(soleHeight,3200-Math.hypot(point.x,point.z))
      }
     }
     const shadowIndex=window.__spinwardWalkers.walkers.filter(w=>w.root.visible).indexOf(w)
     const shadow=window.__spinwardWalkers.batches?.group.getObjectByName('people-contact-shadows')
     const m=shadow?.instanceMatrix.array,offset=shadowIndex*16
     const shadowHeight=m&&shadowIndex>=0?3200-Math.hypot(m[offset+12],m[offset+14]):null
     return {id:w.route.id,position:w.root.position.toArray(),clock:w.clock,soleHeight,shadowHeight}
    })}
  })
  const frames=[];const capture=async(name)=>{const state=await probe();await page.screenshot({path:out+`river-walkers-${tier}-${label}-${v.name}-${name}.png`});frames.push({name,...state});return state}
  if(!disabled&&v.actor) {
   await page.waitForFunction(id=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id===id&&a.visible),v.actor)
   const first=await capture('start');await page.waitForTimeout(v.name==='ramp'?8000:1500);const moved=await capture('moving')
   const a=first.actors.find(a=>a.id===v.actor),b=moved.actors.find(a=>a.id===v.actor)
   if(Math.hypot((a.azimuth-b.azimuth)*3200,a.axial-b.axial)<.3)throw Error('Resident did not move')
   if(v.name==='ramp'&&!(a.height-b.height>.25))throw Error('Resident did not descend the ramp')
   if(v.yield) {
    await page.waitForFunction(id=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id===id&&a.blocked),v.actor,{timeout:35000})
    const stopped=await capture('yield');await page.waitForTimeout(600);const held=await probe()
    if(stopped.anchors.find(a=>a.id===v.actor).clock!==held.anchors.find(a=>a.id===v.actor).clock)throw Error('Yield did not hold the local clock')
    await page.keyboard.down('s');await page.waitForTimeout(1700);await page.keyboard.up('s')
    await page.waitForFunction(id=>window.__spinwardWalkers.group.userData.actors?.some(a=>a.id===id&&!a.blocked&&a.walking),v.actor)
    await capture('resume')
   }
  } else {await page.waitForTimeout(1000);const state=await capture('hidden');if(state.visible)throw Error('Distant or disabled people remain visible')}
  for(const s of frames) {
   if((s.people??0)>(tier==='desktop'?8:4))throw Error('Population exceeds existing capacity')
   for(const actor of s.actors??[]) {
    const anchor=s.anchors.find(a=>a.id===actor.id);const height=3200-Math.hypot(anchor.position[0],anchor.position[2])
    if(Math.abs(height-actor.height-(actor.id.startsWith('river:')?.02:0))>1e-6)throw Error('Visual anchor disagrees with route height')
    const gap=anchor.soleHeight-actor.height+(actor.id.startsWith('river:')?0:.02)
    if(gap<-.012||gap>.06)throw Error(`Shoes have left the support band: ${actor.id} ${gap}`)
    if(actor.visible){
     const shadowGap=anchor.shadowHeight-actor.height+(actor.id.startsWith('river:')?0:.02)
     if(anchor.shadowHeight===null||Math.abs(shadowGap)>.025)throw Error('Walking shadow left the ground')
    }
   }
  }
  report.views.push({name:v.name,frames});console.log(v.name,frames.map(s=>({name:s.name,people:s.people,actors:s.actors?.filter(a=>a.id.startsWith('river:')).map(a=>({id:a.id,h:a.height,walking:a.walking,blocked:a.blocked}))})))
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+`river-walkers-${tier}-${label}.json`,JSON.stringify(report,null,2));await browser.close()}
