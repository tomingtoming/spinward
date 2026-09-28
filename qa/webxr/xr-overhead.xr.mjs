import {test,expect} from 'playwright-webxr'
import {Matrix4,Quaternion,Vector3} from 'three'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
const leftPose={position:[-.1,1.42,-.4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2)).toArray()}
const rightPosition=[.22,1.38,-.2]

async function press(page,xr,id){
 const pose=await page.evaluate(id=>{
  const w=window.__spinwardWatch,l=w.layouts[w.screen],b=l.buttons.find(b=>b.id===id)
  if(!b)throw Error('Missing button '+id)
  const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
  return{uv:[(b.x+b.width/2)/l.width,1-(b.y+b.height/2)/l.height],panel:w.interactiveObject.matrixWorld.elements,rig:camera.parent.matrixWorld.elements}
 },id)
 const target=new Vector3(pose.uv[0]-.5,pose.uv[1]-.5,0).applyMatrix4(new Matrix4().fromArray(pose.rig).invert().multiply(new Matrix4().fromArray(pose.panel))).toArray()
 await xr.setControllerPose('right',{position:rightPosition,quaternion:aimQuaternion(rightPosition,target)})
 await expect.poll(()=>page.evaluate(()=>window.__spinwardWatch.hoveredAction)).toBe(id)
 await xr.pressButton('right','trigger')
}

for(const place of ['shibuya','omiya'])test(`XR overhead ${place}`,async({page,xr},info)=>{
 test.setTimeout(180000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=.42&place=${place}`)
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})
 expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
 await page.evaluate(()=>{
  const m=window.__spinwardMetro,r=window.__spinwardRenderer,render=r.render.bind(r),update=m.update.bind(m),world=m.group.updateWorldMatrix.bind(m.group)
  const detail=m.setXRDetail.bind(m);m.setXRDetail=()=>detail(2)
  window.__qaLegacy=false;window.__qaTimes=[]
  let firstRootUpdate=false
  // Restore only MetroCity.update's original explicit traversal. Descendant
  // worldToLocal calls also visit this root; making those recursive too would
  // artificially multiply the control cost.
  m.group.updateWorldMatrix=(p,c)=>{const recurse=c||(firstRootUpdate&&window.__qaLegacy);firstRootUpdate=false;return world(p,recurse)}
  m.update=(...args)=>{const start=performance.now();firstRootUpdate=true;try{return update(...args)}finally{firstRootUpdate=false;window.__qaTimes.push(performance.now()-start)}}
  r.render=(...args)=>{window.__qaArgs=args;return render(...args)}
 })
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 expect((await xr.diagnostics()).runtime.playwrightWebxrVersion).toBe('0.3.0')
 await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]})
 await xr.setControllerPose('left',{position:[-.35,.85,2],quaternion:[0,0,0,1]})
 await xr.setControllerPose('right',{position:[.35,.85,-.3],quaternion:[0,0,0,1]})
 await xr.waitForFrames(180)
 const hiddenVersion=await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.version)
 const measures=[]
 for(const legacy of [true,false,true,false]){
  await page.evaluate(v=>{window.__qaLegacy=v;window.__qaTimes=[]},legacy)
  await xr.waitForFrames(180)
  measures.push(await page.evaluate(legacy=>{const r=window.__spinwardRenderer,a=window.__qaTimes.sort((a,b)=>a-b);return{legacy,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],calls:r.info.render.calls,triangles:r.info.render.triangles,scale:Number(r.domElement.dataset.xrScale)}},legacy))
 }
 expect(await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.version)).toBe(hiddenVersion)
 for(const view of [[-.12,0,0],[-.12,1.2,0],[.85,.7,0]]){
  await xr.setHeadPose({euler:view});await xr.waitForFrames(10)
  const pair=await page.evaluate(()=>{
   const r=window.__spinwardRenderer,m=window.__spinwardMetro,g=r.getContext(),layer=r.xr.getBaseLayer(),w=layer.framebufferWidth,h=layer.framebufferHeight
   const capture=()=>{
    const previous=g.getParameter(g.FRAMEBUFFER_BINDING),data=new Uint8Array(w*h*4)
    g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,data);g.bindFramebuffer(g.FRAMEBUFFER,previous)
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),pixels=ctx.createImageData(w,h)
    for(let y=0;y<h;y++)pixels.data.set(data.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4)
    ctx.putImageData(pixels,0,0);return{data,url:c.toDataURL()}
   }
   r.render(...window.__qaArgs);const optimized=capture()
   m.group.updateWorldMatrix(true,true);r.render(...window.__qaArgs);const control=capture()
   let changed=0,nonblack=0;for(let i=0;i<control.data.length;i+=4){if(control.data[i]!==optimized.data[i]||control.data[i+1]!==optimized.data[i+1]||control.data[i+2]!==optimized.data[i+2])changed++;if(control.data[i]+control.data[i+1]+control.data[i+2]>0)nonblack++}
   return{optimized:optimized.url,control:control.url,changed,nonblack}
  })
  expect(pair.nonblack).toBeGreaterThan(100000);expect(pair.changed).toBe(0)
  for(const name of ['optimized','control'])await fs.writeFile(info.outputPath(`city-${view[1]}-${view[0]}-${name}.png`),Buffer.from(pair[name].split(',')[1],'base64'))
 }
 // Exercise the actual wrist input. First visible render must paint the latest
 // screen, and each eye must use the same canvas revision.
 await xr.setHeadPose({euler:[-.22,0,0]});await xr.setControllerPose('left',leftPose)
 await xr.setControllerPose('right',{position:rightPosition,quaternion:[0,0,0,1]})
 await xr.waitForFrames(4)
 expect(await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.version)).toBeGreaterThan(hiddenVersion)
 await press(page,xr,'nav-places');await page.waitForFunction(()=>window.__spinwardWatch.screen==='places')
 for(const roll of [0,.436,-.436]){
  await xr.setHeadPose({euler:[-.22,0,roll]});await xr.waitForFrames(2)
  await xr.screenshot(info.outputPath(`wrist-places-${roll}.png`),{canvas:'canvas',metadata:true})
 }
 await press(page,xr,'nav-home');await page.waitForFunction(()=>window.__spinwardWatch.screen==='home')
 await press(page,xr,'nav-legend');await page.waitForFunction(()=>window.__spinwardWatch.screen==='legend')
 await xr.screenshot(info.outputPath('wrist-controls.png'),{canvas:'canvas',metadata:true})
 // Observe the actual canvas revision for each eye on a rendered frame.
 const stereo=await page.evaluate(async()=>{
  const w=window.__spinwardWatch,mesh=w.interactiveObject,paint=mesh.onBeforeRender,eyes=[]
  const r=window.__spinwardRenderer,frame=r.info.render.frame
  mesh.onBeforeRender=function(...args){paint.apply(this,args);eyes.push({frame:r.info.render.frame,version:mesh.material.map.version})}
  await new Promise(resolve=>setTimeout(resolve,180));mesh.onBeforeRender=paint
  return eyes.filter(e=>e.frame>frame)
 })
 expect(stereo.length).toBeGreaterThan(2)
 for(const frame of new Set(stereo.map(e=>e.frame))){const versions=stereo.filter(e=>e.frame===frame).map(e=>e.version);expect(versions).toHaveLength(2);expect(versions[0]).toBe(versions[1])}
 const texture=await page.evaluate(()=>window.__spinwardWatch.interactiveObject.material.map.image.toDataURL())
 await fs.writeFile(info.outputPath('wrist-controls-texture.png'),Buffer.from(texture.split(',')[1],'base64'))
 await xr.endSession();await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
 await xr.setControllerPose('left',leftPose);await xr.waitForFrames(3)
 await press(page,xr,'nav-home');await page.waitForFunction(()=>window.__spinwardWatch.screen==='home')
 await xr.endSession();expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('overhead.json'),JSON.stringify({gpu,hiddenVersion,measures,stereo,errors},null,2))
 console.log(place,JSON.stringify(measures))
})
