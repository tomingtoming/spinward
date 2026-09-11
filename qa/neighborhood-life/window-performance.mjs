// Compare both builds in the same browser/session, including a reversed order.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const before=process.env.BASELINE_URL,after=process.env.SPINWARD_URL??'https://127.0.0.1:5192';
if(!before)throw Error('BASELINE_URL is required');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];for(const [build,base] of [['before',before],['after',after],['after',after],['before',before]]){
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});
 await page.goto(base+'/?debug&stats&visit=city-block&t=.42&rpm=0&dpr=1',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity.colonyBuildings.group.userData.asset&&window.__spinwardCity.authoredBlock.group.userData.buildings.every(b=>b.asset));
 await page.waitForTimeout(4000);
 const data=await page.evaluate(async()=>{const samples=[];let last=performance.now(),start=last;await new Promise(resolve=>{const frame=now=>{samples.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)});samples.shift();samples.sort((a,b)=>a-b);const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',median:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],samples:samples.length,stats:document.querySelector('.stats-overlay')?.textContent,detail:window.__spinwardCity.colonyBuildings.group.userData}});
 if(errors.length||/SwiftShader|llvmpipe/i.test(data.renderer))throw Error(JSON.stringify({data,errors}));
 reports.push({build,base,...data,errors});console.log(JSON.stringify(reports.at(-1)));await page.close();
 }fs.writeFileSync(fileURLToPath(new URL('window-performance.json',import.meta.url)),JSON.stringify(reports,null,2));
}finally{await browser.close()}
