import {chromium} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'desktop';if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={tier,views:[],walk:[],seams:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true})
const pose=(p,target)=>{const point=q=>new Vector3(Math.cos(q.azimuth)*(3200-(q.groundHeight??0)-1.8),q.axial,Math.sin(q.azimuth)*(3200-(q.groundHeight??0)-1.8));const eye=point(p),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,point(target),new Vector3(-Math.cos(p.azimuth),0,-Math.sin(p.azimuth))));return`m=g&a=${p.azimuth}&ax=${p.axial}&gh=${p.groundHeight??0}&q=${q.toArray()}`}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const open=async(query,phase='.42')=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&t=${phase}&${query}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardOuting?.destinations.has('guide-garden')&&window.__spinwardCity.curvedNeighborhood.buildings.modules);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click();await page.keyboard.press('Escape');await page.waitForTimeout(400)}
 const state=()=>page.evaluate(()=>{const s=window.__spinward,c=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],v=camera.position.clone();camera.getWorldDirection(v).transformDirection(c.group.matrixWorld.clone().invert());return{azimuth:s.azimuth,axial:s.axial,groundHeight:s.groundHeight,mode:s.mode,outing:s.outing,heading:Math.atan2(-Math.sin(s.azimuth)*v.x+Math.cos(s.azimuth)*v.z,v.y),target:window.__spinwardOuting.journey.points[s.outing.index]}})
 const shot=async name=>{await page.screenshot({path:out+`garden-directions-${tier}-${name}.png`});report.views.push({name,state:await state()})}
 const follow=async(route=null)=>{
  const deadline=Date.now()+120000;let index=1,progress=Date.now(),best=Infinity,last=-1
  try{while(Date.now()<deadline){const s=await state();report.walk.push(s);if(s.mode!=='grounded'||s.groundHeight<-.03||s.groundHeight>.38)throw Error('Lost supported footway '+JSON.stringify(s));if(!route&&s.outing.status==='arrived')return s
   const g=route?route[index]:s.target;if(!g)return s
   const dx=(g.azimuth-s.azimuth)*3200,dy=g.axial-s.axial,d=Math.hypot(dx,dy),id=route?index:s.outing.index
   if(route&&d<.22){index++;continue}
   if(id!==last||d<best-.08){last=id;best=d;progress=Date.now()}if(Date.now()-progress>8000)throw Error('Stalled '+JSON.stringify({s,g,index}))
   const error=Math.atan2(Math.sin(Math.atan2(dx,dy)-s.heading),Math.cos(Math.atan2(dx,dy)-s.heading))
   if(Math.abs(error)>.04){await page.keyboard.up('w');const key=error>0?'ArrowRight':'ArrowLeft';await page.keyboard.down(key);await page.waitForTimeout(Math.min(160,Math.max(12,Math.abs(error)/1.4*800)));await page.keyboard.up(key)}else{await page.keyboard.down('w');await page.waitForTimeout(Math.min(80,Math.max(16,d/3.6*600)))}}
   throw Error('Route timeout')
  }finally{await page.keyboard.up('w');await page.keyboard.up('ArrowLeft');await page.keyboard.up('ArrowRight')}
 }
 await open('visit=garden');report.asset=await page.locator('script[src*="/assets/"]').getAttribute('src')
 const fixtures=await page.evaluate(()=>{const p=window.__spinwardCity.curvedNeighborhood.plan,goal=window.__spinwardOuting.destinations.get('guide-garden').entrance;const world=q=>({azimuth:p.azimuth+q[0]/3200,axial:p.axial+q[1],groundHeight:q[2]});return{goal,connections:p.walkConnections.map(c=>({side:c.side,end:c.end,portal:world(c.points[2]),inner:world(c.points[0])}))}});report.fixtures=fixtures
 const start={azimuth:.23313371027541227,axial:464.84167035358854,groundHeight:.34}
 await open(pose(start,fixtures.goal));const before=await state();await page.getByRole('button',{name:'Places',exact:true}).click();await shot('places');await page.getByRole('button',{name:'Directions to Garden street',exact:true}).click();await page.waitForFunction(()=>window.__spinward.outing.status==='active');const after=await state();if(!after.outing.detail.includes(`${Math.ceil(after.outing.remaining)} m on foot`))throw Error('Missing remaining walking distance');if(Math.hypot((before.azimuth-after.azimuth)*3200,before.axial-after.axial)>.15)throw Error('Directions teleported player');await shot('directions')
 report.route=await page.evaluate(()=>window.__spinwardOuting.journey.points);if(!report.route.some(p=>p.curvedWalk))throw Error('Missing curved footway')
 if(process.env.WALK==='1'){report.arrival=await follow();await shot('arrived');if(Math.abs(report.arrival.groundHeight-.34)>.03)throw Error('Wrong arrival height')}
 await open(pose(start,fixtures.goal),'.02');await page.getByRole('button',{name:'Places',exact:true}).click();await page.getByRole('button',{name:'Directions to Garden street',exact:true}).click();await shot('night')
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Places',exact:true}).click();const go=page.getByRole('button',{name:'Go now to Garden street',exact:true});await go.scrollIntoViewIfNeeded();await shot('phone-places');await go.click();await page.waitForFunction(()=>window.__spinward.outing.action===null&&Math.abs(window.__spinward.groundHeight-.34)<.03);report.visit=await state();if(Math.hypot((report.visit.azimuth-fixtures.goal.azimuth)*3200,report.visit.axial-fixtures.goal.axial)>.3)throw Error('Wrong Go now target');await shot('phone-visit');await page.setViewportSize({width:1440,height:900})
 if(process.env.SEAMS==='1')for(const c of fixtures.connections){
  const start={...c.portal,axial:c.portal.axial+c.side*2},inside={...c.inner};await open(pose(start,inside));const route=await page.evaluate(({a,b})=>window.__spinwardOuting.route(a,b,false),{a:start,b:inside});if(!route)throw Error('Missing entrance route');const entered=await follow(route);await shot(`entry-${c.end}-${c.side}`)
  const back=await page.evaluate(({a,b})=>window.__spinwardOuting.route(a,b,false),{a:entered,b:start});if(!back)throw Error('Missing exit route');const exited=await follow(back);if(Math.abs(exited.groundHeight)>.025)throw Error('Did not return to street');report.seams.push({connection:c,entered,exited,route,back});console.log('seam passed',c.end,c.side)
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+`garden-directions-${tier}.json`,JSON.stringify(report,null,2));await browser.close()}
