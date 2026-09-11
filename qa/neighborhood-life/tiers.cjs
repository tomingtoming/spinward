const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({ignoreHTTPSErrors:true}),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const tier of ['phone','quest','desktop']){
  await page.setViewportSize(tier==='phone'?{width:390,height:844}:{width:1440,height:1000});await page.goto(`https://127.0.0.1:5192/?debug&stats&visit=cafe&tier=${tier}&dpr=1`);await page.waitForFunction(()=>window.__spinward?.neighborhood?.asset);await page.waitForSelector('#splash',{state:'detached'});
  if(tier==='phone')await page.waitForFunction(()=>window.__spinward.neighborhood.phase==='seated',null,{timeout:120000});
  const report=await page.evaluate(async()=>{let last=performance.now(),d=[];for(let i=0;i<180;i++)await new Promise(r=>requestAnimationFrame(t=>{d.push(t-last);last=t;r()}));d.sort((a,b)=>a-b);return {medianMs:d[90],p95Ms:d[171],stats:document.querySelector('.stats-overlay').textContent,life:window.__spinward.neighborhood,room:window.__spinward.room,immersiveVR:await navigator.xr?.isSessionSupported('immersive-vr')}});results.push({tier,...report});
  await page.screenshot({path:__dirname+`/journey-${tier}.png`});console.log(tier,report.medianMs,report.p95Ms,report.life.phase,report.immersiveVR);
 }
 fs.writeFileSync(__dirname+'/journey-tiers.json',JSON.stringify({results,errors}));if(errors.length)throw Error(errors.join('\n'))
}finally{await browser.close()}})();
