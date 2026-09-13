import {chromium} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'quest';if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={tier,cases:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
export function bodyTrafficPose(p,heading){
 const a=p.azimuth,eye=new Vector3(Math.cos(a)*(3200-p.height-1.8),p.axial,Math.sin(a)*(3200-p.height-1.8))
 const forward=new Vector3(-Math.sin(a)*Math.sin(heading),Math.cos(heading),Math.cos(a)*Math.sin(heading))
 const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,eye.clone().add(forward),new Vector3(-Math.cos(a),0,-Math.sin(a))))
 return`m=g&a=${a}&ax=${p.axial}&gh=${p.height}&q=${q.toArray()}`
}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 const open=async(query,t='.42')=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&t=${t}&${query}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape')}
 await open('m=g&a=.1763264639508575&ax=1445.8064516129052&gh=5.2')
 report.asset=await page.locator('script[src*="/assets/"]').getAttribute('src')
 const river=await page.evaluate(()=>{const l=window.__spinwardCity.riverTraffic,p=l.points.find(p=>p.distance>=l.bridgeStart+110),next=l.points[l.points.indexOf(p)+1];return{azimuth:l.azimuth+p.x/l.radius,axial:l.axial+p.y,height:p.h,heading:Math.atan2(next.x-p.x,next.y-p.y)}})
 const fixtures=[{name:'street-day',person:{azimuth:-.2460132995312004,axial:-610,height:0},heading:0,phase:'.42'},
  {name:'bridge-night',person:river,heading:river.heading,phase:'.02'},
  {name:'bridge-day',person:river,heading:river.heading,phase:'.42'}]
 for(const f of fixtures.filter(f=>!process.env.CASE||f.name===process.env.CASE)){
  await open(bodyTrafficPose(f.person,f.heading+Math.PI),f.phase)
  const result={...f,frames:[]};report.cases.push(result)
  const probe=()=>page.evaluate(({heading,person})=>{const c=window.__spinwardCity,p=c.trafficPedestrian,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));return{body:p,mode:window.__spinward.mode,cars:c.getTrafficPositions().map((v,i)=>{const x=wrap(p.azimuth-v.azimuth)*c.radius,y=p.axial-v.axial;return{id:c.trafficRoutes[i].id,...v,along:x*Math.sin(heading)+y*Math.cos(heading),across:x*Math.cos(heading)-y*Math.sin(heading),oldAlong:wrap(person.azimuth-v.azimuth)*c.radius*Math.sin(heading)+(person.axial-v.axial)*Math.cos(heading)}}).filter(v=>Math.abs(v.height-p.height)<.6&&Math.abs(wrap(v.heading-heading))<.1&&Math.abs(v.across)<8),count:c.trafficRoutes.length,budget:c.maxTraffic}},f)
  const deadline=Date.now()+85000;let stopped
  while(Date.now()<deadline){const s=await probe();result.frames.push(s);stopped=s.cars.find(v=>v.along>3.6&&v.along<4.05&&Math.abs(v.across)<.15&&v.speed<.02);if(stopped)break;await page.waitForTimeout(250)}
  if(!stopped)throw Error('No stopped car '+f.name)
  result.stopped=stopped;await page.screenshot({path:out+`body-traffic-${tier}-${f.name}-stopped.png`});await page.waitForTimeout(2000)
  const held=await probe(),same=held.cars.find(c=>c.id===stopped.id);if(!same||same.speed>.02||Math.abs(same.along-stopped.along)>.03)throw Error('Did not hold clearance')
  const walkStart=Date.now();await page.keyboard.down('d')
  try{while(Date.now()-walkStart<2000){const s=await probe();if(s.cars.some(c=>c.id===stopped.id&&Math.abs(c.across)>2.5))break;await page.waitForTimeout(50)}}finally{await page.keyboard.up('d')}
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(300);await page.keyboard.up('ArrowDown')
  // Follow the passing car using ordinary camera keys. A front-only frame
  // crops the tyres and cannot establish the bridge/sidewalk relationship.
  result.passing=[]
  for(let i=0;i<12;i++){
   const aim=await page.evaluate(id=>{const c=window.__spinwardCity,index=c.trafficRoutes.findIndex(r=>r.id===id),car=c.getTrafficPositions()[index],p=c.trafficPedestrian,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],v=camera.position.clone();camera.getWorldDirection(v).transformDirection(c.group.matrixWorld.clone().invert());const heading=Math.atan2(-Math.sin(p.azimuth)*v.x+Math.cos(p.azimuth)*v.z,v.y),target=Math.atan2((car.azimuth-p.azimuth)*c.radius,car.axial-p.axial);return Math.atan2(Math.sin(target-heading),Math.cos(target-heading))},stopped.id)
   const key=aim>0?'ArrowRight':'ArrowLeft';await page.keyboard.down(key);await page.waitForTimeout(Math.min(180,Math.abs(aim)/1.4*800));await page.keyboard.up(key)
   if(i%2===1){const name=`body-traffic-${tier}-${f.name}-passing-${i}.png`;await page.screenshot({path:out+name});result.passing.push({image:name,state:await probe()})}
  }
  const end=Date.now()+10000;let resumed
  while(Date.now()<end){const s=await probe();result.frames.push(s);resumed=s.cars.find(c=>c.id===stopped.id&&c.oldAlong< -5&&c.speed>1);if(resumed){result.cleared=s;break}await page.waitForTimeout(100)}
  if(!resumed)throw Error('Car did not pass after walking clear')
  if(result.cleared.mode!=='grounded'||result.cleared.count>result.cleared.budget)throw Error('Support or capacity changed')
  await page.screenshot({path:out+`body-traffic-${tier}-${f.name}-released.png`});console.log('passed',f.name,JSON.stringify({stopped,body:result.cleared.body,speed:resumed.speed}))
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+`body-traffic-${tier}${process.env.CASE?'-'+process.env.CASE:''}.json`,JSON.stringify(report,null,2));await browser.close()}
