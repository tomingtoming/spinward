import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'
const land=JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-land-use.json',import.meta.url),'utf8'))
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:2560,height:960}})
for(const [district,interior] of [['a-old-town',false],['b-housing',false],['c-production',false],['c-fields',false],['a-old-town',true]])test(`land use: ${district} road ${interior?'through garden interior':'to grounds'} and back`,async({page,xr},info)=>{
 test.setTimeout(interior?300000:180000)
 const z=land.zones.filter(z=>z.district===district&&z.access).sort((a,b)=>b.fixtures-a.fixtures)[0],path=[...z.access.profile],startPoint=path[0]
 const junctions=new Set([path.length-1])
 if(interior){
  // Native paths are undirected and may fork at the entrance. Visit two
  // distinct branches, retracing a dead end through its junction when needed.
  const visited=new Set(),trail=[],same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.01
  while(visited.size<2){
   const index=z.walkProfiles.findIndex((p,i)=>!visited.has(i)&&(same(p[0],path.at(-1))||same(p.at(-1),path.at(-1))))
   let branch
   if(index>=0){
    const p=z.walkProfiles[index];branch=same(p[0],path.at(-1))?p:[...p].reverse()
    visited.add(index);trail.push(branch)
   }else{
    expect(trail.length,'two connected garden branches beyond the entrance').toBeGreaterThan(0)
    branch=[...trail.pop()].reverse()
   }
   path.push(...branch.slice(1));junctions.add(path.length-1)
  }
 }
 const errors=[],samples=[],captures=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${district==='c-production'?.9:.42}&m=g&a=${startPoint[0]/3200}&ax=${startPoint[1]}&gh=${startPoint[2]}`)
 await page.waitForSelector('#splash',{state:'detached'})
 await page.waitForFunction(()=>window.__spinwardCity.authoredColony.group.userData.pending===0)
 const drawing=await page.evaluate(centre=>{
  const g=window.__spinwardCity.authoredColony.group,gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info'),positions=[]
  for(const name of ['colony-base','colony-neighbourhood-ground','colony-land-use-ground'])for(const mesh of g.getObjectByName(name).children){
   const v=mesh.geometry.attributes.position.array
   for(let i=0;i<v.length;i+=9){
    const a=Math.atan2(v[i+2],v[i]),dx=Math.atan2(Math.sin(a-centre[0]/3200),Math.cos(a-centre[0]/3200))*3200
    if(Math.abs(dx)<150&&Math.abs(v[i+1]-centre[1])<150)for(let j=0;j<9;j++)positions.push(v[i+j])
   }
  }
  return{positions,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'}
 },startPoint)
 expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
 const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(drawing.positions),3)),material=new MeshBasicMaterial({side:DoubleSide}),floor=new Mesh(geometry,material)
 const sample=async()=>{
  const s=await page.evaluate(()=>({...window.__spinward,colony:window.__spinwardCity.authoredColony.group.userData}))
  s.x=s.azimuth*3200;s.x+=Math.round((startPoint[0]-s.x)/(Math.PI*6400))*Math.PI*6400
  const out=new Vector3(Math.cos(s.azimuth),0,Math.sin(s.azimuth)),origin=out.clone().multiplyScalar(3200-s.groundHeight-.25);origin.y=s.axial
  const hit=new Raycaster(origin,out,0,1).intersectObject(floor)[0]
  expect(hit,'native visible ground supports the walking body').toBeDefined()
  const h=3200-Math.hypot(hit.point.x,hit.point.z)
  expect(Math.abs(s.groundHeight-h)).toBeLessThan(.18);expect(3200-s.radial-h).toBeGreaterThan(-.12)
  expect(s.mode).toBe('grounded');expect(s.colony.landUseZones).toBe(land.zones.length)
  expect(s.colony.loaded).toBeLessThanOrEqual(18);expect(s.colony.failed).toEqual([]);expect(s.colony.collisionCache.bytes).toBeLessThanOrEqual(4*1024*1024)
  samples.push({...s,drawnHeight:h});return s
 }
 const aim=async target=>{
  const q=await page.evaluate(([x,y,h])=>{
   const c=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0],p=c.position.clone().set(Math.cos(x/3200)*(3200-h-1.6),y,Math.sin(x/3200)*(3200-h-1.6))
   return c.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()
  },target)
  await xr.setHeadPose({position:[0,1.6,0],quaternion:new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0,1.6,0),new Vector3(...q),new Vector3(0,1,0))).toArray()})
 }
 const capture=async name=>captures.push(await xr.screenshot(info.outputPath(name+'.png'),{canvas:'canvas',metadata:true,timeout:5000}))
 const walk=async points=>{
  for(const target of points){let arrived=false
   for(let i=0;i<90;i++){
    const s=await sample(),distance=Math.hypot(s.x-target[0],s.axial-target[1]);if(distance<.35){arrived=true;break}
    await aim(target);await xr.setAxes('left',0,-Math.min(.9,Math.max(.15,distance/4)));await xr.settle(180);await xr.setAxes('left',0,0)
   }
   expect(arrived,'continuous access to '+target).toBe(true)
  }
 }
 try{
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  const diagnostic=await xr.diagnostics();expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
  await xr.setControllerPose('left',{position:[-.4,.6,-.2],quaternion:[0,0,0,1]})
  const start=await sample();await aim(path.at(-1));await capture('street-entry')
  const targets=path.filter((_,i)=>i%4===0||junctions.has(i)||i===path.length-1)
  await walk(targets.slice(1));const inside=await sample();await aim(startPoint);await capture('grounds-looking-back')
  await walk([...targets].reverse().slice(1));const returned=await sample();await capture('returned')
  expect(Math.hypot(inside.x-start.x,inside.axial-start.axial)).toBeGreaterThan(z.access.length-.8)
  await xr.endSession({sessionId:diagnostic.session.id,timeout:5000});expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('report.json'),JSON.stringify({zone:z.id,path,diagnostic,start,inside,returned,captures},null,2))
 }finally{geometry.dispose();material.dispose();await fs.writeFile(info.outputPath('samples.json'),JSON.stringify({zone:z.id,samples,errors},null,2))}
})
