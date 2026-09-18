import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

const left = { position: [-.1,1.42,-.4], quaternion: new Quaternion()
  .setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray() }
const right = [.22,1.38,-.2]
async function press(page,xr,id) {
  const p = await page.evaluate(id => {
    const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
    if (!b) throw Error('Missing wrist target '+id)
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    return {u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,
      panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}
  },id)
  const frame=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
  const target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(frame).toArray()
  await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)})
  await xr.waitForFrames(2,{timeout:5000})
  await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
  await xr.pressButton('right','trigger')
}

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('authored landscapes share stereo walking, wrist travel and a clean Playground return',async({page,xr},info)=>{
  const errors=[],failures=[],frames=[],worlds=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfailed',r=>{
    if(r.failure()?.errorText.includes('ERR_ABORTED')&&/\/landscapes\/izma\/data-[a-f0-9]+\.json$/.test(r.url()))return
    failures.push({url:r.url(),error:r.failure()?.errorText})
  })
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info')
    if(!d)throw Error('GPU unknown')
    const renderer=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return renderer
  })
  expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42')
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>!window.__spinward?.regional || (window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival))
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostics=await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
  expect(diagnostics.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
  const state=()=>page.evaluate(()=>({id:window.__spinwardCity.authoredLandscape.group.userData.world??null,
    radius:window.__spinward.radius,a:window.__spinward.azimuth,y:window.__spinward.axial,
    h:window.__spinward.groundHeight,mode:window.__spinward.mode,
    expressway:window.__spinwardCity.getCityPlan()?.expressway,
    visit:window.__spinwardCity.getInteriorVisit('landscape')}))
  const visibleSupport = async () => {
    // 'grounded' can also mean the bare hull below the authored terrain.
    // Compare the live body with the actual drawn triangles after walking.
    const probe = await page.evaluate(() => {
      const s=window.__spinward,l=window.__spinwardCity.authoredLandscape.group.getObjectByName('landscape-lod-0')
      return { radius:s.radius,a:s.azimuth,y:s.axial,radial:s.radial,h:s.groundHeight,
        positions:l.children.filter(m=>/landscape-(earth|road|walk)$/.test(m.name)).flatMap(m=>Array.from(m.geometry.attributes.position.array)) }
    })
    const outward=new Vector3(Math.cos(probe.a),0,Math.sin(probe.a))
    const origin=outward.clone().multiplyScalar(probe.radius-100);origin.y=probe.y
    const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(probe.positions),3))
    const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material)
    const hit=new Raycaster(origin,outward,0,101).intersectObject(mesh)[0]
    geometry.dispose();material.dispose()
    expect(hit,'drawn ground must exist below the walker').toBeDefined()
    const drawnHeight=probe.radius-Math.hypot(hit.point.x,hit.point.z)
    const clearance=probe.radius-probe.radial-drawnHeight
    expect(clearance,'physics body must stay above the visible ground').toBeGreaterThan(-.12)
    expect(Math.abs(probe.h-drawnHeight),'ground sampler must track the visible floor').toBeLessThan(.25)
    return {drawnHeight,clearance,groundHeight:probe.h}
  }
  for (const id of ['izma','cooper','elysium','playground','izma']) {
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]})
    await xr.setControllerPose('left',left);await xr.waitForFrames(3,{timeout:5000})
    await press(page,xr,'nav-habitat');await press(page,xr,`preset-apply-${id}`);await page.waitForFunction(()=>!window.__spinward?.regional || (window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival))
    await xr.waitForFrames(3,{timeout:5000});await press(page,xr,'nav-home')
    const arrived=await state()
    expect(arrived.mode).toBe('grounded')
    if(id!=='izma') expect(await page.evaluate(()=>window.__spinwardCity.authoredColony.group.children.length)).toBe(0)
    if(id==='playground') {
      expect(arrived.id).toBeNull();expect(arrived.visit).toBeNull();expect(arrived.radius).toBe(18)
      expect(await page.evaluate(()=>window.__spinwardCity.authoredLandscape.group.children.length)).toBe(0)
      frames.push(await xr.screenshot(info.outputPath('playground.png'),{canvas:'canvas',metadata:true,timeout:5000}))
      worlds.push({id,arrived});continue
    }
    expect(arrived.id).toBe(id);expect(arrived.expressway).toBeNull()
    await press(page,xr,'nav-places')
    frames.push(await xr.screenshot(info.outputPath(`${id}-${worlds.length}-places.png`),{canvas:'canvas',metadata:true,timeout:5000}))
    await press(page,xr,'visit-landscape');await page.waitForFunction(()=>!window.__spinward?.regional || (window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival))
    await xr.waitForFrames(3,{timeout:5000})
    const before=await state(),tracking=await page.evaluate(()=>{
      const c=window.__spinwardCity,a=c.authoredLandscape,data=a.data,r=window.__spinward.radius
      const [x,y,h]=data.lookAt,camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
      const point=camera.position.clone().set(Math.cos(x/r)*(r-h),y,Math.sin(x/r)*(r-h))
      return camera.parent.worldToLocal(c.group.localToWorld(point)).toArray()
    })
    const head=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
    await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
    await xr.setHeadPose({position:[0,1.6,0],quaternion:head.toArray()})
    await xr.setAxes('left',0,-.55);await xr.settle(2200);await xr.setAxes('left',0,0)
    const after=await state(),distance=Math.hypot((after.a-before.a)*before.radius,after.y-before.y)
    expect(distance).toBeGreaterThan(1);expect(after.mode).toBe('grounded')
    const support=await visibleSupport()
    const matrix=await page.evaluate(()=>window.__spinwardCity.authoredLandscape.group.matrix.elements)
    for(const degrees of [0,25]) {
      await xr.setHeadPose({position:[0,1.6,0],quaternion:head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180)).toArray()})
      await xr.waitForFrames(2,{sessionId:diagnostics.session.id,timeout:5000})
      expect(await page.evaluate(()=>window.__spinwardCity.authoredLandscape.group.matrix.elements)).toEqual(matrix)
      const capture=await xr.screenshot(info.outputPath(`${id}-${worlds.length}-roll-${degrees}.png`),{canvas:'canvas',metadata:true,timeout:5000})
      expect(capture.sessionId).toBe(diagnostics.session.id);frames.push(capture)
    }
    worlds.push({id,arrived,before,after,distance,support})
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]});await xr.setControllerPose('left',left)
    await xr.waitForFrames(3,{timeout:5000})
    // Go now returns the watch to Home in the app.
    if(await page.evaluate(()=>window.__spinwardWatch.screen!=='home'))await press(page,xr,'nav-home')
  }
  const cursor=await xr.sessionCursor()
  await xr.endSession({sessionId:diagnostics.session.id,timeout:5000})
  await xr.waitForSessionEvent('end',{after:cursor,sessionId:diagnostics.session.id,timeout:5000})
  expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([]);expect(failures).toEqual([])
  await fs.writeFile(info.outputPath('landscapes.json'),JSON.stringify({gpu,diagnostics,worlds,frames,errors,failures},null,2))
})
