// Same-page A/B: bypass only the new per-window surface function, retaining all
// geometry, visibility and surrounding simulation. This is not a legacy-build comparison.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())});
 await page.goto((process.env.SPINWARD_URL??'https://127.0.0.1:5192')+'/?debug&stats&visit=city-block&rpm=0&t=.42&dpr=1',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity.colonyBuildings.group.userData.asset);
 const data=await page.evaluate(async()=>{
  const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';
  if(/SwiftShader|llvmpipe/i.test(renderer))throw Error('Software renderer');
  const materials=new Set();window.__spinwardScene.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.customProgramCacheKey().startsWith('colony-metric-facade-v5'))materials.add(m)});
  if(!materials.size)throw Error('Missing new window materials');
  const originals=[...materials].map(m=>({m,compile:m.onBeforeCompile,key:m.customProgramCacheKey})),runs=[];
  for(const enabled of [true,false,true,false]){
   for(const {m,compile,key} of originals){
    m.onBeforeCompile=(shader,r)=>{compile(shader,r);if(!enabled)shader.fragmentShader=shader.fragmentShader.replace('if(wall&&glass&&distant<1.)colonyWindowSurface','if(false)colonyWindowSurface')};
    m.customProgramCacheKey=()=>key()+'-qa-'+enabled;m.needsUpdate=true;
   }
   await new Promise(resolve=>setTimeout(resolve,1800));
   const samples=[];let last=performance.now(),start=last;
   await new Promise(resolve=>{const frame=now=>{samples.push(now-last);last=now;if(now-start<4000)requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)});
   samples.shift();samples.sort((a,b)=>a-b);runs.push({enabled,median:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],stats:document.querySelector('.stats-overlay')?.textContent});
  }
  for(const {m,compile,key} of originals){m.onBeforeCompile=compile;m.customProgramCacheKey=key;m.needsUpdate=true}
  return {renderer,materials:materials.size,runs};
 });
 if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({...data,errors}));
 fs.writeFileSync(new URL('colony-window-cost.json',import.meta.url),JSON.stringify({...data,errors},null,2));
}finally{await browser.close()}
