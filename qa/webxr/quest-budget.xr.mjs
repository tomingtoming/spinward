import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'

test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
for(const place of (process.env.SPINWARD_QUEST_PLACES??'shibuya,omiya').split(','))
test(`Quest city budget: ${place} ground, sky and walking`,async({page,xr},info)=>{
  test.setTimeout(180000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),name=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return name})
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|software/i)
  await page.addInitScript(()=>{const poll=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(poll);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(poll)})
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=${process.env.SPINWARD_QUEST_TIER??'quest'}&t=${process.env.SPINWARD_QUEST_TIME??'.42'}&place=${place}`)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:120000})
  await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)))
  await page.waitForFunction(()=>window.__spinward.metro.night.loadedBands===3)
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR()
  await xr.setControllerPose('left',{position:[-.35,.85,-.3],quaternion:[0,0,0,1]})
  await xr.setControllerPose('right',{position:[.35,.85,-.3],quaternion:[0,0,0,1]})
  const samples=[]
  async function measure(label){
    await page.evaluate(()=>{
      window.__questDraws={frame:-1,rows:{},last:{}}
      window.__spinwardScene.traverse(o=>{if(!o.isMesh||o.__questInstrumented)return;o.__questInstrumented=true;const original=o.onAfterRender
        o.onAfterRender=function(renderer,scene,camera,g,m,group){original.call(this,renderer,scene,camera,g,m,group)
          const s=window.__questDraws,f=renderer.info.render.frame
          if(f!==s.frame){s.last=s.rows;s.rows={};s.frame=f}
          const name=(this.name||this.type)+':'+(this.userData.level??''),n=this.isInstancedMesh?this.count:g.isInstancedBufferGeometry?g.instanceCount:1
          const row=s.rows[name]??={triangles:0,calls:0};row.calls++;row.triangles+=Math.min(g.index?.count??g.attributes.position?.count??0,g.drawRange.count,group?.count??Infinity)/3*n
        }
      })
    })
    await xr.waitForFrames(8)
    const sample=await page.evaluate(()=>new Promise(resolve=>{
      const times=[];let start=performance.now(),previous=start
      const r=window.__spinwardRenderer,arrays=new Set(),textures=new Set(),textureSizes=[];let geometryBytes=0,textureBytes=0
      window.__spinwardScene.traverse(o=>{if(o.geometry)for(const a of [o.geometry.index,...Object.values(o.geometry.attributes)]){const v=a?.array??a?.data?.array;if(v&&!arrays.has(v)){arrays.add(v);geometryBytes+=v.byteLength}}
        for(const m of [o.material].flat().filter(Boolean))for(const v of [...Object.values(m),...Object.values(m.uniforms??{}).map(u=>u.value)])if(v?.isTexture&&!textures.has(v)){textures.add(v);const i=v.image;textureBytes+=(i?.width??0)*(i?.height??0)*4*(v.generateMipmaps?4/3:1);if(i?.width>1024||i?.height>1024)textureSizes.push({name:o.name,w:i.width,h:i.height})}})
      const tick=now=>{times.push(now-previous);previous=now;if(now-start<1500)return requestAnimationFrame(tick)
        times.sort((a,b)=>a-b);const s=window.__spinward,m=window.__spinwardMetro
        resolve({p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],render:{...r.info.render},geometryBytes,textureBytes,textureSizes,draws:window.__questDraws.last,
          daylight:m.daylight,phase:window.__spinwardWatch.snapshot.dayCycleSeconds,pose:{a:s.azimuth,y:s.axial,h:s.groundHeight,mode:s.mode},metro:s.metro,layers:m.layers.map(l=>({band:l.base.sample.id,far:l.base.far.length,near:l.base.diagnostics().resident,facades:l.facade.chunks.filter(c=>c.level!=='far').length})),lost:r.getContext().isContextLost()})
      };requestAnimationFrame(tick)
    }))
    expect(sample.lost).toBe(false);expect(sample.layers).toHaveLength(3)
    for(const l of sample.layers)expect(l.far).toBeGreaterThan(0)
    await xr.screenshot(info.outputPath(label+'.png'),{canvas:'canvas',metadata:true})
    samples.push({label,...sample});console.log(place,label,JSON.stringify({render:sample.render,geometryBytes:sample.geometryBytes,textureBytes:sample.textureBytes,top:Object.entries(sample.draws).sort((a,b)=>b[1].triangles-a[1].triangles).slice(0,8)}))
  }
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]});await measure('street')
  await xr.setHeadPose({position:[0,1.6,0],euler:[.85,.7,0]});await measure('overhead')
  await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,0,0]})
  await xr.setAxes('left',0,place==='omiya'?.65:-.65);await xr.settle(3500);await xr.setAxes('left',0,0)
  await measure('walked')
  await fs.writeFile(info.outputPath('budget.json'),JSON.stringify({gpu,samples,errors},null,2))
  expect(Math.hypot((samples[2].pose.a-samples[0].pose.a)*3200,samples[2].pose.y-samples[0].pose.y)).toBeGreaterThan(1)
  await xr.endSession()
  await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.waitForFrames(12)
  expect(await page.evaluate(()=>window.__spinwardRenderer.getContext().isContextLost())).toBe(false)
  await xr.endSession();expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('budget.json'),JSON.stringify({gpu,samples,errors,reentry:true},null,2))
})
