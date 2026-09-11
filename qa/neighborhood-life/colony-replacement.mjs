import {probeForecourts} from './forecourt-probe.mjs';
import {probeBalconies} from './balcony-probe.mjs';
import {probeStairs} from './stair-probe.mjs';
import {probeRoofs} from './roof-probe.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import * as T from 'three';
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];
for(const scene of (process.env.SCENES??'overview,street,old-town,industrial,house,phone,night,fallback').split(',')){
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:scene==='phone'?{width:390,height:844}:{width:1440,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});page.on('request',r=>{if(r.url().endsWith('.glb'))requests.push(r.url())});
 if(scene==='fallback')await page.route('**/colony-modules.glb',route=>route.abort());
 let url=base+'/?debug&stats&visit=city-block&t=.42&rpm=0&dpr=1'+(scene==='phone'?'&tier=phone':'');
 if(scene!=='street'&&scene!=='phone'&&scene!=='fallback'){
  // Obtain the live plan before choosing an actual representative lot.
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached'});
  const b=await page.evaluate(scene=>window.__spinwardCity.cityPlanBuildings.find(b=>scene==='old-town'?(b.oldTown??0)>.65:scene==='industrial'?b.industrial:scene==='house'?b.kind==='house':Math.abs(b.azimuth-.07)<.03&&Math.abs(b.axial)<200),scene);
  if(!b)throw Error('Missing representative '+scene);
  const side=b.front.side,a=(scene==='overview'||scene==='night')?.07:b.azimuth+(b.front.axis==='tangent'?side*(b.width/2+9)/3200:0),ax=(scene==='overview'||scene==='night')?100:b.axial+(b.front.axis==='axial'?side*(b.depth/2+9):0),alt=(scene==='overview'||scene==='night')?400:2.8;
  const pos=new T.Vector3(Math.cos(a)*(3200-alt),ax,Math.sin(a)*(3200-alt)),target=(scene==='overview'||scene==='night')?new T.Vector3(Math.cos(a)*3200,ax,Math.sin(a)*3200):new T.Vector3(Math.cos(b.azimuth)*(3200-5),b.axial,Math.sin(b.azimuth)*(3200-5));
  const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,target,(scene==='overview'||scene==='night')?new T.Vector3(0,1,0):new T.Vector3(-Math.cos(a),0,-Math.sin(a))));
  url=base+`/?debug&stats&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=.42&dpr=1`;
 }
 if(scene==='night')url=url.replace('t=.42','t=.9');
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(fallback=>{const d=window.__spinwardCity.colonyBuildings.group.userData;return fallback?d.buildings>0:d.asset},scene==='fallback');await page.waitForFunction(()=>window.__spinwardCity.authoredBlock.group.userData.buildings?.every(b=>b.asset));await page.waitForTimeout(1200);
 const data=await page.evaluate(async()=>{const c=window.__spinwardCity,frames=[];let start=performance.now(),last=start;await new Promise(resolve=>{const frame=now=>{frames.push(now-last);last=now;if(now-start<3000)requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)});frames.shift();frames.sort((a,b)=>a-b);const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),ext=gl?.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',plan:c.cityPlanBuildings.length,pilot:c.authoredBlock.group.userData.buildings.length,colony:c.colonyBuildings.group.userData,legacyNear:c.archetypeBatches.reduce((n,m)=>n+m.count,0)+c.detailedBuildingBatches.reduce((n,m)=>n+m.count,0),legacyFar:c.farBuildings?.count??0,p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),stats:document.querySelector('.stats-overlay')?.textContent}});
 if(/SwiftShader|llvmpipe/i.test(data.renderer))throw Error('Software renderer cannot be used for performance comparison: '+data.renderer);
 if(data.pilot+data.colony.buildings!==data.plan||data.legacyNear||data.legacyFar||requests.some(u=>u.includes('spinward-buildings.glb'))||errors.length)throw Error(JSON.stringify({scene,data,requests,errors}));
 data.forecourts=await page.evaluate(probeForecourts);
 data.balconyAlignment=await page.evaluate(probeBalconies);
 data.stairAlignment=await page.evaluate(probeStairs);
 data.roofAlignment=await page.evaluate(probeRoofs);
 await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())});await page.screenshot({path:out+'colony-replacement-'+scene+'.png'});if(scene==='street'){data.structuralUpdates=await page.evaluate(()=>{const c=window.__spinwardCity.colonyBuildings,times=[],writes=[];for(let i=0;i<8;i++){const t=performance.now();c.update(.05,100+i*16,1.8);times.push(performance.now()-t);writes.push(c.group.userData.structuralWrites)}
const membership=c.entries.map(e=>e.visible);c.clearBatches();c.invalidate();c.update(.05,212,1.8);
const reloadPreserved=c.entries.every((e,i)=>e.visible===membership[i]);if(!reloadPreserved)throw Error('Asset rebuild changed visibility hysteresis');
const seen=new Map(),errors=[];let active=0;
for(const e of c.entries)for(const part of e.parts){
 const slot=part.slot.index;if((slot>=0)!==e.visible)errors.push('visibility');if(slot<0)continue;
 active++;const batch=c.structures.get(part.kind),mesh=batch.mesh,v=part.volume,m=e.matrix.elements,a=mesh.instanceMatrix.array;
 const ids=seen.get(part.kind)??new Set();if(ids.has(slot))errors.push('duplicate');ids.add(slot);seen.set(part.kind,ids);
 for(let row=0;row<3;row++)if(Math.abs(a[slot*16+12+row]-(m[row]*v.x+m[4+row]*v.y+m[8+row]*v.z+m[12+row]))>.002)errors.push('position');
 if(Math.abs(mesh.instanceColor.getX(slot)-e.color.r)>1e-5)errors.push('colour');
 if(Math.abs(mesh.geometry.getAttribute('aColonyFacade').getX(slot)-e.design.profile.bay)>1e-5)errors.push('facade');
 const windows=mesh.geometry.getAttribute('aColonyWindows'),expected=e.design.windows;
 if(!windows)errors.push('missing window identity');else for(const [component,value] of [expected.kind,expected.tint,expected.occupied,Math.round((v.y-v.h/2+part.ground)/e.design.profile.storey)].entries())if(Math.abs(windows.array[slot*4+component]-value)>1e-5)errors.push('window identity');
}
if(active!==c.group.userData.structuralInstances)errors.push('count');
if(errors.length)throw Error('Structural churn validation: '+JSON.stringify(errors.slice(0,10)));
return {times,writes,active,reloadPreserved,errors}})}reports.push({scene,...data,errors});console.log(JSON.stringify(reports.at(-1)));fs.writeFileSync(out+'colony-replacement'+(process.env.SCENES?'-'+process.env.SCENES.replaceAll(',','-'):'')+'.json',JSON.stringify(reports,null,2));await page.close();
}fs.writeFileSync(out+'colony-replacement'+(process.env.SCENES?'-'+process.env.SCENES.replaceAll(',','-'):'')+'.json',JSON.stringify(reports,null,2));}finally{await browser.close()}
