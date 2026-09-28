import {test,expect} from 'playwright-webxr'
import {BufferAttribute,BufferGeometry,DoubleSide,Matrix4,Mesh,MeshBasicMaterial,Quaternion,Raycaster,Vector3} from 'three'
import fs from 'node:fs/promises'
import {isAbsolute,resolve} from 'node:path'

const native=process.env.SPINWARD_NATIVE_MOTORWAY_ROOT
if(native&&!isAbsolute(native))throw Error('Use an absolute SPINWARD_NATIVE_MOTORWAY_ROOT')
const plan=native?JSON.parse(await fs.readFile(resolve(native,'izma-motorway-plan.json'))):null
const riverRoot=process.env.SPINWARD_NATIVE_RIVER_ROOT
if(riverRoot&&!isAbsolute(riverRoot))throw Error('Use an absolute SPINWARD_NATIVE_RIVER_ROOT')
const river=riverRoot?JSON.parse(await fs.readFile(resolve(riverRoot,'izma-motorway-integration.json'))).riverConnection:null
const circumference=Math.PI*6400,cases=[]
function atDistance(road,distance,lateral=0){
  const p=road.points;let along=0
  for(let i=0;i<p.length-1;i++){
    const a=p[i],b=p[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)
    if(along+length>=distance){
      const t=(distance-along)/length
      return [a[0]+dx*t-dy/length*lateral,a[1]+dy*t+dx/length*lateral,a[2]+(b[2]-a[2])*t+(Math.abs(lateral)>8?.14:0)]
    }
    along+=length
  }
  throw Error('Test waypoint outside native road')
}
if(plan){
  for(const [id,lateral,time] of [['a-port-ic',-4,.42],['b-north-ic',9.1,.42],['c-production-ic',-9.1,.9]]){
    const ic=plan.interchanges.find(i=>i.id===id),road=ic.roads[0],p=road.points
    const length=p.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0)
    const start=length-110
    cases.push({id:id+'-underpass-'+lateral,start:atDistance(road,start,lateral),
      targets:[35,70,95].map(d=>atDistance(road,start+d,lateral)),time})
  }
  const civic=plan.interchanges.find(i=>i.id==='a-civic-ic').roads.find(r=>r.id==='a-civic-ic-ramp--1-1')
  const crossing=civic.points.findIndex(p=>p[1]>=6465)
  cases.push({id:'a-civic-retained-transfer-bridge',start:civic.points[crossing].slice(0,3),
    targets:[4,8,12].map(i=>civic.points[crossing+i].slice(0,3)),time:.42})
  const forest=plan.interchanges.find(i=>i.id==='c-forest-ic'),ramp=forest.roads.find(r=>r.id==='c-forest-ic-ramp-1-1')
  const end=ramp.points.at(-1)
  const next=forest.mainline.find(p=>p[1]>=end[1]+20)
  cases.push({id:'c-forest-mainline-merge',start:ramp.points.at(-8).slice(0,3),
    targets:[ramp.points.at(-4).slice(0,3),end.slice(0,3),[end[0],next[1],next[2]]],time:.9})
  const housing=plan.interchanges.find(i=>i.id==='b-housing-ic'),road=housing.roads[0]
  const fork=housing.junctionPlateaus.find(p=>p.side===-1)
  const distance=Math.hypot(fork.position[0]-road.points[0][0],fork.position[1]-road.points[0][1])
  cases.push({id:'b-housing-footway-through-ramp-mouth',start:atDistance(road,distance-25,9.1),
    targets:[0,25].map(d=>atDistance(road,distance+d,9.1)),time:.42})
}
if(!native)test.skip('motorway candidate requires SPINWARD_NATIVE_MOTORWAY_ROOT',()=>{})
if(native&&cases.length!==6)throw Error('Six motorway scenarios are required')
if(river){
  cases.push({id:'river-bridge-connection',start:[92,-80,river.newEntry[2]],
    targets:[3,10,18].map(i=>river.points[i]),time:.42})
  const first=river.points.findIndex(p=>p[1]>=52),last=river.points.length-1
  cases.push({id:'river-arterial-junction',start:river.points[first],
    targets:[.3,.6,1].map(t=>river.points[Math.round(first+(last-first)*t)]),time:.42})
}
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
for(const example of cases)test(`motorway: ${example.id} supports continuous VR walking`,async({page,xr},info)=>{
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
      const s=window.__spinward,positions=[],firstVertexPositions=[],c=window.__spinwardCity.authoredColony
      const groups=[...c.group.children.filter(g=>g.name.startsWith('colony-region-')),
        ...window.__spinwardCity.authoredLandscape.group.children.filter(g=>g.visible&&g.name.startsWith('landscape-lod-'))]
      for(const group of groups)
        for(const mesh of group.children){
          if(!/(motorway-road|motorway-walk|interband-road|interband-walk|arterial|expressway|local|road|walk|ballast|earth)$/.test(mesh.name))continue
          const v=mesh.geometry.attributes.position.array
          for(let i=0;i<v.length;i+=9){
            const offsets=[0,3,6].map(j=>{
              const a=Math.atan2(v[i+j+2],v[i+j])-s.azimuth
              return [Math.atan2(Math.sin(a),Math.cos(a))*s.radius,v[i+j+1]-s.axial]
            })
            // Long retained road triangles may contain the player while their first vertex is distant.
            if(Math.min(...offsets.map(p=>p[0]))<=24&&Math.max(...offsets.map(p=>p[0]))>=-24
              &&Math.min(...offsets.map(p=>p[1]))<=24&&Math.max(...offsets.map(p=>p[1]))>=-24){
              for(let j=0;j<9;j++)positions.push(v[i+j])
              if(Math.abs(offsets[0][0])<24&&Math.abs(offsets[0][1])<24)
                for(let j=0;j<9;j++)firstVertexPositions.push(v[i+j])
            }
          }
        }
      return {state:{...s,colony:c.group.userData},positions,firstVertexPositions,
        lights:window.__spinwardScene.getObjectsByProperty('isPointLight',true)
          .filter(l=>l.name.startsWith('landscape-local-light-')).map(l=>l.intensity)}
    })
    const s=probe.state
    const outward=new Vector3(Math.cos(s.azimuth),0,Math.sin(s.azimuth)),origin=outward.clone().multiplyScalar(3200-s.groundHeight-.3);origin.y=s.axial
    const drawHit=positions=>{
      const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(positions),3))
      const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material)
      const hit=new Raycaster(origin,outward,0,1).intersectObject(mesh)[0]
      geometry.dispose();material.dispose();return hit
    }
    const hit=drawHit(probe.positions),firstVertexHit=drawHit(probe.firstVertexPositions)
    const height=hit?3200-Math.hypot(hit.point.x,hit.point.z):null
    const px=s.azimuth*3200,unwrapped=px+Math.round((example.start[0]-px)/circumference)*circumference
    const result={...s,x:unwrapped,drawnHeight:height,lights:probe.lights,
      drawingProbe:{triangles:probe.positions.length/9,firstVertexTriangles:probe.firstVertexPositions.length/9,
        firstVertexHeight:firstVertexHit?3200-Math.hypot(firstVertexHit.point.x,firstVertexHit.point.z):null}}
    samples.push(result)
    expect(hit,'loaded drawing supports the live body').toBeDefined()
    expect(Math.abs(height-s.groundHeight)).toBeLessThan(.18)
    expect(3200-s.radial-height).toBeGreaterThan(-.12);expect(s.mode).toBe('grounded')
    expect(s.colony.interbandRings).toBe(2);expect(s.colony.loaded).toBeLessThanOrEqual(18)
    expect(s.colony.collisionCache.entries).toBeLessThanOrEqual(128)
    expect(s.colony.collisionCache.bytes).toBeLessThanOrEqual(4*1024*1024)
    expect(s.regional.entries).toBeLessThanOrEqual(32);expect(s.regional.bytes).toBeLessThanOrEqual(24*1024*1024)
    expect(s.regional.failed).toEqual([]);expect(probe.lights.length).toBeLessThanOrEqual(6)
    if(example.time>.75)expect(probe.lights.some(intensity=>intensity>0),'native lamps illuminate the night route').toBe(true)
    return result
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
    throw Error('Continuous stick walking did not reach motorway waypoint')
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
    expect(errors).toEqual([]);expect(failures).toEqual([])
  }finally{
    await fs.writeFile(info.outputPath('report.json'),JSON.stringify({example,gpu,samples,errors,failures,diagnostic},null,2))
    if(diagnostic?.session)await xr.endSession({sessionId:diagnostic.session.id,timeout:5000})
  }
})
