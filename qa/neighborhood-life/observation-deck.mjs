import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'
const base=process.env.SPINWARD_URL,tier=process.env.TIER??'desktop',preset=process.env.PRESET??'izma',label=process.env.LABEL??'final',night=process.env.NIGHT==='1',fallback=process.env.FALLBACK==='1'
if(!base)throw Error('SPINWARD_URL required')
const prefix=`observation-${preset}-${tier}-${label}`,out=fileURLToPath(new URL('.',import.meta.url)),report={tier,preset,label,night,fallback,frames:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:tier==='phone'?{width:390,height:844}:{width:1440,height:900},hasTouch:tier==='phone'})
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())})
 await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 if(/SwiftShader|Software|llvmpipe/i.test(report.gpu))throw Error('Hardware GPU required')
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 if(fallback)await page.route('**/assets/observation-deck.glb',r=>r.fulfill({status:200,contentType:'model/gltf+json',body:JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0,nodes:[]})}))
 const params=`debug&metrics=off&lock=0&dpr=1&preset=${preset}&tier=${tier}&t=${night?'.02':'.42'}`
 const ready=async()=>{await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.group.getObjectByName('observation-deck')?.visible);if(!fallback)await page.waitForFunction(()=>window.__spinwardCity.group.getObjectByName('observation-deck').userData.asset==='blender');await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())}
 const capture=async name=>{
  const state=await page.evaluate(()=>{
   const c=window.__spinwardCity,g=c.group.getObjectByName('observation-deck'),w=window.__spinward
   const lod=g.children[0],visible=lod.levels.findIndex(l=>l.object.visible)
   return {asset:document.querySelector('script[src*="/assets/"]').src,deck:g.userData,lod:visible,root:g.matrix.elements,
    tower:c.cityPlan.tower,player:{azimuth:w.azimuth,axial:w.axial,height:w.groundHeight,mode:w.mode,radius:w.radius},seat:w.room.seat,sensor:w.room.sensor,body:window.__spinwardBody.group.userData}
  });await page.screenshot({path:out+`${prefix}-${name}.png`});report.frames.push({name,...state});return state
 }
 await page.goto(`${base}/?${params}`);await ready()
 await page.getByRole('button',{name:'Places',exact:true}).click()
 await page.getByRole('button',{name:'Go now to Observation deck',exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:out+`${prefix}-places.png`})
 await page.getByRole('button',{name:'Go now to Observation deck',exact:true}).click()
 await page.waitForFunction(()=>window.__spinward.groundHeight>58.4);await page.waitForTimeout(700)
 const arrival=await capture('arrive')
 if(arrival.player.mode!=='grounded'||arrival.lod!==0)throw Error('Deck arrival is not supported near LOD')
 await page.keyboard.down('w');await page.waitForTimeout(2800);await page.keyboard.up('w');await page.waitForTimeout(500)
 const rail=await capture('rail-stop')
 const axial=rail.player.axial-rail.tower.axial
 if(axial<9.5||axial>11.3||rail.player.height<58.45||rail.player.mode!=='grounded')throw Error('Guard failed to stop a normal walk '+JSON.stringify(rail.player))
 await page.keyboard.down('ArrowDown');await page.waitForTimeout(400);await page.keyboard.up('ArrowDown')
 await capture('rail-lookdown')
 // Approach the bench through the supported local deep-link pose, then use
 // the real E/touch actions. No physics or seating state is written by QA.
 const seat=await page.evaluate(()=>window.__spinward.room.seats.find(s=>s.id==='observation-bench'))
 const a=seat.azimuth,ax=seat.exit.axialPosition+.3,r=seat.radius
 const eye=new Vector3(Math.cos(a)*(r-seat.groundHeight-1.8),ax,Math.sin(a)*(r-seat.groundHeight-1.8)),target=new Vector3(Math.cos(a)*(r-seat.seatHeight-.2),seat.axialPosition,Math.sin(a)*(r-seat.seatHeight-.2))
 const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,new Vector3(-Math.cos(a),0,-Math.sin(a))))
 await page.goto(`${base}/?${params}&m=g&a=${a}&ax=${ax}&gh=${seat.groundHeight}&q=${q.toArray()}`);await ready()
 await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
 await capture('bench-approach')
 if(tier==='phone')await page.getByRole('button',{name:'Sit · Observation deck bench',exact:true}).tap();else await page.keyboard.press('e')
 await page.waitForFunction(()=>window.__spinward.room.seat==='observation-bench')
 await page.keyboard.down('ArrowDown');await page.waitForTimeout(500);await page.keyboard.up('ArrowDown')
 const seated=await capture('seated');if(!seated.sensor||seated.body.mode!=='seated')throw Error('Seating did not attach')
 if(tier==='phone')await page.getByRole('button',{name:'Stand up',exact:true}).tap();else await page.keyboard.press('e')
 await page.waitForFunction(()=>!window.__spinward.room.seat);await page.waitForTimeout(600)
 const stood=await capture('stood');if(stood.sensor||stood.player.mode!=='grounded'||Math.abs(stood.player.height-seat.groundHeight)>.015)throw Error('Seat exit lost the deck floor')
 // A real free-fall from above the floor must settle onto this deck.
 const dropA=arrival.tower.azimuth,dropAx=arrival.tower.axial+6
 const drop=new Vector3(Math.cos(dropA)*(r-63),dropAx,Math.sin(dropA)*(r-63))
 await page.goto(`${base}/?${params}&m=f&p=${drop.toArray()}`);await ready()
 await page.waitForFunction(()=>window.__spinward.mode==='grounded'&&window.__spinward.groundHeight>58.4,{},{timeout:15000})
 const landed=await capture('landed');if(Math.abs(landed.player.height-58.5)>.01)throw Error('Free-fall missed deck')
 // Views from outside use the public free-flight pose; only these static
 // LOD fixtures pause rotation. Grounded walking above retained normal spin.
 for(const [name,distance,height]of [['near',30,70],['middle',80,160],['far',150,430],['underside',24,46]]){
  const tower=arrival.tower,a=tower.azimuth,ax=tower.axial+distance
  const eye=new Vector3(Math.cos(a)*(r-height),ax,Math.sin(a)*(r-height)),target=new Vector3(Math.cos(a)*(r-45),tower.axial,Math.sin(a)*(r-45))
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,new Vector3(-Math.cos(a),0,-Math.sin(a))))
  await page.goto(`${base}/?${params}&m=f&rpm=0&p=${eye.toArray()}&q=${q.toArray()}`);await ready();await page.waitForTimeout(500)
  const s=await capture(name);if(s.lod!=={near:0,middle:1,far:2,underside:0}[name])throw Error('Unexpected deck LOD '+name+' '+s.lod)
 }
 if(report.errors.length)throw Error(report.errors.join('\n'))
 console.log(JSON.stringify({frames:report.frames.map(f=>({name:f.name,lod:f.lod,height:f.player.height,mode:f.player.mode})),errors:report.errors,gpu:report.gpu}))
}finally{await fs.writeFile(out+`${prefix}.json`,JSON.stringify(report,null,2));await browser.close()}
