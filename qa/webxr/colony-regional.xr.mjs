import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'

if(process.env.SPINWARD_AUTHORING_ROOT&&!isAbsolute(process.env.SPINWARD_AUTHORING_ROOT))throw Error('Use an absolute SPINWARD_AUTHORING_ROOT')
const root=process.env.SPINWARD_AUTHORING_ROOT
  ? pathToFileURL(process.env.SPINWARD_AUTHORING_ROOT.replace(/\/$/,'')+'/')
  : new URL('../../',import.meta.url)
const document=JSON.parse(await fs.readFile(new URL('src/worlds/generated/izmaColonyRuntime.json',root)))
async function unpack(value){
  if(value?.$part)return JSON.parse(await fs.readFile(new URL('public'+value.$part,root)))
  if(value?.$concat)return (await Promise.all(value.$concat.map(unpack))).flat()
  return value
}
const catalog=await unpack(document.data.streaming.regions),regionURLs=new Set(catalog.map(r=>r.url))
const base='/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma'
const left={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()},right=[.22,1.38,-.2]
async function press(page,xr,id){
  const nextPage=await page.evaluate(id=>{const w=window.__spinwardWatch,buttons=w.layouts[w.screen].buttons
    return !buttons.some(b=>b.id===id)&&buttons.some(b=>b.id==='nav-places-more')},id)
  if(nextPage)await press(page,xr,'nav-places-more')
  const p=await page.evaluate(id=>{const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
    if(!b)throw Error('Missing wrist target '+id)
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    return {u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}
  },id)
  const transform=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
  const target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(transform).toArray()
  await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)})
  await xr.waitForFrames(2,{timeout:5000})
  await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
  await xr.pressButton('right','trigger')
}
const state=page=>page.evaluate(()=>window.__spinward)
const ready=page=>page.waitForFunction(()=>window.__spinward?.regional.state==='ready'&&!window.__spinward.regional.pendingArrival)
async function support(page){
  const p=await page.evaluate(()=>{
    const s=window.__spinward,positions=[]
    for(const group of window.__spinwardCity.authoredColony.group.children.filter(g=>g.name.startsWith('colony-region-')))
      for(const mesh of group.children){const v=mesh.geometry.attributes.position.array
        for(let i=0;i<v.length;i+=9){const a=Math.atan2(v[i+2],v[i])-s.azimuth
          if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a))*s.radius)<30&&Math.abs(v[i+1]-s.axial)<30)
            for(let j=0;j<9;j++)positions.push(v[i+j])}}
    return {s,positions}
  })
  const {s}=p,outward=new Vector3(Math.cos(s.azimuth),0,Math.sin(s.azimuth)),origin=outward.clone().multiplyScalar(s.radius-s.groundHeight-.3);origin.y=s.axial
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(p.positions),3))
  const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material)
  const hit=new Raycaster(origin,outward,0,1).intersectObject(mesh)[0]
  geometry.dispose();material.dispose()
  expect(hit,'actual loaded regional mesh supports the body').toBeDefined()
  const h=s.radius-Math.hypot(hit.point.x,hit.point.z)
  expect(Math.abs(h-s.groundHeight)).toBeLessThan(.18)
  expect(s.regional.entries).toBeLessThanOrEqual(32);expect(s.regional.bytes).toBeLessThanOrEqual(24*1024*1024)
  expect(s.regional.failed).toEqual([]);expect(s.mode).toBe('grounded')
  return {...s,drawnHeight:h}
}
async function aimForward(page,xr){
  const point=await page.evaluate(()=>{const s=window.__spinward,c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    const p=c.position.clone().set(Math.cos(s.azimuth)*(s.radius-s.groundHeight-1.6),s.axial+20,Math.sin(s.azimuth)*(s.radius-s.groundHeight-1.6))
    return c.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()})
  await xr.setHeadPose({position:[0,1.6,0],quaternion:new Quaternion().setFromRotationMatrix(new Matrix4()
    .lookAt(new Vector3(0,1.6,0),new Vector3(...point),new Vector3(0,1,0))).toArray()})
}

test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
test.beforeEach(async({page},info)=>{
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info')
    const name=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown';gl?.getExtension('WEBGL_lose_context')?.loseContext();return name})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await info.attach('gpu',{body:gpu,contentType:'text/plain'})
})
for(const [district,time] of [['a-old-town',.42],['b-housing',.42],['c-market',.9]])test(`regional arrival: ${district}, delayed ground, VR walk and wrist travel`,async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[],captures=[];page.on('pageerror',e=>errors.push(e.message))
  let release,blocking=true;const held=new Promise(resolve=>release=resolve)
  await page.route('**/landscapes/izma/data-*.json',async route=>{
    if(blocking&&regionURLs.has(new URL(route.request().url()).pathname))await held
    await route.continue()
  })
  try{
    await page.goto(`${base}&visit=${district}&t=${time}`)
    await page.waitForFunction(()=>window.__spinward?.regional.state==='loading')
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
    const waiting=await state(page)
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.1,.2,.1]})
    await xr.setAxes('left',0,-.7);await xr.settle(500);await xr.setAxes('left',0,0)
    const paused=await state(page)
    expect(paused.frameAngle).toBe(waiting.frameAngle);expect(paused.axial).toBe(waiting.axial)
    expect(paused.regional.pendingArrival).toBe(true)
    captures.push(await xr.screenshot(info.outputPath('waiting.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    blocking=false;release();await ready(page)
    const before=await support(page);await aimForward(page,xr)
    await xr.setAxes('left',0,-.5);await xr.settle(1000);await xr.setAxes('left',0,0)
    const after=await support(page)
    expect(Math.hypot((after.azimuth-before.azimuth)*before.radius,after.axial-before.axial)).toBeGreaterThan(.25)
    captures.push(await xr.screenshot(info.outputPath('walking.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    await xr.setControllerPose('left',left);await xr.waitForFrames(3,{timeout:5000})
    await press(page,xr,'nav-places');await press(page,xr,'visit-public');await ready(page)
    const arrived=await support(page)
    captures.push(await xr.screenshot(info.outputPath('public-place.png'),{canvas:'canvas',metadata:true,timeout:5000}))
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('report.json'),JSON.stringify({diagnostics,waiting,paused,before,after,arrived,captures,errors},null,2))
    await xr.endSession({sessionId:diagnostics.session.id,timeout:5000})
  }finally{release();await fs.writeFile(info.outputPath('errors.json'),JSON.stringify(errors))}
})
for(const fault of ['missing','corrupt'])test(`regional ${fault}: failed ground remains paused and wrist reselection recovers`,async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let broken=true
  await page.route('**/landscapes/izma/data-*.json',async route=>{
    if(broken&&regionURLs.has(new URL(route.request().url()).pathname)){
      if(fault==='missing')return route.fulfill({status:404,body:'missing'})
      const response=await route.fetch(),body=Buffer.from(await response.body());body[15]^=1
      return route.fulfill({response,body})
    }
    await route.continue()
  })
  await page.goto(`${base}&visit=a-old-town&t=.42`)
  await page.waitForFunction(()=>window.__spinward?.regional.state==='failed',null,{timeout:60000})
  const failed=await state(page);expect(failed.regional.failed.some(f=>f.attempts===3)).toBe(true)
  await page.waitForTimeout(300);expect((await state(page)).frameAngle).toBe(failed.frameAngle)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostics=await xr.diagnostics()
  await xr.setControllerPose('left',left);await xr.waitForFrames(3,{timeout:5000})
  broken=false
  await press(page,xr,'nav-places');await press(page,xr,'visit-public');await ready(page)
  const recovered=await support(page);expect(errors).toEqual([])
  await xr.screenshot(info.outputPath('recovered.png'),{canvas:'canvas',metadata:true,timeout:5000})
  await fs.writeFile(info.outputPath('report.json'),JSON.stringify({failed,recovered,errors},null,2))
  await xr.endSession({sessionId:diagnostics.session.id,timeout:5000})
})

test('regional cancellation: late Izma responses cannot move a player in Cooper',async({page,xr},info)=>{
  test.setTimeout(150000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let release,blocking=true
  const held=new Promise(resolve=>release=resolve)
  await page.route('**/landscapes/izma/data-*.json',async route=>{
    if(blocking&&regionURLs.has(new URL(route.request().url()).pathname))await held
    await route.continue()
  })
  try{
    await page.goto(`${base}&visit=c-market&t=.42`)
    await page.waitForFunction(()=>window.__spinward?.regional.state==='loading')
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics()
    await xr.setControllerPose('left',left);await xr.waitForFrames(3,{timeout:5000})
    await press(page,xr,'nav-habitat');await press(page,xr,'preset-apply-cooper')
    await ready(page);const before=await state(page)
    blocking=false;release();await xr.settle(500)
    const after=await state(page)
    expect(after.radius).toBe(before.radius);expect(after.regional.pendingArrival).toBe(false)
    expect(Math.abs(after.axial-before.axial)).toBeLessThan(.2)
    expect(await page.evaluate(()=>window.__spinwardCity.authoredColony.group.children.length)).toBe(0)
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('report.json'),JSON.stringify({before,after,errors},null,2))
    await xr.endSession({sessionId:diagnostics.session.id,timeout:5000})
  }finally{release()}
})
