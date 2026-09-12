import {test, expect} from 'playwright-webxr'
import {Matrix4, Quaternion, Vector3} from 'three'
import fs from 'node:fs/promises'
import {colonyBalconies} from '../../src/objects/colonyBalconies.ts'
import {planBalconyLife} from '../../src/objects/balconyLife.ts'

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})

test('residential balcony furniture remains attached in both eyes through head roll', async ({page,xr},info)=>{
 const errors=[],frames=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('about:blank')
 const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r})
 expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 const visit=async pose=>{
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&m=f&rpm=0&t=.42&${pose}`)
  await page.waitForSelector('#splash',{state:'detached'})
  await page.waitForFunction(()=>!!window.__spinwardCity?.colonyBuildings.balconyAssets&&!!window.__spinwardCity.colonyBuildings.modules)
 }
 await visit('')
 const entries=await page.evaluate(()=>window.__spinwardCity.colonyBuildings.entries.filter(e=>!e.interior&&e.design.use.primary==='apartments'&&e.spec.building.height<50&&Math.abs(e.spec.building.azimuth)<.3&&Math.abs(e.spec.building.axial)<700).map(e=>({spec:e.spec,design:e.design,matrix:e.matrix.elements})))
 const candidates=entries.map(e=>{const balconies=colonyBalconies(e.spec,e.design);return {...e,style:balconies.style,life:planBalconyLife(e.spec,balconies)}}).sort((a,b)=>Math.hypot(a.spec.building.azimuth*3200,a.spec.building.axial)-Math.hypot(b.spec.building.azimuth*3200,b.spec.building.axial))
 const entry=candidates.find(e=>e.style==='rail'&&e.life.some(b=>b.props.some(p=>p.kind==='chair'&&p.y<18)))
 expect(entry).toBeTruthy()
 const chair=entry.life.flatMap(b=>b.props).find(p=>p.kind==='chair'&&p.y<18)
 const matrix=new Matrix4().fromArray(entry.matrix),at=new Vector3(chair.x,chair.y,chair.z)
 const eye=at.clone().add(new Vector3(2.5,2.1,4.2)).applyMatrix4(matrix),aim=at.clone().add(new Vector3(.5,.4,0)).applyMatrix4(matrix)
 const rotation=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,aim,new Vector3(0,1,0).transformDirection(matrix)))
 const body=eye.clone().add(new Vector3(0,-1.6,0).applyQuaternion(rotation))
 await visit(`p=${body.toArray()}&q=${rotation.toArray()}`)
 await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 const diagnostics=await xr.diagnostics()
 expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
 expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
 await expect.poll(()=>page.evaluate(()=>window.__spinwardScene.getObjectsByProperty('renderOrder',30).filter(o=>o.isMesh).every(o=>!o.visible)),{timeout:30000}).toBe(true)
 const expected=at.clone().applyMatrix4(matrix).toArray()
 const probe=()=>page.evaluate(point=>{
  const layer=window.__spinwardCity.colonyBuildings,mesh=layer.batches.get('balcony-chair-0')
  if(!mesh)throw Error('No chair batch')
  const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  for(let i=0;i<mesh.count;i++){
   const m=mesh.matrix.clone();mesh.getMatrixAt(i,m)
   if(Math.hypot(...point.map((v,j)=>v-m.elements[12+j]))>.01)continue
   const projected=camera.position.clone().set(0,.425,0).applyMatrix4(m).project(camera).toArray()
   return {matrix:m.elements,projected,stats:layer.group.userData}
  }
  throw Error('Target chair absent')
 },expected)
 const before=await probe()
 for(const degrees of [0,25,-25]){
  await xr.setHeadPose({position:[0,1.6,0],euler:[0,0,degrees*Math.PI/180]});await xr.settle(200)
  const current=await probe();expect(current.matrix).toEqual(before.matrix)
  expect(Math.abs(current.projected[0])).toBeLessThan(.85);expect(Math.abs(current.projected[1])).toBeLessThan(.85)
  expect(current.projected[2]).toBeGreaterThan(-1);expect(current.projected[2]).toBeLessThan(1)
  const path=info.outputPath(`balcony-roll-${degrees}.png`),capture=await xr.screenshot(path,{metadata:true,canvas:'canvas',timeout:5000})
  expect(capture.sessionId).toBe(diagnostics.session.id);expect([capture.width,capture.height]).toEqual([2560,960])
  await info.attach(`balcony-roll-${degrees}`,{path,contentType:'image/png'});frames.push({degrees,capture,probe:current})
 }
 const after=await xr.sessionCursor();await page.evaluate(()=>window.__xrDevice.activeSession.end())
 await xr.waitForSessionEvent('end',{after,sessionId:diagnostics.session.id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('balcony-evidence.json'),JSON.stringify({gpu,diagnostics,frames,errors},null,2))
})
