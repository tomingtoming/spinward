import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {signalPose,signalViews} from '../neighborhood-life/signal-views.mjs'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('native pavement and graph crosswalks remain attached in stereo through a crossing walk',async({page,xr},info)=>{
 const report={errors:[],frames:[]};page.on('pageerror',e=>report.errors.push(e.message))
 try{
  await page.goto('about:blank');report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),d=g?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('Unknown GPU');const r=g.getParameter(d.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context')?.loseContext();return r});expect(report.gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${signalPose(signalViews[0])}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity?.getCityPlan().streetSurfaces)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove());await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  report.diagnostics=await xr.diagnostics();const id=report.diagnostics.session.id
  expect(report.diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0');expect(report.diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
  const probe=()=>page.evaluate(()=>{
   const meshes=[];window.__spinwardScene.traverse(o=>{if(o.name.startsWith('street-surface-')||o.name==='street-junction-markings')meshes.push({name:o.name,geometry:o.geometry.uuid,material:o.material.uuid,matrix:o.matrixWorld.elements,pieces:o.userData.surfaces,triangles:o.geometry.index.count/3})})
   const s=window.__spinward;return{meshes,position:{azimuth:s.azimuth,axial:s.axial,radial:s.radial,mode:s.mode}}
  })
  const target=await page.evaluate(()=>{const city=window.__spinwardCity,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],a=-7.2/3200;return camera.parent.worldToLocal(city.group.localToWorld(camera.position.clone().set(Math.cos(a)*3199.8,327,Math.sin(a)*3199.8))).toArray()})
  const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...target),new Vector3(0,1,0)))
  await xr.setControllerPose('left',{position:[-.5,.55,.1],quaternion:[0,0,0,1]});await xr.setControllerPose('right',{position:[.5,.55,.1],quaternion:[0,0,0,1]})
  let baseline
  for(const roll of [0,25,-25]){
   await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll*Math.PI/180)).toArray()});await xr.waitForFrames(2,{sessionId:id,timeout:5000})
   const state=await probe();if(!baseline)baseline=state
   expect(state.meshes).toHaveLength(7);expect(state.meshes).toEqual(baseline.meshes);expect(state.position.mode).toBe('grounded')
   const capture=await xr.screenshot(info.outputPath(`street-surfaces-roll-${roll}.png`),{canvas:'canvas',metadata:true,timeout:5000})
   expect(capture.sessionId).toBe(id);expect([capture.width,capture.height]).toEqual([2560,960]);report.frames.push({roll,state,capture})
  }
  await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()});report.before=await probe()
  report.crossing=await page.evaluate(()=>{
   const state=window.__spinward,plan=window.__spinwardCity.getCityPlan().streetMarkings,r=state.radius
   const candidates=plan.crossings(state.azimuth,state.axial,60).map(c=>{
    const points=plan.paint([c]).flatMap(p=>p.polygon.map(v=>({x:p.source.azimuth*r+v.x,y:p.source.axial+v.y})))
    return{x0:Math.min(...points.map(v=>v.x)),x1:Math.max(...points.map(v=>v.x)),y0:Math.min(...points.map(v=>v.y)),y1:Math.max(...points.map(v=>v.y))}
   }).filter(c=>state.azimuth*r>c.x0&&state.azimuth*r<c.x1&&c.y0>state.axial&&c.y1-c.y0<4)
   return candidates.sort((a,b)=>a.y0-b.y0)[0]
  })
  expect(report.crossing).toBeDefined();expect(report.before.position.axial).toBeLessThan(report.crossing.y0)
  await xr.setAxes('left',0,-.5);await xr.settle(6500);await xr.setAxes('left',0,0);report.moved=await probe()
  const a=report.before.position,b=report.moved.position
  expect(Math.hypot((b.azimuth-a.azimuth)*3200,b.axial-a.axial)).toBeGreaterThan(10);expect(b.mode).toBe('grounded')
  expect(b.axial).toBeGreaterThan(report.crossing.y1+.2)
  expect(b.azimuth*3200).toBeGreaterThan(report.crossing.x0);expect(b.azimuth*3200).toBeLessThan(report.crossing.x1)
  await xr.screenshot(info.outputPath('street-surfaces-walked.png'),{canvas:'canvas',metadata:true,timeout:5000})
  const cursor=await xr.sessionCursor();await xr.endSession({sessionId:id,timeout:5000});await xr.waitForSessionEvent('end',{after:cursor,sessionId:id,timeout:5000});expect(await xr.sessionMode()).toBeNull();expect(report.errors).toEqual([])
 }finally{await fs.writeFile(info.outputPath('street-surfaces.json'),JSON.stringify(report,null,2))}
})
