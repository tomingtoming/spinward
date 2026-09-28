import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import {Matrix4,Quaternion,Vector3} from 'three'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import {findRenderedSupport} from './rendered-support.mjs'

async function boot(page,query='&place=palace'){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info'),name=e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';gl.getExtension('WEBGL_lose_context')?.loseContext();return name})
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42'+query)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.metro.roads?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded')
  await page.waitForTimeout(1200)
  return gpu
}
function errorsOn(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/TypeError|ReferenceError|Error:/.test(m.text()))errors.push(m.text())});return errors}
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus||page.isClosed())return
  await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{})
  await fs.writeFile(info.outputPath('failure.json'),JSON.stringify(await page.evaluate(()=>({state:window.__spinward,pilot:window.__roadPilot})),null,2)).catch(()=>{})
})
async function support(page){
  const probe=await page.evaluate(()=>{
    const c=window.__spinwardCity,s=window.__spinward,m=window.__spinwardMetro,meshes=[]
    c.group.updateWorldMatrix(true,true);const inverse=c.group.matrixWorld.clone().invert()
    for(const mesh of [...m.roadMeshes,...m.layers.flatMap(l=>l.base.group.children)])
      if(['bridge-decks','terrain','buildings'].includes(mesh.name)&&['structure','near'].includes(mesh.userData.level))meshes.push({p:Array.from(mesh.geometry.attributes.position.array),i:Array.from(mesh.geometry.index.array),matrix:inverse.clone().multiply(mesh.matrixWorld).elements})
    return{a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,r:s.radius,meshes}
  })
  const hit=findRenderedSupport(probe)
  expect(hit,'body must contact the rendered surface').not.toBeNull()
  expect(Math.abs(hit.drawnHeight-probe.h)).toBeLessThan(.08)
  return hit
}

test('six inter-place road routes and PC guidance preserve position',async({page},info)=>{
  const errors=errorsOn(page),gpu=await boot(page,'&place=tokyo')
  const routes=await page.evaluate(()=>{
    const roads=window.__spinwardMetro.roads,d=roads.data,results=[]
    for(const a of d.places)for(const b of d.places){
      const p=d.nodes[a.node],start={azimuth:-(d.band*Math.PI*2/3+p[0]/d.radius),axial:-p[1],groundHeight:p[2]},time=performance.now(),route=roads.route(start,b.id)
      results.push({start:a.id,end:b.id,points:route?.length,last:route?.at(-1),expected:d.nodes[b.node],time:performance.now()-time})
    }return results
  })
  for(const route of routes){expect(route.points).toBeGreaterThanOrEqual(2);expect(Math.abs(route.last.axial+route.expected[1])).toBeLessThan(.01)}
  const before=await page.evaluate(()=>window.__spinward.axial)
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.screenshot({path:info.outputPath('places-directions.png')})
  await page.getByRole('button',{name:'Directions to 水道橋駅周辺',exact:true}).click()
  await page.waitForFunction(()=>window.__spinward.outing?.status==='active')
  expect(Math.abs(await page.evaluate(()=>window.__spinward.axial)-before)).toBeLessThan(.1)
  await expect(page.getByRole('complementary',{name:'Neighbourhood directions'})).toContainText('水道橋駅周辺')
  await page.screenshot({path:info.outputPath('tokyo-guide.png')})
  await page.getByRole('button',{name:'Cancel directions',exact:true}).click()
  await page.waitForFunction(()=>window.__spinward.outing.status==='idle')
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('routes.json'),JSON.stringify({gpu,routes,errors},null,2))
})

for(const reverse of [false,true])test(`bridge continuous ${reverse?'southbound':'northbound'} walk`,async({page},info)=>{
  const errors=errorsOn(page)
  const response=await page.request.get(process.env.SPINWARD_METRO_ROADS??'/roads-v1/network.json'),data=await response.json()
  const y=reverse?16425:16675,target=reverse?16665:16435
  const start=data.nodes.reduce((a,b)=>Math.abs(b[1]-y)+Math.abs(b[0]+80)*.1<Math.abs(a[1]-y)+Math.abs(a[0]+80)*.1?b:a)
  const gpu=await boot(page,`&m=g&a=${-(data.band*Math.PI*2/3+start[0]/data.radius)}&ax=${-start[1]}&gh=${start[2]}`)
  const first=await support(page)
  await page.evaluate(({reverse,target})=>{
    const outing=window.__spinwardOuting;outing.action(reverse?'guide-metro-palace':'guide-metro-suidobashi')
    const pilot=window.__roadPilot={running:true,done:false,records:[],started:performance.now(),last:0}
    const tick=now=>{
      if(!pilot.running)return
      const s=window.__spinward,j=outing.journey
      if(now-pilot.last>200){pilot.last=now;pilot.records.push({a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,mode:s.mode,regional:s.regional.state,status:j.status,index:j.index,offRoute:j.offRoute})}
      if(reverse?-s.axial>target:-s.axial<target){pilot.done=true;pilot.running=false;return}
      if(j.status==='active')outing.face(j.bearing)
      requestAnimationFrame(tick)
    };requestAnimationFrame(tick)
  },{reverse,target})
  await page.waitForFunction(()=>window.__spinward.outing.status==='active')
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW')
  await page.waitForFunction(()=>Math.abs(-window.__spinward.axial-16548)<8,null,{timeout:60000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(500)
  const middle=await support(page)
  await page.screenshot({path:info.outputPath('bridge-middle.png')})
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW')
  await page.waitForFunction(()=>window.__roadPilot.done,null,{timeout:65000})
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(500)
  const last=await support(page),pilot=await page.evaluate(()=>window.__roadPilot)
  expect(pilot.records.every(r=>r.mode==='grounded'&&r.regional==='ready'&&r.status==='active')).toBe(true)
  expect(Math.min(...pilot.records.filter(r=>Math.abs(-r.y-16548)<10).map(r=>r.h))).toBeGreaterThan(4)
  expect(errors).toEqual([])
  await page.screenshot({path:info.outputPath('bridge-approach.png')})
  await fs.writeFile(info.outputPath('walk.json'),JSON.stringify({gpu,first,middle,last,pilot,errors},null,2))
})

test('mobile road guidance remains reachable with sixteen Places',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await boot(page)
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.getByRole('button',{name:'Directions to 東京駅周辺',exact:true}).click()
  await page.waitForFunction(()=>window.__spinward.outing.status==='active')
  const card=page.getByRole('complementary',{name:'Neighbourhood directions'}),bounds=await card.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390)
  await page.screenshot({path:info.outputPath('mobile-guide.png')})
})

test('bridge parapets stop the physical body on both sides',async({page},info)=>{
  const errors=errorsOn(page),response=await page.request.get(process.env.SPINWARD_METRO_ROADS??'/roads-v2/network.json'),d=await response.json()
  const bridge=d.edges.filter(e=>e[3]),edge=bridge[Math.floor(bridge.length/2)],a=d.nodes[edge[0]],b=d.nodes[edge[1]]
  const centre=a.map((v,i)=>(v+b[i])/2),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),side=[-dy/length,dx/length]
  const results=[]
  for(const sign of [-1,1]){
    await boot(page,`&m=g&a=${-(d.band*Math.PI*2/3+centre[0]/d.radius)}&ax=${-centre[1]}&gh=${centre[2]}`)
    await page.evaluate(({side,sign})=>window.__spinwardOuting.face(Math.atan2(-side[0]*sign,-side[1]*sign)),{side,sign})
    await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(3300)
    await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(400)
    const s=await page.evaluate(()=>window.__spinward),angle=-s.azimuth-d.band*Math.PI*2/3,x=Math.atan2(Math.sin(angle),Math.cos(angle))*d.radius,y=-s.axial
    const distance=((x-centre[0])*side[0]+(y-centre[1])*side[1])*sign
    expect(distance).toBeGreaterThan(8);expect(distance).toBeLessThan(11.4)
    expect(s.groundHeight).toBeGreaterThan(4);expect(s.mode).toBe('grounded')
    results.push({sign,distance,height:s.groundHeight,support:await support(page)})
    await page.screenshot({path:info.outputPath(`parapet-${sign}.png`)})
  }
  expect(errors).toEqual([]);await fs.writeFile(info.outputPath('parapets.json'),JSON.stringify({results,errors},null,2))
})

test.describe('road wrist directions',()=>{
  test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
  test('real VR entry, laser directions and cancellation',async({page,xr},info)=>{
    const errors=errorsOn(page),gpu=await boot(page)
    await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
    const diagnostics=await xr.diagnostics();expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
    const left={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()},right=[.22,1.38,-.2]
    await xr.setHeadPose({position:[0,1.6,0],euler:[-.25,0,0]});await xr.setControllerPose('left',left)
    await xr.setControllerPose('right',{position:right,quaternion:[0,0,0,1]});await xr.waitForFrames(4)
    async function press(id){
      const p=await page.evaluate(id=>{const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id),camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return{u:(b.x+b.width/2)/l.width,v:1-(b.y+b.height/2)/l.height,panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}},id)
      const frame=new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel)),target=new Vector3(p.u-.5,p.v-.5,0).applyMatrix4(frame).toArray()
      await xr.setControllerPose('right',{position:right,quaternion:aimQuaternion(right,target)});await xr.waitForFrames(2)
      await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id);await xr.pressButton('right','trigger')
    }
    await press('nav-places');await press('nav-outing');await press('guide-metro-suidobashi')
    await page.waitForFunction(()=>window.__spinward.outing.status==='active')
    const targets=await page.evaluate(()=>window.__spinwardWatch.layout.buttons.map(b=>b.id))
    expect(targets).toEqual(['nav-home','guide-metro-tokyo','guide-metro-palace','guide-metro-suidobashi','guide-cancel'])
    await xr.screenshot(info.outputPath('wrist-road-guide.png'),{canvas:'canvas',metadata:true})
    await press('guide-cancel');await page.waitForFunction(()=>window.__spinward.outing.status==='idle')
    await xr.endSession();expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('wrist.json'),JSON.stringify({gpu,diagnostics,targets,errors},null,2))
  })
})
