import {test,expect} from 'playwright-webxr'
import {BufferAttribute,BufferGeometry,DoubleSide,Matrix4,Mesh,MeshBasicMaterial,Quaternion,Raycaster,Vector3} from 'three'
import fs from 'node:fs/promises'
import {isAbsolute,resolve} from 'node:path'

const native=process.env.SPINWARD_NATIVE_INTERBAND_ROOT
if(native&&!isAbsolute(native))throw Error('Use an absolute SPINWARD_NATIVE_INTERBAND_ROOT')
const plan=native?JSON.parse(await fs.readFile(resolve(native,'izma-interband-plan.json'))):null
const circumference=Math.PI*6400,cases=[]
function ringHeight(ring,x){
  const p=ring.profile; x=p[0][0]+((x-p[0][0])%circumference+circumference)%circumference
  const i=p.findIndex((b,j)=>j>0&&b[0]>=x),a=p[i-1],b=p[i],t=(x-a[0])/(b[0]-a[0])
  return a[2]+(b[2]-a[2])*t
}
if(plan){
  for(const id of ['end-minus-band-0','end-plus-band-1']){
    const gate=plan.approaches.find(g=>g.id===id),p=gate.profile,sign=Math.sign(p.at(-1)[1]-p[0][1])
    cases.push({id:id+'-entry',start:[p[0][0],p[0][1]-sign*4,gate.start[2]],targets:[p[5]],time:.42})
  }
  const gate=plan.approaches.find(g=>g.id==='end-plus-band-2'),ring=plan.rings.find(r=>r.id==='end-plus')
  cases.push({id:'end-plus-band-2-junction',start:gate.profile.at(-5),targets:[
    [gate.x,ring.axial,ringHeight(ring,gate.x)],
    [gate.x+34,ring.axial,ringHeight(ring,gate.x+34)]],time:.9})
  for(const [id,ringId,x,offset,length,time] of [
    ['a-minus-land-to-window','end-minus',3200*Math.PI/6-28,10.8,76,.42],
    ['b-plus-window','end-plus',3200*Math.PI-22,0,44,.9],
    ['c-minus-periodic-seam','end-minus',plan.rings[0].profile.at(-1)[0]-24,10.8,48,.9]
  ]){
    const r=plan.rings.find(r=>r.id===ringId),h=offset ? .14 : 0
    const distances=id==='c-minus-periodic-seam' ? [24,length] : [length]
    cases.push({id,start:[x,r.axial+offset,ringHeight(r,x)+h],
      targets:distances.map(d=>[x+d,r.axial+offset,ringHeight(r,x+d)+h]),time})
  }
}
if(!native)test.skip('interband candidate requires SPINWARD_NATIVE_INTERBAND_ROOT',()=>{})
if(native&&cases.length!==6)throw Error('Six bridge scenarios are required')
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
for(const example of cases)test(`interband: ${example.id} supports continuous VR walking`,async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[],failures=[],samples=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{
    if(!r.failure()?.errorText.includes('ERR_ABORTED'))failures.push(r.url()+': '+r.failure()?.errorText)
  })
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const [x,y,h]=example.start
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${example.time}&m=g&a=${x/3200}&ax=${y}&gh=${h}`)
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>window.__spinward?.regional.state==='ready'&&!window.__spinward.regional.pendingArrival)
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info')
    return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const sample=async()=>{
    const probe=await page.evaluate(()=>{
      const s=window.__spinward,positions=[],c=window.__spinwardCity.authoredColony
      for(const group of c.group.children.filter(g=>g.name.startsWith('colony-region-')))
        for(const mesh of group.children){
          if(!/(interband-road|interband-walk|arterial|local|walk|ballast|earth)$/.test(mesh.name))continue
          const v=mesh.geometry.attributes.position.array
          for(let i=0;i<v.length;i+=9){
            const a=Math.atan2(v[i+2],v[i])-s.azimuth
            if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a))*s.radius)<24&&Math.abs(v[i+1]-s.axial)<24)
              for(let j=0;j<9;j++)positions.push(v[i+j])
          }
        }
      return {state:{...s,colony:c.group.userData},positions,
        lights:window.__spinwardScene.getObjectsByProperty('isPointLight',true)
          .filter(l=>l.name.startsWith('landscape-local-light-')).map(l=>l.intensity)}
    })
    const s=probe.state,geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(probe.positions),3))
    const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material)
    const outward=new Vector3(Math.cos(s.azimuth),0,Math.sin(s.azimuth)),origin=outward.clone().multiplyScalar(3200-s.groundHeight-.3);origin.y=s.axial
    const hit=new Raycaster(origin,outward,0,1).intersectObject(mesh)[0]
    geometry.dispose();material.dispose()
    expect(hit,'loaded drawing supports the live body').toBeDefined()
    const height=3200-Math.hypot(hit.point.x,hit.point.z)
    expect(Math.abs(height-s.groundHeight)).toBeLessThan(.18)
    expect(3200-s.radial-height).toBeGreaterThan(-.12);expect(s.mode).toBe('grounded')
    expect(s.colony.interbandRings).toBe(2);expect(s.colony.loaded).toBeLessThanOrEqual(18)
    expect(s.colony.collisionCache.entries).toBeLessThanOrEqual(128)
    expect(s.colony.collisionCache.bytes).toBeLessThanOrEqual(4*1024*1024)
    expect(s.regional.entries).toBeLessThanOrEqual(32);expect(s.regional.bytes).toBeLessThanOrEqual(24*1024*1024)
    expect(s.regional.failed).toEqual([]);expect(probe.lights.length).toBeLessThanOrEqual(6)
    const px=s.azimuth*3200,unwrapped=px+Math.round((example.start[0]-px)/circumference)*circumference
    const result={...s,x:unwrapped,drawnHeight:height,lights:probe.lights};samples.push(result);return result
  }
  const aim=async target=>{
    const tracking=await page.evaluate(([x,y,h])=>{
      const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
      const p=camera.position.clone().set(Math.cos(x/3200)*(3200-h-1.6),y,Math.sin(x/3200)*(3200-h-1.6))
      return camera.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()
    },target)
    await xr.setHeadPose({position:[0,1.6,0],quaternion:new Quaternion().setFromRotationMatrix(new Matrix4()
      .lookAt(new Vector3(0,1.6,0),new Vector3(...tracking),new Vector3(0,1,0))).toArray()})
  }
  const walk=async target=>{
    for(let i=0;i<280;i++){
      const s=await sample(),remaining=Math.hypot(s.x-target[0],s.axial-target[1])
      if(remaining<.65){await xr.setAxes('left',0,0);return s}
      await aim(target);await xr.setAxes('left',0,-Math.min(.75,Math.max(.2,remaining/6)));await xr.settle(200);await xr.setAxes('left',0,0)
    }
    throw Error('Continuous stick walking did not reach bridge waypoint')
  }
  let diagnostic
  try{
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
    await aim(example.targets[0]);await sample()
    await xr.screenshot(info.outputPath('start.png'),{canvas:'canvas',metadata:true,timeout:5000})
    for(const [i,target] of example.targets.entries()){
      await walk(target);await xr.screenshot(info.outputPath('waypoint-'+i+'.png'),{canvas:'canvas',metadata:true,timeout:5000})
    }
    if(example.time>.8)expect(samples.some(s=>s.lights.some(i=>i>1))).toBe(true)
    expect(errors).toEqual([]);expect(failures).toEqual([])
  }finally{
    await fs.writeFile(info.outputPath('report.json'),JSON.stringify({example,gpu,samples,errors,failures,diagnostic},null,2))
    if(diagnostic?.session)await xr.endSession({sessionId:diagnostic.session.id,timeout:5000})
  }
})
