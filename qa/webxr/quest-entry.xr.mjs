import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

// This observes the app's real entry on a hardware GPU. IWER does not emulate
// Quest's native compositor, memory limit, or XRProjectionLayer allocation.
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
test('Quest entry keeps a bounded framebuffer and survives exit/re-entry',async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),name=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return name})
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&t=.42')
  await page.waitForFunction(()=>window.__spinward?.metro?.operational&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
  const probe=()=>page.evaluate(()=>{
    const r=window.__spinwardRenderer,scene=window.__spinwardScene,arrays=new Set(),geometries=new Set(),textures=new Set()
    let geometryBytes=0,textureBytes=0
    const add=a=>{if(a&&!arrays.has(a)){arrays.add(a);geometryBytes+=a.byteLength}}
    scene.traverse(o=>{
      if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);add(o.geometry.index?.array);for(const a of Object.values(o.geometry.attributes))add(a.array??a.data?.array)}
      for(const m of [o.material].flat().filter(Boolean))for(const v of [...Object.values(m),...Object.values(m.uniforms??{}).map(u=>u.value)])if(v?.isTexture&&!textures.has(v)){textures.add(v);const i=v.image;textureBytes+=(i?.width??0)*(i?.height??0)*4*(v.generateMipmaps?4/3:1)}
    })
    return {context:r.getContext().getContextAttributes(),render:{...r.info.render},memory:{...r.info.memory},geometryBytes,textureBytes,canvas:[r.domElement.width,r.domElement.height],metro:window.__spinward.metro,profile:r.domElement.dataset.xrProfile,glLost:r.getContext().isContextLost()}
  })
  const flat=await probe()
  await xr.enterVR();await xr.waitForFrames(12)
  const first=await probe(),diagnostics=await xr.diagnostics()
  await xr.screenshot(info.outputPath('entry.png'),{canvas:'canvas',metadata:true})
  await page.waitForFunction(()=>window.__spinward.metro.ready,null,{timeout:90000})
  await xr.waitForFrames(90)
  const settled=await probe()
  expect(settled.glLost).toBe(false)
  if(!process.env.SPINWARD_XR_BASELINE){
    expect(flat.context.antialias).toBe(false)
    expect(first.profile).toBe('standalone')
  }
  await xr.endSession();await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.waitForFrames(12)
  const reentered=await probe();expect(reentered.glLost).toBe(false)
  await xr.endSession()
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('entry.json'),JSON.stringify({gpu,flat,first,settled,reentered,diagnostics,errors},null,2))
})
