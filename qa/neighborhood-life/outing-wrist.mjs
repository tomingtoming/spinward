import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const b=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],presets:[]}
try{
 const p=await b.newPage({ignoreHTTPSErrors:true});p.on('pageerror',e=>report.errors.push(e.message))
 await p.goto(base+'/?debug&lock=0&t=.42&tier=quest');await p.waitForSelector('#splash',{state:'detached'})
 const click=id=>p.evaluate(id=>{const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id);if(!b)throw Error('No target '+id);w.updateHover({x:(b.x+b.width/2)/l.width,y:1-(b.y+b.height/2)/l.height});return w.clickHovered()},id)
 const capture=async label=>{const image=await p.evaluate(()=>{const w=window.__spinwardWatch;w.update(w.snapshot,true,window.__spinwardScene,window.__spinwardScene);return w.expandedCanvas.canvas.toDataURL('image/png')});fs.writeFileSync(out+`outing-wrist-${label}.png`,Buffer.from(image.split(',')[1],'base64'))}
 for(const id of ['izma','cooper','elysium','playground']){
  await click('nav-habitat');await click('preset-apply-'+id);await p.waitForTimeout(1500);await click('nav-home');await click('nav-places');await click('nav-outing')
  const results=[]
  for(const action of ['guide-square','guide-cafe','guide-park','guide-car']){
   const before=await p.evaluate(()=>({a:window.__spinward.azimuth,ax:window.__spinward.axial})),accepted=await click(action);await p.waitForTimeout(150)
   const after=await p.evaluate(()=>window.__spinward)
   if(Math.hypot((after.azimuth-before.a)*after.radius,after.axial-before.ax)>.1)throw Error('Directions teleported the player')
   if(id==='playground' && accepted)throw Error('Small habitat retained a guide')
   if(accepted && after.outing.status==='unavailable')throw Error(`Unavailable local route ${id}/${action}`)
   results.push({action,accepted,outing:after.outing})
  }
  await capture(id)
  if(id!=='playground'){await click('guide-cancel');await p.waitForTimeout(100);if(await p.evaluate(()=>window.__spinward.outing.action!==null))throw Error('Wrist cancel failed')}
  if(await click('park-car'))throw Error('Wrist permitted parking while on foot')
  await click('drive-mode-toggle');await p.waitForTimeout(100)
  if(await p.evaluate(()=>window.__spinward.drive.mode!=='experiment'))throw Error('Wrist mode selection failed')
  await click('drive-mode-toggle');await click('nav-home')
  report.presets.push({id,results});console.log(JSON.stringify({id,routes:results.map(r=>({action:r.action,status:r.outing.status,accepted:r.accepted}))}))
 }
}finally{fs.writeFileSync(out+'outing-wrist.json',JSON.stringify(report,null,2));await b.close()}
if(report.errors.length)throw Error(report.errors.join('\n'))
