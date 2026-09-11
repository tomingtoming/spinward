const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');import {fileURLToPath} from 'node:url';import fs from 'node:fs';
const out=fileURLToPath(new URL('.',import.meta.url)),browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:process.env.TIER==='phone'?{width:390,height:844}:{width:1440,height:1000}});await page.goto(`https://127.0.0.1:5192/?debug&t=.42&dpr=1&stats&tier=${process.env.TIER??'desktop'}`);await page.waitForSelector('#splash',{state:'detached'});await page.waitForTimeout(2000);
 const clean=()=>page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const a=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)a.push(o)});a.forEach(o=>o.removeFromParent())});await clean();
 const perf=await page.evaluate(async()=>{let last=performance.now(),d=[];for(let i=0;i<180;i++)await new Promise(r=>requestAnimationFrame(t=>{d.push(t-last);last=t;r()}));d.sort((a,b)=>a-b);return {median:d[90],p95:d[171],stats:document.querySelector('.stats-overlay')?.textContent}});fs.writeFileSync(out+`outdoor-${process.env.LABEL??'before'}-performance.json`,JSON.stringify(perf));console.log(perf);
 await page.screenshot({path:out+`outdoor-${process.env.LABEL??'before'}-surface.png`});
 if(process.env.TIER==='phone')await page.getByRole('button',{name:'Travel ▾',exact:true}).click();
 await page.getByRole('button',{name:'Overlook',exact:true}).click();await page.waitForTimeout(1500);await clean();await page.screenshot({path:out+`outdoor-${process.env.LABEL??'before'}-overlook.png`});
 console.log(await page.evaluate(()=>{const p=window.__spinwardCity.getCityPlan();return {patches:p.patches?.slice(0,3),trees:p.trees?.length}}));
}finally{await browser.close()}
