import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'player-body', tier = process.env.TIER ?? 'desktop', time = process.env.TIME ?? '.42'
const sprint = process.env.SPRINT === '1'
const a = Number(process.env.AZIMUTH ?? 0), ax = -200, height = tier === 'phone' ? 1.6 : 1.8
const pos = new T.Vector3(Math.cos(a) * (3200-height), ax, Math.sin(a) * (3200-height))
const aim = new T.Vector3(Math.cos(a) * 3199.78, ax+.65, Math.sin(a) * 3199.78)
const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos, aim, new T.Vector3(-Math.cos(a),0,-Math.sin(a))))
const url = base + `/?debug&stats&m=g&a=${a}&ax=${ax}&q=${q.toArray()}&t=${time}&dpr=1&tier=${tier}`
const browser = await chromium.launch({channel:'chrome',headless:true})
try {
 const page = await browser.newPage({ignoreHTTPSErrors:true,viewport:tier==='phone'?{width:390,height:844}:{width:1280,height:1000}})
 const errors=[], samples=[]
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text())})
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000})
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
 await page.waitForTimeout(1000)
 await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())})
 async function capture(name){
  samples.push(await page.evaluate(name=>{
   const b=window.__spinwardBody, s=window.__spinward
   const shoes=['left','right'].map(side=>{const shoe=b.root.getObjectByName(side+'_shoe'),p=shoe.getWorldPosition(shoe.position.clone());return {side,position:p.toArray(),local:shoe.position.toArray()}})
   return {name,body:b.group.userData,visible:b.group.visible,mode:s.mode,azimuth:s.azimuth,axial:s.axial,radial:s.radial,audio:s.room.audio,shoes,stats:document.querySelector('.stats-overlay')?.textContent}
  },name))
  await page.screenshot({path:out+prefix+'-'+name+'.png'})
 }
 await capture('standing')
 if(sprint)await page.keyboard.down('Shift')
 await page.keyboard.down('w')
 try{for(let i=0;i<3;i++){await page.waitForTimeout(200);await capture('walk-'+i)}}finally{await page.keyboard.up('w');if(sprint)await page.keyboard.up('Shift')}
 await page.waitForTimeout(1700);await capture('stopped')
 await page.keyboard.down('ArrowLeft');await page.waitForTimeout(1300);await page.keyboard.up('ArrowLeft')
 await page.waitForTimeout(1700);await capture('turned')
 const standing=samples[0], stopped=samples.find(s=>s.name==='stopped'), turned=samples.at(-1)
 if(samples.some(s=>!s.visible||s.mode!=='grounded'||!s.shoes.every(p=>p.position.every(Number.isFinite))))throw Error('Body missing or non-finite');
 if(stopped.body.steps<=standing.body.steps||!stopped.body.feet.every(f=>f.planted))throw Error('Walking did not land and settle');
 if(turned.body.steps<=stopped.body.steps||!turned.body.feet.every(f=>f.planted))throw Error('Large head turn did not step and settle');
 if(errors.length)throw Error(JSON.stringify(errors))
 console.log(JSON.stringify({url,tier,time,errors,samples}))
 fs.writeFileSync(out+prefix+'.json',JSON.stringify({url,tier,time,errors,samples},null,2))
} finally { await browser.close() }
