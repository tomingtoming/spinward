import{chromium}from'@playwright/test'
import{Vector3,Quaternion,Matrix4}from'three'
import fs from'node:fs/promises'
import{fileURLToPath}from'node:url'
const base=process.env.SPINWARD_URL;if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),c=JSON.parse(await fs.readFile(new URL('../../assets/blender/nyaan-apartment.json',import.meta.url),'utf8')),b=c.interior.building,f=c.interior.depth/2
const browser=await chromium.launch({channel:'chrome',headless:true}),report={views:[],errors:[]}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const open=async pose=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&t=.42&${pose}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForTimeout(900);await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.keyboard.press('Escape');if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()}
 const screenshot=async name=>{await page.screenshot({path:out+`apartment-access-${name}.png`});report.views.push({name,url:page.url(),state:await page.evaluate(()=>({a:window.__spinward.azimuth,ax:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode,drive:window.__spinward.drive}))})}
 const world=(x,h,z)=>new Vector3(Math.cos(b.azimuth+x/3200)*(3200-h),b.axial-z,Math.sin(b.azimuth+x/3200)*(3200-h))
 for(const [name,x,z,h,aim]of [['stairs',1.95,f-1.65,.25,[1.95,4.2,f-7.8]],['landing',0,f-8.25,3.45,[-1,4.8,c.room.doorZ]],['room',-1.85,c.room.doorZ+.3,3.473,[-3,4.3,f-1.3]],['exterior',3,f+14,0,[-1,4.5,f]],['downstairs',1.95,f-8.25,3.45,[1.95,1.1,f-1.4]]]){
  if(process.env.VIEW&&process.env.VIEW!==name)continue
  const a=b.azimuth+x/3200,eye=world(x,h+1.8,z),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,world(...aim),new Vector3(-Math.cos(a),0,-Math.sin(a))))
  await open(`m=g&a=${a}&ax=${b.axial-z}&gh=${h}&q=${q.toArray()}`);await page.waitForFunction(()=>window.__spinwardCity.group.getObjectByName('nyaan-lod-0')?.children.length>0);await screenshot(name)
 }
 if(!process.env.VIEW){
 const bay=await page.evaluate(()=>window.__spinwardCity.getCarShareBay());if(!bay)throw Error('Car share disappeared');report.bay=bay
 const a=bay.azimuth-Math.cos(bay.heading)*bay.signSide*2.5/3200,ax=bay.axial+Math.sin(bay.heading)*bay.signSide*2.5,eye=new Vector3(Math.cos(a)*(3200-bay.height-1.8),ax,Math.sin(a)*(3200-bay.height-1.8)),target=new Vector3(Math.cos(bay.azimuth)*(3200-bay.height-.8),bay.axial,Math.sin(bay.azimuth)*(3200-bay.height-.8)),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,new Vector3(-Math.cos(a),0,-Math.sin(a))))
 await open(`m=g&a=${a}&ax=${ax}&gh=${bay.height}&q=${q.toArray()}`);await screenshot('car-share')
 await page.keyboard.press('e');await page.waitForFunction(()=>window.__spinward.drive.driving);await screenshot('driving')
 await page.keyboard.down('w');await page.waitForTimeout(1000);await page.keyboard.up('w');await page.keyboard.down('Space');await page.waitForFunction(()=>window.__spinward.drive.speed<.25);await page.keyboard.up('Space');await page.keyboard.press('e');await page.waitForFunction(()=>!window.__spinward.drive.driving);await screenshot('car-exit')
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
 console.log(JSON.stringify({gpu:report.gpu,views:report.views.length,bay:report.bay,errors:report.errors}))
}finally{await fs.writeFile(out+`apartment-access-${process.env.VIEW??'views'}.json`,JSON.stringify(report,null,2));await browser.close()}
