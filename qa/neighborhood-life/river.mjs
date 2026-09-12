import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { riverViews, riverPose } from './river-views.mjs'
const base=process.env.SPINWARD_URL,label=process.env.LABEL??'first',tier=process.env.TIER??'desktop'
if(!base)throw Error('SPINWARD_URL required')
const output=fileURLToPath(new URL('.',import.meta.url)),evidence={label,tier,views:[],errors:[],consoleErrors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},deviceScaleFactor:1})
 await context.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 if(process.env.FALLBACK==='1')await context.route('**/assets/buildings/river-bridge.glb',r=>r.fulfill({status:200,contentType:'model/gltf+json',body:JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})}))
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text())})
 await page.goto('about:blank')
 evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 for(const v of riverViews.filter(v=>!process.env.VIEWS||process.env.VIEWS.split(',').includes(v.name))){
  const url=`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${riverPose(v)}`
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(fallback=>{const layer=window.__spinwardCity?.riverLayer;return fallback?layer?.fallback?.visible:layer?.group.userData.blenderReady},process.env.FALLBACK==='1')
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.waitForTimeout(1800);await page.keyboard.press('Escape')
  const probe=await page.evaluate(()=>({player:window.__spinward,stats:window.__spinwardCity.riverLayer.group.userData,buildings:window.__spinwardCity.riverBuildings.group.userData,
   plan:{a:window.__spinwardCity.riverDistrict.azimuth,ax:window.__spinwardCity.riverDistrict.axial,width:window.__spinwardCity.riverDistrict.width},
   rain:(()=>{const c=window.__spinwardCity,p=c.riverDistrict,roofs=c.getRainRoofs();const covered=(x,y)=>{const a=p.azimuth+x/3200,r=3198.8;return roofs.some(t=>r*Math.cos(a)*t.cos+r*Math.sin(a)*t.sin>=t.radial&&Math.abs((-r*Math.cos(a)*t.sin+r*Math.sin(a)*t.cos)*Math.cos(t.yaw??0)+(p.axial+y-t.axial)*Math.sin(t.yaw??0))<=t.halfWidth&&Math.abs(-(-r*Math.cos(a)*t.sin+r*Math.sin(a)*t.cos)*Math.sin(t.yaw??0)+(p.axial+y-t.axial)*Math.cos(t.yaw??0))<=t.halfDepth)};return {masks:c.riverLayer.rainRoofs.length,under:covered(13.5,3.375),outside:covered(13.5,20)}})(),
   fallback:window.__spinwardCity.riverLayer.fallback?.visible,
   meshes:window.__spinwardCity.riverLayer.group.children.map(o=>({name:o.name,visible:o.visible,triangles:o.geometry?(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3:null})),
   asset:document.querySelector('script[src*="/assets/"]')?.src}))
  if(probe.rain.masks!==1||!probe.rain.under||probe.rain.outside)throw Error('Bridge rain masking failed')
  if(v.name==='far'&&probe.stats.bridgeLod!==2)throw Error('Expected distant bridge LOD')
  if(process.env.FALLBACK==='1'&&(!probe.fallback||probe.stats.blenderReady))throw Error('Bridge fallback failed')
  if(process.env.PERF==='1')probe.timing=await page.evaluate(()=>new Promise(resolve=>{const dt=[],start=performance.now();let previous=start;const frame=now=>{dt.push(now-previous);previous=now;if(now-start<6000)requestAnimationFrame(frame);else{dt.sort((a,b)=>a-b);resolve({duration:now-start,frames:dt.length,fps:dt.length*1000/(now-start),p50:dt[Math.floor(dt.length*.5)],p95:dt[Math.floor(dt.length*.95)]})}};requestAnimationFrame(frame)}))
  const file=`river-${tier}-${label}-${v.name}.png`;await page.screenshot({path:output+file});evidence.views.push({name:v.name,url,file,...probe});console.log(v.name,JSON.stringify({stats:probe.stats,h:probe.player.groundHeight,mode:probe.player.mode,asset:probe.asset}))
 }
 if(process.env.CAR==='1'){
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.getByRole('button',{name:'Go now to Riverside',exact:true}).click()
  await page.waitForFunction(()=>Math.abs(window.__spinward.groundHeight-1.2)<.03)
  evidence.placeVisit=await page.evaluate(()=>({a:window.__spinward.azimuth,ax:window.__spinward.axial,h:window.__spinward.groundHeight}))
  await page.screenshot({path:output+`river-${tier}-${label}-place-visit.png`})
  const guide=await page.evaluate(()=>{const p=window.__spinwardCity.riverDistrict;const points=p.surfaces.filter(s=>s.material==='road').map(s=>{const b=s.collider,m=b.surfaceMesh,n=m.length/3;let x=0,y=0;for(let i=0;i<m.length;i+=3){x+=m[i]/n;y+=m[i+1]/n}return {a:b.azimuth+x/3200,ax:b.axial+y}});return points.map((p,i)=>{const n=points[Math.min(points.length-1,i+1)],o=points[Math.max(0,i-1)],dx=(n.a-o.a)*3200,dy=n.ax-o.ax,len=Math.hypot(dx,dy);return {a:p.a-dy/len*1.65/3200,ax:p.ax+dx/len*1.65}})})
  const first=guide[0];await page.evaluate(p=>window.__spinwardDrive.enterAt(p.a,p.ax,Math.PI/2),first)
  await page.waitForTimeout(800)
  const samples=[],start=Date.now();let held='';let reached=false
  try{
    while(Date.now()-start<100000){
      const d=await page.evaluate(()=>({...window.__spinward.drive,height:window.__spinwardCity.sampleRiverRoad(window.__spinward.drive.azimuth,window.__spinward.drive.axial)}))
      samples.push(d)
      let nearest=0;for(let i=1;i<guide.length;i++)if(Math.hypot((guide[i].a-d.azimuth)*3200,guide[i].ax-d.axial)<Math.hypot((guide[nearest].a-d.azimuth)*3200,guide[nearest].ax-d.axial))nearest=i
      if(nearest>=guide.length-5){reached=true;break}
      const target=guide[Math.min(guide.length-1,nearest+4)],heading=Math.atan2((target.a-d.azimuth)*3200,target.ax-d.axial),error=Math.atan2(Math.sin(heading-d.heading),Math.cos(heading-d.heading))
      const next=Math.abs(error)<.035?'':error>0?'KeyD':'KeyA'
      if(held!==next){if(held)await page.keyboard.up(held);held=next;if(held)await page.keyboard.down(held)}
      if(d.speed<5)await page.keyboard.down('KeyW');else await page.keyboard.up('KeyW')
      if(samples.length%35===0)await page.screenshot({path:output+`river-${tier}-${label}-car-${samples.length}.png`})
      if(d.crashed)throw Error('River driving collision '+JSON.stringify(d))
      await page.waitForTimeout(150)
    }
  }finally{await page.keyboard.up('KeyW');if(held)await page.keyboard.up(held);await page.keyboard.down('Space');await page.waitForTimeout(500);await page.keyboard.up('Space');evidence.car={reached,samples}}
  if(samples.some(s=>!s.grounded||s.gap-s.height<.3||s.gap-s.height>.8))throw Error('Car lost road support')
  if(!reached||Math.max(...samples.map(s=>s.height))<5.1)throw Error('Car failed to traverse the river street')
  console.log('car',JSON.stringify({reached,samples:samples.length,maxHeight:Math.max(...samples.map(s=>s.height))}))
 }
 if(process.env.WALK==='1'){
  const state=()=>page.evaluate(()=>{const s=window.__spinward;return {a:s.azimuth,ax:s.axial,h:s.groundHeight,mode:s.mode,seat:s.room.seat,sensor:s.room.sensor}})
  const moveTo=async v=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${riverPose({...v,ground:true})}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.riverLayer.group.userData.blenderReady);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(900)}
  evidence.walks=[]
  const walks=[
   {name:'down-ramp',at:[21,94,6.715],aim:[21,50,3],h:4.9156,ms:24000,delta:-2},
   {name:'up-ramp',at:[21,55,3.422],aim:[21,100,6.8],h:1.6222,ms:24000,delta:2},
   {name:'under-bridge',at:[13.5,17,3],aim:[13.5,-24,3],h:1.2,ms:18000,delta:0},
   {name:'over-bridge',at:[-18,.25*-18+4.7,7.14],aim:[30,.25*30+4.7,7.14],h:5.34,ms:18000,delta:0},
   {name:'approach',at:[-104,.25*-104+4.7,2.7],aim:[-65,.25*-65+4.7,7.14],h:1,ms:22000,delta:2}
  ]
  for(const w of walks){await moveTo(w);const start=await state(),samples=[];await page.keyboard.down('KeyW');try{for(let i=0;i<3;i++){await page.waitForTimeout(w.ms/3);samples.push(await state());await page.screenshot({path:output+`river-${tier}-${label}-${w.name}-${i}.png`})}}finally{await page.keyboard.up('KeyW')}const end=await state(),distance=Math.hypot((end.a-start.a)*3200,end.ax-start.ax);evidence.walks.push({name:w.name,start,end,distance,samples});console.log('walk',w.name,JSON.stringify({start,end,distance}));if(distance<18||end.mode!=='grounded'||(w.delta>0&&end.h-start.h<2)||(w.delta<0&&end.h-start.h> -2)||(w.delta===0&&Math.abs(end.h-start.h)>.05))throw Error('Invalid river walking route '+w.name)}
  const seats=await page.evaluate(()=>window.__spinwardCity.riverLayer.seats);evidence.seats=[]
  for(const seat of [seats[0],seats[3]]){const x=(seat.exit.azimuth-.1763264639508575)*3200,y=seat.exit.axialPosition-1445.8064516129052;await moveTo({at:[x,y,3],aim:[(seat.azimuth-.1763264639508575)*3200,y,1.8],h:1.2});await page.keyboard.press('KeyE');await page.waitForFunction(id=>window.__spinward.room.seat===id,seat.id);const seated=await state();await page.screenshot({path:output+`river-${tier}-${label}-${seat.id}.png`});await page.keyboard.press('KeyE');await page.waitForFunction(()=>!window.__spinward.room.seat);await page.waitForTimeout(500);const standing=await state();if(standing.sensor||Math.abs(standing.h-1.2)>.03||Math.hypot((standing.a-seat.exit.azimuth)*3200,standing.ax-seat.exit.axialPosition)>.1)throw Error('Invalid river seat exit');evidence.seats.push({id:seat.id,seated,standing})}
  // The water-side guard is solid; a pedestrian cannot simply walk into water.
  await moveTo({at:[17,0,3],aim:[0,0,3],h:1.2});await page.keyboard.down('KeyW');try{await page.waitForTimeout(4000)}finally{await page.keyboard.up('KeyW')}evidence.guard=await state();const gx=(evidence.guard.a-.1763264639508575)*3200;if(gx<9.8||gx>12||Math.abs(evidence.guard.h-1.2)>.05)throw Error('River guard failed '+JSON.stringify(evidence.guard))
 }
 if(evidence.errors.length||evidence.consoleErrors.length)throw Error(JSON.stringify([evidence.errors,evidence.consoleErrors]))
}finally{await fs.writeFile(output+`river-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
