import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const tier=process.env.TIER??'desktop',time=process.env.TIME??'.42',prefix=process.env.PREFIX??'walkers'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:tier==='phone'?{width:390,height:844}:{width:1440,height:1000},hasTouch:tier==='phone',deviceScaleFactor:1}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+`/?debug&stats&m=g&a=0&ax=-200&t=${time}&tier=${tier}&dpr=1`)
  await page.waitForFunction(()=>window.__spinwardWalkers.group.userData.people>0)
  const route=await page.evaluate(()=>window.__spinwardWalkers.walkers[0].route)
  const offset=5, a=route.azimuth+(route.axis==='tangent'?offset/3200:0), ax=route.axial+(route.axis==='axial'?offset:0)
  const p=new T.Vector3(Math.cos(a)*(3200-(tier==='phone'?1.6:1.8)),ax,Math.sin(a)*(3200-(tier==='phone'?1.6:1.8)))
  const target=new T.Vector3(Math.cos(route.azimuth)*(3200-1),route.axial,Math.sin(route.azimuth)*(3200-1))
  const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))))
  await page.goto(base+`/?debug&stats&m=g&a=${a}&ax=${ax}&q=${q.toArray()}&t=${time}&tier=${tier}&dpr=1`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(id=>window.__spinwardWalkers.walkers.some(w=>w.route.id===id),route.id)
  await page.evaluate(id=>{
    document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())
    const w=window.__spinwardWalkers.walkers.find(w=>w.route.id===id);w.clock=w.route.length/w.route.speed/2
  },route.id)
  const samples=[]
  const capture=async(name)=>{
    const state=await page.evaluate(()=>({life:window.__spinwardWalkers.group.userData,stats:document.querySelector('.stats-overlay')?.textContent,azimuth:window.__spinward.azimuth,axial:window.__spinward.axial}))
    if(state.life.people>state.life.capacity||state.life.nearbyRoutes>500)throw Error('Unbounded local population')
    samples.push({name,...state});await page.screenshot({path:out+prefix+'-'+name+'.png'})
  }
  await capture('approach-0');await page.waitForTimeout(900);await capture('approach-1');await page.waitForTimeout(900);await capture('approach-2')
  await page.waitForFunction(id=>window.__spinwardWalkers.group.userData.actors.some(a=>a.id===id&&a.blocked),route.id,{timeout:12000})
  await capture('yield')
  // The ordinary player input moves away and the resident resumes its route.
  await page.keyboard.down('s');await page.waitForTimeout(1600);await page.keyboard.up('s')
  await page.waitForFunction(id=>window.__spinwardWalkers.group.userData.actors.some(a=>a.id===id&&!a.blocked&&a.walking),route.id)
  await capture('resume')
  if(errors.length)throw Error(JSON.stringify(errors))
  fs.writeFileSync(out+prefix+'.json',JSON.stringify({errors,route,samples},null,2));console.log(JSON.stringify({errors,route:route.id,counts:samples.map(s=>[s.name,s.life.people,s.life.nearbyRoutes,s.stats])}))
}finally{await browser.close()}
