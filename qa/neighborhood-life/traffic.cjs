const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');const fs=require('fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try {const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto((process.env.SPINWARD_URL || 'https://127.0.0.1:5191')+'/?debug&m=g&a=.1247253998&ax=-325.5&t=.42');await page.waitForFunction(()=>window.__spinward?.neighborhood?.asset);await page.waitForFunction(()=>window.__spinwardCity.trafficKitBacked);await page.waitForSelector('#splash',{state:'detached'});
await page.waitForFunction(()=>window.__spinward.neighborhood.phase==='waiting',null,{timeout:30000});
await page.evaluate(()=>{
 const city=window.__spinwardCity,c=window.__spinward.neighborhood.crossing;
 const route=city.trafficRoutes.find(r=>r.kind==='street'&&Math.abs(r.laneAxial-c.axial)<c.halfWidth&&r.surfaceRadius>3199);
 if(!route)throw Error('No actual cafe road traffic route');
 const along=(c.azimuth-route.laneAzimuth)*3200-route.direction*20;
 route.motion={progress:route.direction===1?along-route.spanStart:route.spanStart+route.spanLength-along,speed:7};
 });
const samples=await page.evaluate(async()=>{const out=[];for(let n=0;n<320;n++){
 const s=window.__spinward.neighborhood,c=s.crossing;const cars=window.__spinwardTraffic().filter(v=>v.height<1).map(v=>({...v,tangent:Math.atan2(Math.sin(v.azimuth-c.azimuth),Math.cos(v.azimuth-c.azimuth))*3200,across:v.axial-c.axial})).filter(v=>Math.abs(v.tangent)<40&&Math.abs(v.across)<5);
 out.push({t:performance.now(),phase:s.phase,across:s.across,cars});await new Promise(r=>setTimeout(r,100));}return out});
fs.writeFileSync(require('node:path').join(__dirname,'traffic-controlled.json'),JSON.stringify({errors,samples}));const report={samples:samples.length,phases:[...new Set(samples.map(s=>s.phase))],nearby:Math.max(...samples.map(s=>s.cars.length)),stopped:samples.filter(s=>s.cars.some(c=>c.speed<.1)).length,unsafe:samples.filter(s=>s.phase==='crossing'&&Math.abs(s.across)<.8&&s.cars.some(c=>Math.abs(c.tangent)<3)).length,errors};console.log(JSON.stringify(report));if(report.unsafe||!report.stopped)throw Error("Crosswalk stop/clearance check failed");}finally{await browser.close()}})();
