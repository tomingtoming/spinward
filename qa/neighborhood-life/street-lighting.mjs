import fs from 'node:fs';import {fileURLToPath} from 'node:url';import * as T from 'three';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',prefix=process.env.PREFIX??'street-lighting',tier=process.env.TIER??'desktop',time=process.env.TIME??'.9';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];for(const scene of (process.env.SCENES??'street,industrial').split(',')){
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:tier==='phone'?{width:390,height:844}:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});
 let url=scene==='industrial'?base+'/?debug&stats&m=f&p=3154.250903,-19591.603387,-298.019386&q=.66287702,-.53821343,-.49700831,-.15460629&t=.9&rpm=0&dpr=1':base+'/?debug&stats&visit=city-block&t=.9&rpm=0&dpr=1';
 url=url.replace('t=.9','t='+time);
 await page.goto(url+'&tier='+tier,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('#splash',{state:'detached'});
 await page.waitForFunction(()=>window.__spinwardCity.colonyBuildings.group.userData.asset);await page.waitForTimeout(1000);
 if(scene==='street'){
  const spot=await page.evaluate(()=>{
   let pools;window.__spinwardScene.traverse(o=>{if(o.isInstancedMesh&&o.geometry.type==='CircleGeometry'&&o.geometry.parameters.segments===24&&o.renderOrder===20)pools=o});
   const r=3200,positions=Array.from({length:pools.count},(_,i)=>{const m=pools.instanceMatrix.array;return {a:Math.atan2(m[i*16+14],m[i*16+12]),ax:m[i*16+13]}});
   positions.sort((a,b)=>Math.hypot((a.a-.05)*r,a.ax-100)-Math.hypot((b.a-.05)*r,b.ax-100));const p=positions[0];
   const roads=window.__spinwardCity.cityPlan.roads;const road=roads.map(road=>({road,d:Math.hypot(Math.max(0,Math.abs(Math.atan2(Math.sin(p.a-road.azimuth),Math.cos(p.a-road.azimuth)))*r-road.tangentWidth/2),Math.max(0,Math.abs(p.ax-road.axial)-road.axialLength/2))})).sort((a,b)=>a.d-b.d)[0].road;
   return {...p,avenue:road.axialLength>road.tangentWidth};
  });
  const a=spot.a-(spot.avenue?0:14/3200),ax=spot.ax-(spot.avenue?14:0),ta=spot.a+(spot.avenue?0:8/3200),tx=spot.ax+(spot.avenue?8:0);
  const pos=new T.Vector3(Math.cos(a)*3197.6,ax,Math.sin(a)*3197.6),aim=new T.Vector3(Math.cos(ta)*3198.6,tx,Math.sin(ta)*3198.6),up=new T.Vector3(-Math.cos(a),0,-Math.sin(a)),q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,aim,up));
  url=base+`/?debug&stats&m=f&p=${pos.toArray()}&q=${q.toArray()}&t=${time}&rpm=0&dpr=1`;
  await page.goto(url+'&tier='+tier,{waitUntil:'domcontentloaded'});await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity.colonyBuildings.group.userData.asset);await page.waitForTimeout(1000);
 }
 const pools=await page.evaluate(gain=>{
  const candidates=[];window.__spinwardScene.traverse(o=>{if(o.isInstancedMesh&&o.geometry.type==='CircleGeometry'&&o.geometry.parameters.segments===24&&o.renderOrder===20)candidates.push(o)});
  if(candidates.length!==1)throw Error('Ambiguous lamp pool mesh');const m=candidates[0],before=m.material.color.toArray();
  if(gain)m.material.color.multiplyScalar(gain);
  return {count:m.count,colour:before,after:m.material.color.toArray(),opacity:m.material.opacity,triangles:m.geometry.index.count/3,matrices:Array.from(m.instanceMatrix.array.slice(0,m.count*16))};
 },Number(process.env.POOL_GAIN??0));
 await page.waitForTimeout(300);
 await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())});
 await page.screenshot({path:out+prefix+'-'+scene+'.png'});
 const stats=await page.locator('.stats-overlay').textContent();if(errors.length)throw Error(JSON.stringify(errors));
 const report={scene,tier,url,pools,stats,errors};reports.push(report);console.log(JSON.stringify({...report,pools:{...pools,matrices:undefined}}));fs.writeFileSync(out+prefix+'.json',JSON.stringify(reports,null,2));await page.close();
}}finally{await browser.close()}
