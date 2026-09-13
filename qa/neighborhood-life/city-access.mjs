import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const base=process.env.SPINWARD_URL;if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL('.',import.meta.url)),contract=JSON.parse(await fs.readFile(new URL('../../assets/blender/nyaan-apartment.json',import.meta.url),'utf8'))
const report={samples:[],views:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&t=.42&visit=nyaan`)
 await page.waitForSelector('#splash',{state:'detached',timeout:60000});await page.waitForTimeout(1800)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.keyboard.press('Escape')
 const state=()=>page.evaluate(({a,ax})=>{const w=window.__spinward,c=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],v=camera.position.clone();camera.getWorldDirection(v).transformDirection(c.group.matrixWorld.clone().invert());return {x:Math.atan2(Math.sin(w.azimuth-a),Math.cos(w.azimuth-a))*w.radius,z:ax-w.axial,h:w.groundHeight,mode:w.mode,heading:Math.atan2(-Math.sin(w.azimuth)*v.x+Math.cos(w.azimuth)*v.z,v.y),parking:w.parking,balconyColliders:c.colonyBuildings.group.userData.balconyColliders}},{a:contract.interior.building.azimuth,ax:contract.interior.building.axial})
 const shot=async name=>{await page.screenshot({path:out+`city-access-${name}.png`});const s=await state();report.views.push({name,...s});console.log(name,JSON.stringify(s))}
 await shot('entry')
 const route=contract.stairs.route.slice(1)
 const walk=async(points,label)=>{
  for(const [i,[x,h,z]]of points.entries()){
   const deadline=Date.now()+25000;let done=false
   while(Date.now()<deadline){
    const s=await state();report.samples.push({label,i,...s});const dx=x-s.x,dz=z-s.z,d=Math.hypot(dx,dz)
    if(s.mode!=='grounded')throw Error('Lost floor '+JSON.stringify(s))
    if(d<.17){done=true;break}
    const delta=Math.atan2(Math.sin(Math.atan2(dx,-dz)-s.heading),Math.cos(Math.atan2(dx,-dz)-s.heading))
    if(Math.abs(delta)>.055){await page.keyboard.up('w');const k=delta>0?'ArrowRight':'ArrowLeft';await page.keyboard.down(k);await page.waitForTimeout(Math.min(160,Math.max(15,Math.abs(delta)/1.4*800)));await page.keyboard.up(k)}else{await page.keyboard.down('w');await page.waitForTimeout(Math.min(90,Math.max(25,d/3*400)))}
   }
   await page.keyboard.up('w');if(!done)throw Error('Walk stalled '+label+' '+i+' '+JSON.stringify(await state()))
   if([1,4,7].includes(i))await shot(`${label}-${i}`)
  }
 }
 await walk(route,'upstairs');report.arrival=await state();if(report.arrival.h<3.4)throw Error('Room remains at ground level');await shot('room')
 await walk([...contract.stairs.route].reverse().slice(1),'downstairs');report.exit=await state();if(report.exit.h>.4)throw Error('Did not return to street');await shot('returned')
 if(report.errors.length)throw Error(report.errors.join('\n'))
}finally{await fs.writeFile(out+'city-access.json',JSON.stringify(report,null,2));await browser.close()}
