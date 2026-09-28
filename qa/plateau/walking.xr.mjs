import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'

async function ready(page,id){
  await page.goto('/');await page.waitForFunction(()=>window.__plateau?.rendered)
  const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.locator(`[data-region=${id}]`).click();await page.locator('#walk').click();await page.waitForFunction(()=>window.__plateau.detailsReady);return gpu
}
const probe=page=>page.evaluate(()=>{
  const w=window.__plateau,s=w.walk,world=w.walkWorlds.get(w.state.selected)
  // Ray against actual drawn geometry, independent of the source-height interpolation.
  const a=s.x/w.study.radius,up=w.camera.up.clone().set(-Math.sin(a),Math.cos(a),0)
  const origin=w.camera.position.clone().set((w.study.radius-s.h-10)*Math.sin(a),w.study.radius-(w.study.radius-s.h-10)*Math.cos(a),-s.y)
  return {state:s,ground:world.ground(s.x,s.y),blocked:world.blocked(s.x,s.y),region:w.state.selected,
    floorMeshes:w.visibleMeshes(w.state.selected,['terrain','roads','footways']).map(m=>({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array.slice(0,Math.min(m.geometry.drawRange.count,m.geometry.index.count)))})),origin:origin.toArray(),direction:up.negate().toArray()}
})
// Transfer only source vertices at inspection checkpoints, not every frame.
async function validate(page){
  const {Raycaster,Vector3,BufferGeometry,BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide}=await import('three')
  const p=await probe(page);expect(p.blocked).toBe(false);expect(p.state.h).toBeCloseTo(p.ground,6)
  const hits=[]
  for(const f of p.floorMeshes){const g=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(f.p),3));g.setIndex(f.i);const m=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));hits.push(...new Raycaster(new Vector3(...p.origin),new Vector3(...p.direction),0,15).intersectObject(m));g.dispose();m.material.dispose()}
  expect(hits.length).toBeGreaterThan(0);const distance=Math.min(...hits.map(h=>h.distance));expect(Math.abs(distance-10)).toBeLessThan(.04)
  delete p.floorMeshes;return p
}
for(const id of ['tokyo','tama','azumino'])test(`ground walk at ${id}: source road, eye level, sprint, and return`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await ready(page,id),before=await validate(page)
  await page.screenshot({path:info.outputPath('arrival.png')})
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft')
  await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>=12,[before.state.x,before.state.y],{timeout:20000})
  await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW');const after=await validate(page)
  await page.screenshot({path:info.outputPath('walked.png')})
  expect(after.state.rejected).toBe(0)
  await page.locator('#walk').click();expect(await page.evaluate(()=>window.__plateau.walk.active)).toBe(false)
  await page.screenshot({path:info.outputPath('returned.png')})
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('walk.json'),JSON.stringify({gpu,before,after,errors},null,2))
})

test('authored footway: raised surface, physical walk and frame timing',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await ready(page,'tokyo')
  // Choose a documented validation position, then use the same walking controls as the user.
  await page.locator('#walk').click()
  await page.evaluate(()=>{const w=window.__plateau.walkWorlds.get('tokyo'),original=w.spawn.bind(w),[a,b]=w.data.pavementRoute
    w.spawn=()=>{w.spawn=original;return{x:a[0],y:a[1],h:w.ground(...a),yaw:Math.atan2(-(b[0]-a[0]),b[1]-a[1]),pitch:0,rejected:0}}
  })
  await page.locator('#walk').click();const before=await validate(page)
  expect(await page.evaluate(()=>{const a=window.__plateau,s=a.walk,w=a.walkWorlds.get('tokyo');return w.ground(s.x,s.y)-w.terrain(s.x,s.y)})).toBeCloseTo(.20,5)
  await page.screenshot({path:info.outputPath('footway-arrival.png')})
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft')
  await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>=12,[before.state.x,before.state.y],{timeout:20000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');const after=await validate(page)
  expect(after.state.rejected).toBe(0)
  await page.screenshot({path:info.outputPath('footway-walked.png')})
  const timing=await page.evaluate(async()=>{const times=[];let last=performance.now();await new Promise(resolve=>{const step=now=>{times.push(now-last);last=now;if(times.length<240)requestAnimationFrame(step);else resolve()};requestAnimationFrame(step)})
    const sorted=times.slice(10).sort((a,b)=>a-b),r=window.__plateau.renderer.info
    return{frames:sorted.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],calls:r.render.calls,triangles:r.render.triangles,geometries:r.memory.geometries}
  })
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('footway.json'),JSON.stringify({gpu,before,after,timing,errors},null,2))
})

test.describe('immersive walking',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('actual entry, stick walking, wrist destination, and model return',async({page,xr},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await ready(page,'tokyo')
    await xr.enterVR();await xr.setHeadPose({position:[0,1.65,0],euler:[0,0,0]});await xr.waitForFrames(4)
    const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    const before=await validate(page)
    await xr.setAxes('left',0,-.85)
    await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>5,[before.state.x,before.state.y],{timeout:15000})
    await xr.setAxes('left',0,0);await xr.waitForFrames(3);const after=await validate(page)
    const captures=[await xr.screenshot(info.outputPath('ground-stereo.png'),{canvas:'canvas',metadata:true})]
    await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]});await xr.waitForFrames(4)
    for(const id of ['tama','azumino','walk']){
      const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),id)
      const origin=[.2,1.35,-.15];await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)})
      await xr.waitForFrames(4);expect(await page.evaluate(()=>window.__plateau.wrist.hover)).toBe(id)
      captures.push(await xr.screenshot(info.outputPath(`wrist-${id}.png`),{canvas:'canvas',metadata:true}))
      await xr.pressButton('right','trigger');await xr.waitForFrames(4)
      if(id!=='walk'){expect(await page.evaluate(()=>window.__plateau.state.selected)).toBe(id);await validate(page)}
      else{
        expect(await page.evaluate(()=>window.__plateau.walk.active)).toBe(false)
        captures.push(await xr.screenshot(info.outputPath('returned-model-stereo.png'),{canvas:'canvas',metadata:true}))
      }
    }
    await xr.endSession();expect(await xr.sessionMode()).toBeNull()
    expect(errors).toEqual([]);await fs.writeFile(info.outputPath('xr-walk.json'),JSON.stringify({gpu,diagnostic,before,after,captures,errors},null,2))
  })
})

test.describe('touch walking',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  test('touch arrows move and release stops; drag looks around',async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const gpu=await ready(page,'azumino')
    const before=await validate(page),cdp=await page.context().newCDPSession(page)
    const b=await page.getByRole('button',{name:'前へ',exact:true}).boundingBox();expect(b).toBeTruthy()
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:0}]})
    await page.waitForFunction(([x,y])=>Math.hypot(window.__plateau.walk.x-x,window.__plateau.walk.y-y)>.5,[before.state.x,before.state.y])
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await validate(page)
    const canvas=await page.locator('canvas').first().boundingBox()
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:canvas.x+180,y:canvas.y+150,id:0}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:canvas.x+220,y:canvas.y+175,id:0}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    const looked=await page.evaluate(()=>window.__plateau.walk);expect(Math.abs(looked.yaw-after.state.yaw)).toBeGreaterThan(.1)
    expect(Math.hypot(looked.x-after.state.x,looked.y-after.state.y)).toBeLessThan(.08)
    await page.screenshot({path:info.outputPath('mobile-walk.png')});expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('touch.json'),JSON.stringify({gpu,before,after,looked,errors},null,2))
  })
})
