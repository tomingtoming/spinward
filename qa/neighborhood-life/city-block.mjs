const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');import * as T from 'three';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192';const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const reports=[];
 const url=(a,ax,height,ta,tax,th,extra='')=>{const pos=new T.Vector3(Math.cos(a)*(3200-height),ax,Math.sin(a)*(3200-height)),target=new T.Vector3(Math.cos(ta)*(3200-th),tax,Math.sin(ta)*(3200-th)),q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))));return `${base}/?debug&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=.42&dpr=1&${extra}`};
 const shot=async(name,link,asset=true)=>{await page.goto(link);await page.waitForSelector('#splash',{state:'detached'});if(asset)await page.waitForFunction(()=>window.__spinwardCity?.authoredBlock.group.userData.buildings?.every(b=>b.asset));await page.waitForTimeout(500);await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const a=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)a.push(o)});a.forEach(o=>o.removeFromParent())});reports.push({name,state:await page.evaluate(()=>window.__spinwardCity.authoredBlock.group.userData)});await page.screenshot({path:out+name+'.png'})};
 if(!process.env.BLOCK_AUTO_ONLY){await shot('block-before',url(.055,-110,110,.053,30,12,'cityBlock=0'),false);
 for(const level of [0,1,2,3])await shot('block-overview-lod'+level,url(.055,-110,110,.053,30,12,'blockLod='+level));
 await shot('block-night',url(.055,-110,110,.053,30,12,'blockLod=1').replace('t=.42','t=.9'));
 for(const [id,a,ax] of [['residential',.01939436514508575,29.4953079881247],['office',.05333934543525725,29.50890722864407],['commercial',.08761635697542874,31.129812954408237]])await shot('block-close-'+id,url(a-4/3200,3,1.8,a,ax,5,'blockLod=0'));
 }
 for(const [name,ax,alt,expected] of [['near',3,1.8,0],['street',-55,1.8,1],['block',-250,110,2],['axis',30,3200,3],['field',-39000,100,4]]){
  await shot('block-auto-'+name,url(.05333934543525725,ax,alt,.05333934543525725,30,12),name!=='field');
  const state=reports.at(-1).state.buildings.find(b=>b.id==='office');if(state.lod!==expected)throw Error(name+': expected '+expected+' got '+state.lod);
 }
 await page.route('**/assets/buildings/city-block-*.glb',route=>route.abort());
 await shot('block-fallback',url(.05333934543525725,3,1.8,.05333934543525725,30,5),false);
 if(reports.at(-1).state.buildings.some(b=>b.asset||b.lod!==3))throw Error('fallback missing');
 fs.writeFileSync(out+'city-block-runtime.json',JSON.stringify({reports,errors}));console.log(JSON.stringify({reports,errors}));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close()}
