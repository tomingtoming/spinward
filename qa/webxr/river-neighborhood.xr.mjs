import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test('walk continuously from bridge through market to the hillside and enter a shop',async({page,xr},info)=>{
  test.setTimeout(240000)
  const errors=[],failures=[],samples=[],captures=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('requestfailed',r=>failures.push(r.url()+': '+r.failure()?.errorText))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42')
  await page.waitForSelector('#splash',{state:'detached'})
  const initial=await page.evaluate(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info')
    const a=window.__spinwardCity.authoredLandscape
    return {gpu:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown',walks:a.data.walks,
      // Floor surfaces only: roofs and awnings must not mask a lower floor.
      positions:a.group.getObjectByName('landscape-lod-0').children
        .filter(m=>/landscape-(earth|walk|road)$/.test(m.name)).flatMap(m=>Array.from(m.geometry.attributes.position.array))}
  })
  expect(initial.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(initial.positions),3))
  const material=new MeshBasicMaterial({side:DoubleSide}),floorMesh=new Mesh(geometry,material)
  const sample=()=>page.evaluate(()=>{
    const s=window.__spinward;return {x:s.azimuth*s.radius,y:s.axial,h:s.groundHeight,radial:s.radial,mode:s.mode,radius:s.radius}
  })
  const validate=state=>{
    const a=state.x/state.radius,out=new Vector3(Math.cos(a),0,Math.sin(a))
    const origin=out.clone().multiplyScalar(state.radius-80);origin.y=state.y
    const hit=new Raycaster(origin,out,0,81).intersectObject(floorMesh)[0]
    expect(hit,'drawn terrain/pavement exists at every sample').toBeDefined()
    const drawnHeight=state.radius-Math.hypot(hit.point.x,hit.point.z)
    expect(state.radius-state.radial-drawnHeight,'live body stays above the drawing').toBeGreaterThan(-.12)
    expect(state.mode).toBe('grounded')
    return {...state,drawnHeight}
  }
  const aim=async point=>{
    const tracking=await page.evaluate(([x,y,h])=>{
      const c=window.__spinwardCity,r=window.__spinward.radius
      const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
      const p=camera.position.clone().set(Math.cos(x/r)*(r-h-1.6),y,Math.sin(x/r)*(r-h-1.6))
      return camera.parent.worldToLocal(c.group.localToWorld(p)).toArray()
    },point)
    const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0)))
    await xr.setHeadPose({position:[0,1.6,0],quaternion:q.toArray()})
  }
  const capture=async name=>captures.push(await xr.screenshot(info.outputPath(name+'.png'),{canvas:'canvas',metadata:true,timeout:5000}))
  const walk=async(name,points)=>{
    let previous=await sample(),travel=0,still=0
    for(let segment=0;segment<points.length;segment++){
      const target=points[segment]
      for(let step=0;step<850;step++){
        const state=await sample(),distance=Math.hypot(target[0]-state.x,target[1]-state.y)
        samples.push({route:name,segment,...validate(state)})
        const moved=Math.hypot(state.x-previous.x,state.y-previous.y);travel+=moved;previous=state
        if(distance<.8)break
        still=moved<.015?still+1:0
        expect(still,`stuck at ${name} segment ${segment}: ${JSON.stringify(state)}`).toBeLessThan(35)
        expect(step,`did not reach ${name} segment ${segment}`).toBeLessThan(849)
        await aim(target)
        await xr.setAxes('left',0,-Math.min(.8,Math.max(.18,distance/5)))
        await xr.settle(180)
      }
      if(name==='bridge-to-homes'&&[1,3,5,8,points.length-1].includes(segment))await capture(name+'-'+segment)
    }
    await xr.setAxes('left',0,0);await xr.settle(300)
    const end=validate(await sample());samples.push({route:name,end:true,...end})
    expect(Math.hypot(end.x-points.at(-1)[0],end.y-points.at(-1)[1])).toBeLessThan(1.2)
    await capture(name+'-end')
    return {name,travel,end}
  }
  try{
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostic=await xr.diagnostics()
    expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostic.rendering.views.map(v=>v.viewport.width)).toEqual([1280,1280])
    await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
    await xr.setControllerPose('right',{position:[.4,.6,-.2],quaternion:[0,0,0,1]})
    const route=await walk('bridge-to-homes',initial.walks['bridge-to-homes'])
    expect(route.travel).toBeGreaterThan(350)
    // Return through the real wrist Places button before entering the shop.
    const leftQ=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2))
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.22,0,0]})
    await xr.setControllerPose('left',{position:[-.1,1.42,-.4],quaternion:leftQ.toArray()})
    await xr.waitForFrames(3,{timeout:5000})
    for(const id of ['nav-places','visit-shops']){
      const p=await page.evaluate(id=>{
        const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
        const c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
        return {u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:c.parent.matrixWorld.elements}
      },id)
      const frame=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
      const target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(frame).toArray(),right=[.22,1.38,-.2]
      await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)})
      await xr.waitForFrames(2,{timeout:5000})
      await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
      await xr.pressButton('right','trigger');await xr.waitForFrames(3,{timeout:5000})
    }
    await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
    const shop=await walk('bakery-entry',initial.walks['bakery-entry'])
    expect(shop.travel).toBeGreaterThan(20)
    await xr.endSession({sessionId:diagnostic.session.id,timeout:5000})
    expect(await xr.sessionMode()).toBeNull();expect(errors).toEqual([]);expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'),JSON.stringify({gpu:initial.gpu,diagnostic,route,shop,samples,captures,errors,failures},null,2))
  }finally{
    geometry.dispose();material.dispose()
    await fs.writeFile(info.outputPath('samples.json'),JSON.stringify({samples,errors,failures},null,2))
  }
})
