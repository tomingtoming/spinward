import {probeRoofs} from './roof-probe.mjs';
import {probeStairs} from './stair-probe.mjs';
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import * as T from 'three';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',prefix=process.env.PREFIX??'roof-details';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];for(const use of (process.env.USES??'apartments,office,industrial').split(',')){
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});
 if(process.env.FALLBACK)await page.route('**/colony-modules.glb',route=>route.abort());
 await page.goto(base+'/?debug&visit=city-block&rpm=0',{waitUntil:'domcontentloaded'});await page.waitForSelector('#splash',{state:'detached'});
 const target=await page.evaluate(use=>{
  const c=window.__spinwardCity.colonyBuildings;
  const entries=c.entries.filter(e=>e.roof&&e.design.use.primary===use&&e.roof.w>16&&e.roof.d>9&&e.roof.w<45&&e.roof.d<40);
  entries.sort((a,b)=>Math.hypot(a.spec.building.azimuth*3200,a.spec.building.axial)-Math.hypot(b.spec.building.azimuth*3200,b.spec.building.axial));
  if(!entries.length)throw Error('No roof representative');const e=entries[0];return {b:e.spec.building,matrix:e.matrix.elements,roof:e.roof};
 },use);
 const matrix=new T.Matrix4().fromArray(target.matrix),v=target.roof,d=Number(process.env.DISTANCE??35),time=process.env.TIME??'.42';
 const aim=new T.Vector3(v.x,v.y+v.h/2,v.z).applyMatrix4(matrix),pos=new T.Vector3(v.x+d*.5,v.y+v.h/2+d*.45,v.z+d*.74).applyMatrix4(matrix),up=new T.Vector3(0,1,0).transformDirection(matrix);
 const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,aim,up));
 const url=base+`/?debug&stats&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=${time}&dpr=1`;
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached'});
 await page.waitForFunction(fallback=>fallback||window.__spinwardCity.colonyBuildings.group.userData.asset,!!process.env.FALLBACK);await page.waitForTimeout(1000);
 const roofs=await page.evaluate(probeRoofs,target.b),stairs=await page.evaluate(probeStairs);
 if(d<60&&!process.env.FALLBACK&&!roofs.target?.detailed)throw Error('Near target lost roof details');
 if((d>90||process.env.FALLBACK)&&roofs.target?.detailed)throw Error('Target retained expensive detail outside range');
 if(d>270&&roofs.target?.rendered)throw Error('Distant target retained roof equipment');
 const data=await page.evaluate(async()=>{
  const samples=[];let last=performance.now(),start=last;await new Promise(resolve=>{const frame=now=>{samples.push(now-last);last=now;if(now-start<3000)requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)});samples.shift();samples.sort((a,b)=>a-b);
  const city=window.__spinwardCity,gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  return {stats:document.querySelector('.stats-overlay')?.textContent,median:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',beacons:city.beacons.count,stems:city.beaconStems.count};
 });
 if(errors.length||data.beacons!==data.stems||/SwiftShader|llvmpipe/i.test(data.renderer))throw Error(JSON.stringify({errors,data}));
 await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())});
 await page.screenshot({path:out+prefix+'-'+use+'.png'});const report={use,target,url,roofs,stairs,...data,errors};reports.push(report);console.log(JSON.stringify(report));fs.writeFileSync(out+prefix+'.json',JSON.stringify(reports,null,2));await page.close();
}}finally{await browser.close()}
