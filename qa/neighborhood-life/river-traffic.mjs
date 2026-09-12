import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {riverViews,riverPose} from './river-views.mjs'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'desktop',label=process.env.LABEL??'first'
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),evidence={tier,label,errors:[],views:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>evidence.errors.push(e.message))
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 await page.goto('about:blank')
 evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const gpu=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return gpu})
 if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 const visit=async view=>{
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${riverPose(view)}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked&&window.__spinwardCity.riverTraffic)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape')
 }
 await visit(riverViews[0])
 evidence.circuit=await page.evaluate(()=>{
  const c=window.__spinwardCity,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),start=new Map(c.trafficRoutes.filter(r=>r.path).map(r=>[r.id,r.motion.progress]))
  const samples=[],overlaps=[];let maxStep=0,minHeight=Infinity,maxHeight=0
  let previous=c.getTrafficPositions()
  const dimensions=c.kenneyCarGeometries.cars.map(g=>{g.computeBoundingBox();const b=g.boundingBox;return {w:b.max.x-b.min.x,d:b.max.z-b.min.z}})
  const intersect=(a,ra,b,rb)=>{
    if(Math.abs(a.height-b.height)>1)return false
    const dx=wrap(b.azimuth-a.azimuth)*c.radius,dy=b.axial-a.axial
    if(Math.abs(dx)>7||Math.abs(dy)>7)return false
    const extent=r=>{const d=dimensions[r.variant%dimensions.length];return {w:d.w*r.scale/2,d:d.d*r.scale/2}}
    const A=extent(ra),B=extent(rb)
    for(const theta of [a.heading,a.heading+Math.PI/2,b.heading,b.heading+Math.PI/2]){
      const distance=Math.abs(dx*Math.sin(theta)+dy*Math.cos(theta))
      const range=(v,e)=>Math.abs(Math.cos(v.heading-theta))*e.d+Math.abs(Math.sin(v.heading-theta))*e.w
      if(distance>=range(a,A)+range(b,B)-.01)return false
    }
    return true
  }
  // Advance the actual city traffic integrator with bounded 0.1s steps. This
  // is accelerated simulation coverage, not a real-time performance result.
  for(let frame=0;frame<6500;frame++){
    c.update(.1);const positions=c.getTrafficPositions()
    for(let i=0;i<positions.length;i++)if(c.trafficRoutes[i].path){
      const p=positions[i],old=previous[i],route=c.trafficRoutes[i]
      maxStep=Math.max(maxStep,Math.hypot(wrap(p.azimuth-old.azimuth)*c.radius,p.axial-old.axial,p.height-old.height))
      minHeight=Math.min(minHeight,p.height);maxHeight=Math.max(maxHeight,p.height)
      for(let j=0;j<positions.length;j++)if(j!==i&&intersect(p,route,positions[j],c.trafficRoutes[j])){
        if(overlaps.length<12)overlaps.push({frame,id:route.id,other:c.trafficRoutes[j].id,p,otherPosition:positions[j],progress:route.motion.progress})
      }
    }
    if(frame%100===0)samples.push(c.trafficRoutes.filter(r=>r.path).map(r=>({id:r.id,...r.motion})))
    previous=positions
  }
  const laps=c.trafficRoutes.filter(r=>r.path).map(r=>({id:r.id,progress:r.motion.progress-start.get(r.id),laps:(r.motion.progress-start.get(r.id))/r.path.length,speed:r.motion.speed}))
  const continuity=[]
  for(const [da,dy]of [[32,0],[0,32],[-32,-32],[0,0]]){
    const before=c.trafficRoutes.filter(r=>r.path).map(r=>({id:r.id,...r.motion})).sort((a,b)=>a.id.localeCompare(b.id)),count=c.trafficRoutes.length
    c.setFocusSurface(c.riverTraffic.azimuth+da/c.radius,c.riverTraffic.axial+dy,5.2)
    const after=c.trafficRoutes.filter(r=>r.path).map(r=>({id:r.id,...r.motion})).sort((a,b)=>a.id.localeCompare(b.id))
    continuity.push({before,after,count,nextCount:c.trafficRoutes.length,max:c.maxTraffic})
  }
  return {length:c.riverTraffic.length,count:start.size,laps,maxStep,minHeight,maxHeight,overlaps,samples,continuity}
 })
 const circuit=evidence.circuit
 console.log(JSON.stringify({circuit:{...circuit,samples:undefined,continuity:undefined}}))
 if(circuit.overlaps.length)throw Error('Riverside vehicle body overlap')
 if(circuit.laps.some(v=>v.laps<1)||circuit.maxStep>.72||circuit.maxHeight<5.19)throw Error('Circuit did not complete continuously')
 if(circuit.continuity.some(c=>JSON.stringify(c.before)!==JSON.stringify(c.after)||c.nextCount>c.max))throw Error('Focus refresh changed a river vehicle or exceeded the budget')
 for(const [name,view,seconds]of [
  ['approach',riverViews[4],0],['bridge',riverViews[2],20],['night',{...riverViews[2],phase:.02},20],
  ['merge',{name:'merge',at:[119,47,1.8],aim:[105,30,1.2],ground:true,h:0},43],['far',riverViews[5],0]
 ]){
  await visit(view)
  if(seconds)await page.evaluate(seconds=>{for(let t=0;t<seconds;t+=.1)window.__spinwardCity.update(.1)},seconds)
  await page.waitForTimeout(500)
  const probe=await page.evaluate(()=>{
    const c=window.__spinwardCity,positions=c.getTrafficPositions(),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],cars=[]
    const counts=new Map()
    for(let i=0;i<c.trafficRoutes.length;i++){
      const route=c.trafficRoutes[i],variant=route.variant%c.trafficMeshes.length,at=counts.get(variant)??0;counts.set(variant,at+1)
      if(!route.path)continue
      const p=positions[i],mesh=c.trafficMeshes[variant],m=mesh.matrix.clone();mesh.getMatrixAt(at,m)
      const distance=Math.hypot(m.elements[12]-Math.cos(p.azimuth)*(c.radius-p.height),m.elements[13]-p.axial,m.elements[14]-Math.sin(p.azimuth)*(c.radius-p.height))
      if(distance>.001||Math.abs(m.determinant()-1)>.00001)throw Error('Traffic instance detached or mirrored')
      const projected=c.group.localToWorld(camera.position.clone().set(m.elements[12],m.elements[13],m.elements[14])).project(camera).toArray()
      cars.push({id:route.id,p,matrix:m.elements,projected})
    }
    return {cars,total:c.trafficRoutes.length,max:c.maxTraffic,clock:c.getTrafficClock(),asset:document.querySelector('script[src*="/assets/"]')?.src}
  })
  if(name==='far'&&probe.cars.length)throw Error('Distant river traffic retained its reserved slots')
  if(name!=='far'&&!probe.cars.length)throw Error('Near river traffic absent')
  const file=`river-traffic-${tier}-${label}-${name}.png`;await page.screenshot({path:out+file});evidence.views.push({name,file,url:page.url(),probe})
  if(name==='bridge'){
    const frames=[]
    for(let i=0;i<3;i++){
      await page.waitForTimeout(800)
      const motion=await page.evaluate(()=>{const c=window.__spinwardCity,ps=c.getTrafficPositions();return c.trafficRoutes.flatMap((r,i)=>r.path?[{id:r.id,progress:r.motion.progress,...ps[i]}]:[])})
      const image=`river-traffic-${tier}-${label}-moving-${i}.png`;await page.screenshot({path:out+image});frames.push({image,motion})
    }
    evidence.motion=frames
    for(const car of frames[0].motion){const next=frames.at(-1).motion.find(v=>v.id===car.id);if(!next||next.progress-car.progress<.1)throw Error('Real-time traffic never advanced')}
  }
 }
 if(evidence.errors.length)throw Error(evidence.errors.join('\n'))
}finally{await fs.writeFile(out+`river-traffic-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
