const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import * as T from 'three';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192';
const url=(a,ax,ta,tax,h=1,t=.42)=>{const pos=new T.Vector3(Math.cos(a)*3198.2,ax,Math.sin(a)*3198.2),target=new T.Vector3(Math.cos(ta)*(3200-h),tax,Math.sin(ta)*(3200-h));const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))));return `${base}/?debug&m=g&a=${a}&ax=${ax}&q=${q.toArray()}&t=${t}`};
const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url(.1222254,-296,.1222254,-316,1));await page.waitForFunction(()=>window.__spinward?.neighborhood?.asset);await page.waitForSelector('#splash',{state:'detached'});
 await page.evaluate(()=>{const nodes=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)nodes.push(o)});nodes.forEach(o=>o.removeFromParent());document.querySelector('.lil-gui')?.remove()});
 const seen=new Set(),samples=[];
 for(let n=0;n<1150;n++){
  const s=await page.evaluate(()=>({life:window.__spinward.neighborhood,turn:window.__spinwardCity.turnMotion,cars:window.__spinwardTraffic().filter(v=>v.height<1)}));samples.push(s);
  const key=s.life.phase+(s.life.returning?'-return':'');if(!seen.has(key)){seen.add(key);await page.screenshot({path:out+'journey-'+key+'.png'});console.log(key,JSON.stringify(s.life.position))}
  if(s.life.phase==='seated'&&!seen.has('sip')){await page.waitForTimeout(1200);await page.screenshot({path:out+'journey-sip.png'});seen.add('sip')}
  if(s.life.returning&&s.life.phase==='rest')break;
  await page.waitForTimeout(100);
 }
 fs.writeFileSync(out+'journey-runtime.json',JSON.stringify({errors,samples}));console.log(JSON.stringify({phases:[...seen],errors,last:samples.at(-1)?.life}));
}finally{await browser.close()}
