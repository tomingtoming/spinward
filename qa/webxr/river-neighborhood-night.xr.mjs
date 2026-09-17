import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('night frontages and local lighting stay attached in both eyes through head roll',async({page,xr},info)=>{
  const errors=[],captures=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|context.*lost/i.test(m.text()))errors.push(m.text())})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&visit=shops&t=.9')
  await page.waitForSelector('#splash',{state:'detached'})
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info');return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostic=await xr.diagnostics()
  expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
  expect(diagnostic.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
  // Keep the wrist out of the scenery captures. A world-space panel at the
  // fixture's default grip pose can leave the view while looking at a shop.
  await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
  await xr.setControllerPose('right',{position:[.4,.6,-.2],quaternion:[0,0,0,1]})
  const aim=await page.evaluate(()=>{
    const c=window.__spinwardCity,r=window.__spinward.radius
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    const p=camera.position.clone().set(Math.cos(-116/r)*(r-12),-38,Math.sin(-116/r)*(r-12))
    return camera.parent.worldToLocal(c.group.localToWorld(p)).toArray()
  })
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...aim),new Vector3(0,1,0)))
  const probe=()=>page.evaluate(()=>{
    const a=window.__spinwardCity.authoredLandscape,near=a.group.getObjectByName('landscape-lod-0')
    return {world:a.group.userData,mode:window.__spinward.mode,
      lights:a.group.children.filter(o=>o.isPointLight).map(o=>({position:o.position.toArray(),intensity:o.intensity})),
      windows:['window_warm','window_neutral','window_cool','office_glass'].map(name=>{
        const m=near.getObjectByName('landscape-'+name).material
        return {name,color:m.emissive.getHexString(),intensity:m.emissiveIntensity,pattern:!!m.emissiveMap}
      })}
  })
  const before=await probe()
  expect(before.mode).toBe('grounded');expect(before.world.activeLights).toBeGreaterThan(0)
  expect(before.lights.length).toBe(6)
  for(const window of before.windows){expect(window.intensity).toBeGreaterThan(0);expect(window.pattern).toBe(true)}
  for(const degrees of [0,22,-22]){
    await xr.setHeadPose({position:[0,1.6,0],quaternion:q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()})
    await xr.waitForFrames(3,{timeout:5000})
    const state=await probe()
    expect(state.mode).toBe('grounded');expect(state.world.activeLights).toBeLessThanOrEqual(6)
    for(let i=0;i<6;i++)expect(state.lights[i].position).toEqual(before.lights[i].position)
    const path=info.outputPath('market-night-roll-'+degrees+'.png')
    captures.push(await xr.screenshot(path,{canvas:'canvas',metadata:true,timeout:5000}))
  }
  const leftQ=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2))
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]})
  await xr.setControllerPose('left',{position:[-.1,1.42,-.4],quaternion:leftQ.toArray()})
  await xr.waitForFrames(3,{timeout:5000})
  const panel=await page.evaluate(()=>{
    const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id==='nav-places')
    const c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    return {u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:c.parent.matrixWorld.elements}
  })
  const frame=new Matrix4().fromArray(panel.rig).invert().multiply(new Matrix4().fromArray(panel.panel))
  const target=new Vector3(panel.u-.5,panel.v-.5,0).applyMatrix4(frame).toArray(),right=[.22,1.38,-.2]
  await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)})
  await xr.waitForFrames(2,{timeout:5000})
  await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe('nav-places')
  await xr.pressButton('right','trigger');await xr.waitForFrames(3,{timeout:5000})
  expect(await page.evaluate(()=>window.__spinwardWatch.screen)).toBe('places')
  captures.push(await xr.screenshot(info.outputPath('market-night-places.png'),{canvas:'canvas',metadata:true,timeout:5000}))
  await xr.endSession({sessionId:diagnostic.session.id,timeout:5000})
  expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('report.json'),JSON.stringify({gpu,diagnostic,before,captures,errors},null,2))
})
