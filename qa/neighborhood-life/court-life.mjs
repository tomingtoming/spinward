import {chromium} from '@playwright/test'
import {Matrix4, Quaternion, Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const base=process.env.SPINWARD_URL, label=process.env.LABEL??'after', tier=process.env.TIER??'desktop', before=!!process.env.BASELINE_DIR
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)), evidence={label,tier,views:[],seating:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
const center={a:.01939436514508575,ax:-17412.754664883592},cx=-15.877007576480302/2+1.2,cy=-6.4
const point=(x,y,h)=>new Vector3(Math.cos(center.a+x/3200)*(3200-h),center.ax+y,Math.sin(center.a+x/3200)*(3200-h))
function viewURL(at,aim,phase=.5,ground=false){
 const p=point(...at),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p,point(...aim),new Vector3(-Math.cos(center.a+at[0]/3200),0,-Math.sin(center.a+at[0]/3200))))
 const body=p.clone().add(new Vector3(0,-1.8,0).applyQuaternion(q))
 return `t=${phase}&q=${q.toArray()}&${ground?`m=g&a=${center.a+at[0]/3200}&ax=${center.ax+at[1]}&gh=.12`:`m=f&rpm=0&p=${body.toArray()}`}`
}
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},deviceScaleFactor:1})
 await context.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 if(before){const file=(await fs.readdir(process.env.BASELINE_DIR+'/assets')).find(f=>/^index-.*\.js$/.test(f));const body=await fs.readFile(process.env.BASELINE_DIR+'/assets/'+file);evidence.baseline={file,sha256:createHash('sha256').update(body).digest('hex')};await context.route('**/assets/index-*.js',r=>r.fulfill({status:200,body,contentType:'application/javascript'}))}
 if(process.env.ASSET_FAILURE==='1')await context.route('**/balcony-life.glb',r=>r.fulfill({status:200,body:JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0}),contentType:'model/gltf+json'}))
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message))
 await page.goto('about:blank');evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 const visit=async query=>{
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${query}`,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>window.__spinwardBody?.group.userData.ready&&window.__spinwardCity.oldTownBlock.group.userData.ready)
  if(!before&&process.env.ASSET_FAILURE!=='1')await page.waitForFunction(()=>window.__spinwardCity.oldTownCourt.group.userData.furnitureReady)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape');await page.waitForTimeout(900)
 }
 const probe=()=>page.evaluate(()=>{
  const c=window.__spinwardCity.oldTownCourt,city=window.__spinwardCity
  const batches=c?.group.children.map(m=>{const matrices=[];for(let i=0;i<m.count;i++){const a=m.matrix.clone();m.getMatrixAt(i,a);matrices.push(a.elements)}const v=m.geometry.attributes.position;let bottom=Infinity;for(let j=0;j<v.count;j++)bottom=Math.min(bottom,v.getY(j));return {name:m.name,count:m.count,matrices,bottom}})??[]
  return {stats:c?.group.userData,plan:c?.plan,paving:city.oldTownBlock.group.userData.court,batches,
   body:window.__spinwardBody.group.userData,seat:window.__spinward.room.seat,sensor:window.__spinward.room.sensor,
   mode:window.__spinward.mode,a:window.__spinward.azimuth,ax:window.__spinward.axial,h:window.__spinward.groundHeight,
   city:JSON.stringify(city.cityPlan),colliderInstalled:c?.plan.colliders.every(p=>city.collisionBuildings.some(b=>b.azimuth===p.azimuth&&b.axial===p.axial&&b.height===p.height&&b.baseHeight===p.baseHeight))}
 })
 for(const v of [
  {name:'near',at:[cx+2,cy+3.5,2.4],aim:[cx,cy,.6]},
  {name:'court',at:[0,6,5],aim:[0,-6,1]},
  {name:'night',at:[cx+2,cy+3.5,2.4],aim:[cx,cy,.6],phase:.02},
  {name:'medium',at:[cx,cy+33,6],aim:[cx,cy,.6]},
  {name:'far',at:[cx,cy+125,100],aim:[cx,cy,.6]},
 ]){
  if(process.env.VIEWS&&!process.env.VIEWS.split(',').includes(v.name))continue
  await visit(viewURL(v.at,v.aim,v.phase));const data=await probe()
  data.projected=await page.evaluate(p=>{const c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return c.position.clone().fromArray(p).project(c).toArray()},point(...v.aim).toArray())
  if(Math.abs(data.projected[0])>.1||Math.abs(data.projected[1])>.1||Math.abs(data.projected[2])>=1)throw Error('Court inspection target off-camera')
  data.cityHash=createHash('sha256').update(data.city).digest('hex');delete data.city
  if(!before){
   if(!data.colliderInstalled)throw Error('Missing court collider')
   if(tier==='desktop'){
    if(data.plan.seats.length!==2||data.plan.props.length!==6)throw Error('Court furnishings absent')
    if(v.name==='far'?data.stats.drawCalls!==0:data.stats.drawCalls!==4)throw Error('Court LOD budget mismatch')
    for(const b of data.batches)if(b.name==='court-pots')for(const m of b.matrices){
     const bottom=new Vector3(0,b.bottom,0).applyMatrix4(new Matrix4().fromArray(m))
     if(Math.abs(3200-Math.hypot(bottom.x,bottom.z)-.12)>.002)throw Error('Pot is not on the paving')
    }
    for(const b of data.batches)if(['court-chair','court-table'].includes(b.name))for(const m of b.matrices){
     if(!data.plan.props.some(p=>b.name==='court-'+p.kind&&Math.hypot(m[12]-Math.cos(p.azimuth)*(3200-.12),m[13]-p.axial,m[14]-Math.sin(p.azimuth)*(3200-.12))<.002))throw Error('Furniture feet detached')
    }
   }else if(data.stats.props||data.stats.seats||data.stats.colliders||data.stats.drawCalls)throw Error('Uncertified light-budget court')
  }
  const file=`court-life-${tier}-${label}-${v.name}.png`;await page.screenshot({path:out+file});evidence.views.push({name:v.name,file,...data});console.log(v.name,JSON.stringify(data.stats??{}))
 }
 if(!before&&tier==='desktop'&&process.env.NO_WALK!=='1'){
  const seats=(await probe()).plan.seats
  for(const seat of seats){
   const x=(seat.azimuth-center.a)*3200,y=seat.exit.axialPosition-center.ax
   await visit(viewURL([x,y,1.92],[x,y-2,.6],.5,true))
   await page.keyboard.press('KeyE');await page.waitForFunction(id=>window.__spinward.room.seat===id,seat.id)
   await page.keyboard.down('ArrowDown');await page.waitForTimeout(650);await page.keyboard.up('ArrowDown')
   const sitting=await probe();delete sitting.city
   if(sitting.body.mode!=='seated'||!sitting.sensor)throw Error('Seat input failed')
   await page.screenshot({path:out+`court-life-${tier}-${label}-${seat.id}-seated.png`})
   await page.keyboard.press('KeyE');await page.waitForFunction(()=>!window.__spinward.room.seat);await page.waitForTimeout(400)
   const standing=await probe();delete standing.city
   if(standing.sensor||Math.abs(standing.ax-seat.exit.axialPosition)>.05||Math.abs(standing.h-.12)>.01)throw Error('Invalid chair exit')
   // Normal W input must leave the furniture pocket without an invisible barrier.
   let departureError
   await page.keyboard.down('KeyW');try{await page.waitForFunction(ax=>window.__spinward.axial-ax>2.4,standing.ax,{timeout:8000})}catch(e){departureError=e.message}finally{await page.keyboard.up('KeyW')}
   const walk=await probe();delete walk.city
   evidence.seating.push({seat,sitting,standing,walk,departureError})
   if(departureError||walk.ax-standing.ax<2.3||walk.mode!=='grounded')throw Error('Standing route obstructed: '+JSON.stringify({standing,walk}))
  }
  await visit(viewURL([0,8,1.92],[0,-9,1.92],.5,true));const start=await probe();delete start.city
  await page.keyboard.down('KeyW');try{await page.waitForFunction(ax=>ax-window.__spinward.axial>14,start.ax,{timeout:12000})}finally{await page.keyboard.up('KeyW')}
  const end=await probe();delete end.city
  if(start.ax-end.ax<13||end.mode!=='grounded'||Math.abs(end.a-center.a)*3200>.1)throw Error('Central court corridor blocked')
  evidence.throughWalk={start,end};await page.screenshot({path:out+`court-life-${tier}-${label}-through-walk.png`})
 }
 if(evidence.errors.length)throw Error(evidence.errors.join('\n'))
}finally{await fs.writeFile(out+`court-life-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
