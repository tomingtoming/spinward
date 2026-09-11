const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import {fileURLToPath} from 'node:url';
import * as T from 'three';import fs from 'node:fs';
const out=fileURLToPath(new URL('.',import.meta.url));const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});let errors=[];page.on('pageerror',e=>errors.push(e.message));
const url=(a,ax,ta,tax,h=1,t=.42)=>{const pos=new T.Vector3(Math.cos(a)*(3200-1.8),ax,Math.sin(a)*(3200-1.8)),target=new T.Vector3(Math.cos(ta)*(3200-h),tax,Math.sin(ta)*(3200-h));const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))));return `https://127.0.0.1:5192/?debug&m=g&a=${a}&ax=${ax}&q=${q.toArray().join(',')}&t=${t}`};
const clean=()=>page.evaluate(()=>{const a=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)a.push(o)});a.forEach(o=>o.removeFromParent());document.querySelector('.lil-gui')?.remove()});
const report={};
// Real user path: make coffee, carry it down the clear central aisle, sidestep to
// the left bench. Controlled keyboard increments use measured world coordinates.
await page.setViewportSize({width:1440,height:1000});await page.goto('https://127.0.0.1:5192/?debug&visit=coffee&t=.42');await page.waitForFunction(()=>window.__spinward?.room?.cafe>0);await page.keyboard.press('c');await page.waitForFunction(()=>window.__spinward.room.coffee.phase==='ready');await page.keyboard.press('c');
const holdUntil=async(key,predicate)=>{await page.keyboard.down(key);try{await page.waitForFunction(predicate,null,{timeout:12000})}finally{await page.keyboard.up(key)}};
// View faces the back counter (+axial), so S returns toward the street.
await holdUntil('s',()=>window.__spinward.axial< -300.3);
report.aisle=await page.evaluate(()=>window.__spinward);
await holdUntil('a',()=>window.__spinward.azimuth<.11950);
await page.keyboard.press('e');await page.waitForFunction(()=>window.__spinward.room.seat==='cafe--1');await clean();
report.seatDirection=await page.evaluate(()=>{const camera=window.__spinwardScene.getObjectByName('coffee-held').parent,city=window.__spinwardCity.group;
const forward=camera.getWorldDirection(camera.position.clone());const upQuat=city.getWorldQuaternion(camera.quaternion.clone());
const a=window.__spinward.room.seats[0].azimuth;const expected=camera.position.clone().set(-Math.sin(a),0,Math.cos(a)).applyQuaternion(upQuat);return forward.dot(expected)});
if(report.seatDirection<.99)throw Error('Seat does not face clear aisle: '+report.seatDirection);
await page.waitForFunction(()=>window.__spinward.neighborhood.phase==='seated',null,{timeout:120000});
await page.screenshot({path:`${out}/coffee-seated-final.png`});
await page.keyboard.press('c');await page.waitForTimeout(500);await page.screenshot({path:`${out}/coffee-sip-final.png`});await page.waitForFunction(()=>window.__spinward.room.coffee.servings===2);
for(const count of [1,0]){await page.keyboard.press('c');await page.waitForFunction(n=>window.__spinward.room.coffee.servings===n,count)}
report.drunk=await page.evaluate(()=>window.__spinward.room);await page.keyboard.press('e');await page.waitForTimeout(400);
await holdUntil('w',()=>window.__spinward.azimuth>.12265);
await holdUntil('a',()=>window.__spinward.axial> -288.5);
await page.keyboard.press('c');await page.waitForFunction(()=>window.__spinward.room.coffee.phase==='idle');
report.returned=await page.evaluate(()=>window.__spinward.room);
report.errors=errors;fs.writeFileSync(`${out}/journey-coffee-runtime.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({errors,drunk:report.drunk.coffee,returned:report.returned.coffee}));}finally{await browser.close()}
