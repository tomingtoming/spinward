import fs from 'node:fs';import {fileURLToPath} from 'node:url';import * as T from 'three';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',prefix=process.env.PREFIX??'overhead-roads',tier=process.env.TIER??'desktop',time=process.env.TIME??'.9';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];for(const scene of (process.env.SCENES??'ground,axis').split(','))for(const grid of (process.env.GRIDS??'default').split(',')){
 const a=.05,ta=a+Math.PI*2/3,pos=scene==='axis'?new T.Vector3(0,0,0):new T.Vector3(Math.cos(a)*3198.2,0,Math.sin(a)*3198.2),aim=new T.Vector3(Math.cos(ta)*3200,0,Math.sin(ta)*3200),up=new T.Vector3(0,1,0);
 const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,aim,up));
 const url=base+`/?debug&stats&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=${time}&dpr=1&tier=${tier}${grid==='default'?'':'&grid='+grid}`;
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:tier==='phone'?{width:390,height:844}:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity.colonyBuildings.group.userData.asset&&window.__spinwardCity.authoredBlock.group.userData.buildings.every(b=>b.asset));await page.waitForTimeout(1200);
 const data=await page.evaluate(()=>{const c=window.__spinwardCity,road=c.roadMaterial,local=c.localRoadMaterial;return {stats:document.querySelector('.stats-overlay')?.textContent,nearRoad:{colour:road.emissive.toArray(),intensity:road.emissiveIntensity},localRoad:{colour:local.emissive.toArray(),intensity:local.emissiveIntensity},windows:c.colonyBuildings.group.userData,mode:window.__spinward.mode}});
 await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())});await page.screenshot({path:out+prefix+'-'+scene+'-'+grid+'.png'});
 if(errors.length)throw Error(JSON.stringify(errors));reports.push({scene,tier,time,grid,url,...data,errors});console.log(JSON.stringify(reports.at(-1)));fs.writeFileSync(out+prefix+'.json',JSON.stringify(reports,null,2));await page.close();
}}finally{await browser.close()}
