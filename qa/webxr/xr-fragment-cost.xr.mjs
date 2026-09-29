// Splits Quest-tier stereo GPU time by render category (and fog) by toggling
// them in one session and pose. Resolution and depth encoding cannot
// change mid-session, so they are separate URL runs (XR_COST_SCALE, XR_COST_DEPTH).
// Desktop GPU timings rank the costs; they are not Quest frame rates.
import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,viewport:{width:2560,height:960}})
const scale=process.env.XR_COST_SCALE??'1',depth=process.env.XR_COST_DEPTH??'log'
// Idle integrated GPUs downclock until any workload fills the frame, which hides
// savings. Repeating the render inside the timed query keeps the clock up.
const repeat=Number(process.env.XR_COST_REPEAT??4)
const clock=()=>fs.readFile('/sys/class/drm/card1/device/pp_dpm_sclk','utf8').then(t=>t.split('\n').find(l=>l.includes('*'))?.trim()??null,()=>null)
for(const place of ['shibuya','omiya'])test(`XR fragment cost ${place} ${depth} x${scale}`,async({page,xr},info)=>{
 test.setTimeout(300000)
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.addInitScript(()=>{
  const freeze=()=>{if(!window.__spinwardWatch)return requestAnimationFrame(freeze);for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(freeze)
 })
 await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&tier=quest&t=.42&place=${place}&depth=${depth}&xrScale=${scale}`)
 await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!document.querySelector('#splash'),null,{timeout:180000})
 await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready&&l.stream.running===0&&(!l.lowrise||l.lowrise.running===0)),null,{timeout:120000})
 await page.evaluate(()=>{const m=window.__spinwardMetro,o=m.setXRDetail.bind(m);m.setXRDetail=()=>o(2)})
 await page.getByRole('button',{name:'Menu',exact:true}).click();await xr.enterVR();await xr.setHeadPose({position:[0,1.6,0],euler:[-.12,1.2,0]});for(let warm=0;warm<5;warm++)await xr.waitForFrames(60)
 const gpu=await page.evaluate(()=>{const g=window.__spinwardRenderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),timer:!!g.getExtension('EXT_disjoint_timer_query_webgl2')}})
 expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|software/i)
 expect(gpu.timer).toBe(true)
 // Category = mesh name, else the material's program cache key, else its type.
 // Hiding one category at a time prices its full GPU share (vertex + fragment +
 // the overdraw it adds) without replacing shaders that also build geometry.
 const inventory=await page.evaluate(()=>{
  const cats={}
  const key=o=>{const m=[o.material].flat()[0];let k='';try{k=m.customProgramCacheKey?.()??''}catch{};return o.name||(k&&k!==m.onBeforeCompile?.toString()?k.slice(0,80):'')||m.type}
  window.__spinwardScene.traverseVisible(o=>{
   if(!o.isMesh&&!o.isPoints&&!o.isLine)return
   const g=o.geometry,n=g.index?g.index.count:g.attributes.position?.count??0,c=cats[key(o)]??={objects:0,triangles:0,transparent:false,type:[o.material].flat()[0].type}
   c.objects++;c.triangles+=Math.floor(n/3)*(o.isInstancedMesh?o.count:o.isMesh&&g.isInstancedBufferGeometry?(g.instanceCount===Infinity?1:g.instanceCount):1)
   if([o.material].flat().some(m=>m.transparent))c.transparent=true
  })
  window.__qaCategoryKey=key
  return Object.entries(cats).sort((a,b)=>b[1].triangles-a[1].triangles)
 })
 const shells=await page.evaluate(()=>{
  // Share of building triangles certified as closed outward shells.
  let closed=0,total=0;const meshes={}
  window.__spinwardScene.traverse(o=>{if(!o.isMesh||o.name!=='buildings'||!o.visible)return
   const g=o.geometry,c=g.attributes.closedShell,idx=g.index
   const n=idx?idx.count/3:g.attributes.position.count/3;total+=n
   let k=0;if(c)for(let t=0;t<n;t++)if(c.getX(idx?idx.getX(t*3):t*3)>.5)k++
   closed+=k
   // Uncertified buckets: whole mesh skipped (no attribute) vs components rejected.
   const bucket=`${o.userData.level??'?'}:${c?'certified-mesh':n>150000?'over-cap':'no-attribute'}`
   const b=meshes[bucket]??={meshes:0,triangles:0,closed:0};b.meshes++;b.triangles+=n;b.closed+=k})
  return{closed,total,share:total?closed/total:0,meshes}
 })
 const categories=inventory.slice(0,Number(process.env.XR_COST_CATEGORIES??8)).map(([k])=>k)
 const modes=process.env.XR_COST_MODES?process.env.XR_COST_MODES.split(','):['base','nofog','hideall','base']
 if(!process.env.XR_COST_MODES)categories.forEach((c,i)=>{modes.push(`hide:${c}`);if(i%4===3)modes.push('base')})
 const samples=[]
 for(const mode of modes){
  await page.evaluate(([mode,repeat])=>{
   const scene=window.__spinwardScene,r=window.__spinwardRenderer
   window.__qaFog??=scene.fog
   // Restore everything, then apply this mode's single change.
   if(scene.fog!==window.__qaFog){scene.fog=window.__qaFog;scene.traverse(o=>{for(const m of [o.material??[]].flat())m.needsUpdate=true})}
   // Hide through materials: the app re-shows objects every frame for LOD and streaming.
   for(const m of window.__qaHiddenMaterials??[])m.visible=true
   window.__qaHiddenMaterials=new Set()
   const hide=o=>{for(const m of [o.material].flat())if(m.visible){m.visible=false;window.__qaHiddenMaterials.add(m)}}
   if(mode==='nofog'&&scene.fog){scene.fog=null;scene.traverse(o=>{for(const m of [o.material??[]].flat())m.needsUpdate=true})}
   if(mode==='hideall')scene.traverse(o=>{if(o.isMesh||o.isPoints||o.isLine)hide(o)})
   // Building back-face experiments: restore, then optionally draw front faces only
   // or extend the closed-shell back-face discard beyond its 100 m radius.
   window.__qaBuildingMaterials??=(()=>{const m=new Map();scene.traverse(o=>{if(o.isMesh&&o.name==='buildings')m.set(o.material,o.userData.level)});return[...m]})()
   for(const [m,level] of window.__qaBuildingMaterials){
    const want=mode==='bfront'||(mode==='ofront'&&level==='overview')?1:mode==='bdiscardall'?2:0
    if((m.userData.qaVariant??0)===want)continue
    m.userData.qaOriginal??={side:m.side,compile:m.onBeforeCompile,key:m.customProgramCacheKey}
    const o=m.userData.qaOriginal;m.side=want===1?0:o.side;m.onBeforeCompile=o.compile;m.customProgramCacheKey=o.key
    if(want===2){m.onBeforeCompile=(sh,r)=>{o.compile.call(m,sh,r);sh.fragmentShader=sh.fragmentShader.replace('dot(vViewPosition,vViewPosition)<10000.0','true')};m.customProgramCacheKey=()=>o.key()+'-qa-all'}
    m.userData.qaVariant=want;m.needsUpdate=true
   }
   // Rasterizer culling of certified shells (building-shell-culling.js).
   scene.traverse(o=>{if(o.userData.shellFaceCulling)o.userData.shellFaceCulling.enabled=mode!=='faceoff'})
   // Surfaces of the host colony under the Tokyo ground (structural floor,
   // hull, old arrival planes): never visible there, but still rasterized.
   // Whole structural floor (before the Tokyo edge band) for comparison.
   if(window.__spinwardHabitat)window.__spinwardHabitat.setFloorEdgeBand(mode==='floorfull'?null:window.__spinwardMetro?.active===false?null:400)
   // Cheapest backstop variant: unlit flat colour on the structural floor.
   window.__qaFloorSwap??=[]
   for(const [o,m] of window.__qaFloorSwap)o.material=m
   window.__qaFloorSwap=[]
   if(mode==='floorbasic'){
    const metro=window.__spinwardMetro?.group,city=window.__spinwardCity.group,inv=city.matrixWorld.clone().invert(),v=city.position.clone()
    let Basic=null;scene.traverse(o=>{if(!Basic&&o.material?.type==='MeshBasicMaterial')Basic=o.material.constructor})
    window.__qaFlatFloor??=new Basic({color:0x5a5f58,side:1})
    scene.traverse(o=>{
     if(!o.isMesh||!o.visible)return
     for(let q=o;q;q=q.parent)if(q===metro)return
     const p=o.geometry.attributes.position;if(!p)return
     v.fromBufferAttribute(p,0).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
     if(Math.abs(3200-Math.hypot(v.x,v.z)+16)<.5&&!o.material.transparent){window.__qaFloorSwap.push([o,o.material]);o.material=window.__qaFlatFloor}
    })
   }
   if(mode==='under'||mode.startsWith('under:')){
    const part=mode.split(':')[1]
    const metro=window.__spinwardMetro?.group,city=window.__spinwardCity.group,inv=city.matrixWorld.clone().invert(),v=city.position.clone()
    scene.traverse(o=>{
     if(!o.isMesh||!o.visible)return
     for(let q=o;q;q=q.parent)if(q===metro)return
     const p=o.geometry.attributes.position;if(!p)return
     let lo=Infinity,hi=-Infinity;const step=Math.max(1,Math.floor(p.count/200))
     for(let i=0;i<p.count;i+=step){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);const h=3200-Math.hypot(v.x,v.z);lo=Math.min(lo,h);hi=Math.max(hi,h)}
     if(!(hi<=1&&lo>-100))return
     const m=[o.material].flat()[0],kind=Math.abs(hi+16)<.5?'floor':Math.abs(hi+19.2)<.5?'hull':m.transparent&&Math.abs(hi-.3)<.05?'overlay':'other'
     if(!part||part===kind)hide(o)
    })
    window.__qaUnderHidden=window.__qaHiddenMaterials.size
   }
   if(mode.startsWith('hide:')){const c=mode.slice(5);scene.traverse(o=>{if((o.isMesh||o.isPoints||o.isLine)&&window.__qaCategoryKey(o)===c)hide(o)})}
   window.__qaMode=mode
   window.__qaRepeat=repeat
   if(!window.__qaOriginalRender){
    window.__qaOriginalRender=r.render.bind(r)
    r.render=(...args)=>{
     const g=r.getContext(),ext=g.getExtension('EXT_disjoint_timer_query_webgl2')
     window.__qaQueries??=[]
     for(const q of [...window.__qaQueries])if(g.getQueryParameter(q,g.QUERY_RESULT_AVAILABLE)){
      if(!g.getParameter(ext.GPU_DISJOINT_EXT))window.__qaGPU?.push(g.getQueryParameter(q,g.QUERY_RESULT)/1e6/window.__qaRepeat)
      g.deleteQuery(q);window.__qaQueries.splice(window.__qaQueries.indexOf(q),1)
     }
     const query=ext&&window.__qaQueries.length<10?g.createQuery():null
     if(query)g.beginQuery(ext.TIME_ELAPSED_EXT,query)
     try{for(let i=1;i<window.__qaRepeat;i++)window.__qaOriginalRender(...args);return window.__qaOriginalRender(...args)}finally{if(query){g.endQuery(ext.TIME_ELAPSED_EXT);window.__qaQueries.push(query)}}
    }
   }
  },[mode,repeat])
  // Settle (and compile programs after fog changes) before sampling.
  await xr.waitForFrames(90);await page.evaluate(()=>{window.__qaGPU=[]})
  await xr.waitForFrames(60);const sclk=await clock();await xr.waitForFrames(60)
  samples.push(await page.evaluate(sclk=>{
   const a=window.__qaGPU.sort((x,y)=>x-y),at=p=>a[Math.floor(a.length*p)]
   return{mode:window.__qaMode,underHidden:window.__qaUnderHidden,gpu:{n:a.length,p50:at(.5),p95:at(.95)},draw:{...window.__spinwardRenderer.info.render},fog:!!window.__spinwardScene.fog,sclk,repeat:window.__qaRepeat}
  },sclk))
 }
 const summary={}
 for(const s of samples)(summary[s.mode]??=[]).push(+s.gpu.p50.toFixed(2))
 const result={place,depth,scale,repeat,shells,gpu,inventory,summary,samples}
 await fs.writeFile(info.outputPath('fragment-cost.json'),JSON.stringify(result,null,2))
 console.log('FRAGMENT',JSON.stringify({place,depth,scale,repeat,shells,renderer:gpu.renderer,summary,inventory:inventory.map(([k,v])=>[k,v.objects,v.triangles,v.type])}))
 await xr.endSession()
})
