import {chromium} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
const base=process.env.SPINWARD_URL;if(!base)throw Error('SPINWARD_URL required')
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]}
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true});page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 const open=async pose=>{await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&t=.42&${pose}`);await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForTimeout(700);await page.keyboard.press('Escape');if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()}
 const state=()=>page.evaluate(()=>({a:window.__spinward.azimuth,ax:window.__spinward.axial,h:window.__spinward.groundHeight,mode:window.__spinward.mode}))
 await open('visit=nyaan')
 const fixtures=await page.evaluate(()=>{
  const c=window.__spinwardCity,p=c.curvedNeighborhood.plan,b=c.getCarShareBay(),r=3200
  const cases=p.knots.filter((k,i)=>i!==1).map((k,i)=>{const sign=i===0?1:-1;return{name:`curve-${i}`,start:{a:p.azimuth+(k.point[0]-sign*1.8)/r,ax:p.axial+k.point[1]+4},end:{a:p.azimuth+(k.point[0]+sign*4)/r,ax:p.axial+k.point[1]+4}}})
  const co=Math.cos(b.heading),s=Math.sin(b.heading),d=b.driveway-1.5,a=b.azimuth+co*b.signSide*d/r,ax=b.axial-s*b.signSide*d
  cases.push({name:'driveway-crossing',start:{a:a-s*5/r,ax:ax-co*5},end:{a:a+s*5/r,ax:ax+co*5}})
  return cases
 })
 for(const f of fixtures){
  const s=f.start,e=f.end,eye=new Vector3(Math.cos(s.a)*(3200-1.8),s.ax,Math.sin(s.a)*(3200-1.8)),target=new Vector3(Math.cos(e.a)*(3200-1.8),e.ax,Math.sin(e.a)*(3200-1.8)),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,new Vector3(-Math.cos(s.a),0,-Math.sin(s.a))))
  await open(`m=g&a=${s.a}&ax=${s.ax}&gh=0&q=${q.toArray()}`)
  const samples=[],length=Math.hypot((e.a-s.a)*3200,e.ax-s.ax),deadline=Date.now()+12000;await page.keyboard.down('w');let pass=false
  while(Date.now()<deadline){await page.waitForTimeout(100);const v=await state();samples.push(v);if(Math.hypot((v.a-s.a)*3200,v.ax-s.ax)>length-.2){pass=true;break}}
  await page.keyboard.up('w');report.cases.push({...f,pass,samples});console.log(f.name,JSON.stringify({pass,last:samples.at(-1)}))
 }
 if(report.errors.length||report.cases.some(c=>!c.pass))throw Error('Access seam failed; see access-seams.json')
}finally{await fs.writeFile(new URL('./access-seams.json',import.meta.url),JSON.stringify(report,null,2));await browser.close()}
