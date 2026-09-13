import {chromium} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'desktop';if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),report={tier,views:[],walk:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const s=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return s});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const open=async(pose,phase='.42')=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&t=${phase}&${pose}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForFunction(()=>window.__spinwardCity?.colonyBuildings.modules);await page.waitForTimeout(700);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.keyboard.press('Escape');if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()}
 const state=()=>page.evaluate(()=>{const w=window.__spinward,c=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],v=camera.position.clone();camera.getWorldDirection(v).transformDirection(c.group.matrixWorld.clone().invert());return{a:w.azimuth,ax:w.axial,h:w.groundHeight,mode:w.mode,heading:Math.atan2(-Math.sin(w.azimuth)*v.x+Math.cos(w.azimuth)*v.z,v.y),parking:w.parking,balconyCount:c.balconyCollisionSources.reduce((n,s)=>n+s.length,0),stats:c.curvedNeighborhood.group.userData}})
 const shot=async(name)=>{await page.screenshot({path:out+`city-access-${tier}-${name}.png`});const s=await state();report.views.push({name,...s});console.log(name,JSON.stringify(s))}
 const pose=(a,ax,h,target,ground=true)=>{const r=3200,eye=new Vector3(Math.cos(a)*(r-h-1.8),ax,Math.sin(a)*(r-h-1.8)),up=new Vector3(-Math.cos(a),0,-Math.sin(a)),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,up));return ground?`m=g&a=${a}&ax=${ax}&gh=${h}&q=${q.toArray()}`:`m=f&rpm=0&p=${eye.toArray()}&q=${q.toArray()}`}
 await open('visit=nyaan')
 const balcony=await page.evaluate(()=>{const layer=window.__spinwardCity.colonyBuildings,active=layer.getBalconyColliders();for(const e of layer.entries)for(const c of e.contacts??[]){const b=c.boxes[0];if(!active.includes(b)||Math.min(b.width,b.depth)>.99*1.15||Math.max(b.width,b.depth)<4||b.baseHeight<6||b.baseHeight>16)continue;return{boxes:c.boxes,point:c.point.toArray(),frame:e.matrix.elements}}throw Error('No usable balcony fixture')})
 report.balcony=balcony
 const floor=balcony.boxes[0],a=floor.azimuth,ax=floor.axial,h=floor.baseHeight+floor.height,frame=new Matrix4().fromArray(balcony.frame),direction=new Vector3(0,0,1).transformDirection(frame)
 const eye=new Vector3(Math.cos(a)*(3200-h-1.8),ax,Math.sin(a)*(3200-h-1.8))
 await open(pose(a,ax,h,eye.clone().add(direction.multiplyScalar(5))));await shot('balcony-standing');const start=await state()
 await page.keyboard.down('w');await page.waitForTimeout(2200);await page.keyboard.up('w');await page.waitForTimeout(400);const stop=await state();report.guard={start,stop};if(Math.hypot((stop.a-start.a)*3200,stop.ax-start.ax)>.8||Math.abs(stop.h-h)>.08||stop.mode!=='grounded')throw Error('Balcony guard failed')
 await page.keyboard.down('ArrowDown');await page.waitForTimeout(650);await page.keyboard.up('ArrowDown');await shot('balcony-guard');await page.keyboard.press('Space');await page.waitForFunction(()=>window.__spinward.mode==='free-fly');await page.waitForFunction(()=>window.__spinward.mode==='grounded',{},{timeout:20000});await shot('balcony-landed');if(Math.abs((await state()).h-h)>.08)throw Error('Jump did not return to the same balcony')
 const street=await page.evaluate(()=>{const p=window.__spinwardCity.curvedNeighborhood.plan;return{azimuth:p.azimuth,axial:p.axial,knots:p.knots,route:p.surfaces.filter(s=>s.kind==='walk').filter((s,i)=>i<2*Math.ceil((p.knots[2].point[0]-p.knots[0].point[0])/1.5)&&i%2===1).map(s=>{const b=s.collider,v=b.surfaceMesh;return{a:b.azimuth+(v[0]+v[3]+v[6]+v[15])/4/3200,ax:b.axial+(v[1]+v[4]+v[7]+v[16])/4,h:.34}})}});report.street=street
 const first=street.route[0],next=street.route[5],target=new Vector3(Math.cos(next.a)*(3200-2.14),next.ax,Math.sin(next.a)*(3200-2.14))
 await open(pose(first.a,first.ax,.34,target));await shot('curved-entry')
 if(process.env.WALK==='1'){
  const route=street.route.filter((p,i)=>i%5===0||i===street.route.length-1)
  for(const [i,g]of route.entries()){
   const deadline=Date.now()+12000;let done=false
   while(Date.now()<deadline){const s=await state();report.walk.push({i,...s});const dx=(g.a-s.a)*3200,dy=g.ax-s.ax,d=Math.hypot(dx,dy);if(s.mode!=='grounded'||s.h<.19||s.h>.37)throw Error('Lost curved footway '+JSON.stringify(s));if(d<.3){done=true;break}const delta=Math.atan2(Math.sin(Math.atan2(dx,dy)-s.heading),Math.cos(Math.atan2(dx,dy)-s.heading));if(Math.abs(delta)>.04){await page.keyboard.up('w');const k=delta>0?'ArrowRight':'ArrowLeft';await page.keyboard.down(k);await page.waitForTimeout(Math.min(120,Math.max(12,Math.abs(delta)/1.4*700)));await page.keyboard.up(k)}else{await page.keyboard.down('w');await page.waitForTimeout(90)}}
   await page.keyboard.up('w');if(!done)throw Error('Curved street stalled at '+i);if(i===Math.floor(route.length/2))await shot('curved-middle')
  }await shot('curved-exit')
 }
 for(const [name,x,y,h,phase]of [['curve-overview',10,-60,100,'.42'],['curve-night',-42,-45,14,'.02'],['curve-street',0,7,1.8,'.42']]){
  const a=street.azimuth+x/3200,ax=street.axial+y,t=new Vector3(Math.cos(street.azimuth)*(3200-4),street.axial,Math.sin(street.azimuth)*(3200-4));await open(pose(a,ax,h,t,false),phase);await shot(name)
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+`city-access-${tier}-views.json`,JSON.stringify(report,null,2));await browser.close()}
