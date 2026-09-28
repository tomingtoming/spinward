import {test,expect} from 'playwright-webxr'
import fs from 'node:fs/promises'
import * as T from 'three'
async function ready(page,url){
 await page.goto(url);await page.waitForFunction(()=>window.__plateau?.rendered&&window.__plateau.detailsReady)
 const gpu=await page.evaluate(()=>{const g=document.querySelector('canvas').getContext('webgl2'),d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})
 expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i);return gpu
}
async function probe(page){
 const p=await page.evaluate(()=>{const w=window.__plateau,s=w.walk,eye=w.camera.getWorldPosition(w.camera.position.clone()),floors=w.visibleMeshes(w.state.selected,['terrain','roads','footways'])
  return{walk:s,eye:eye.toArray(),mode:w.state.mode,base:[...w.baseTiles].map(([id,b])=>({id,...b.diagnostics()})),floors:floors.map(m=>({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array.slice(0,Math.min(m.geometry.drawRange.count,m.geometry.index.count)))}))}
 })
 const eye=new T.Vector3(...p.eye),up=new T.Vector3(-eye.x,-eye.y,0).normalize(),ray=new T.Raycaster(eye,up.negate(),0,4),hits=[]
 for(const f of p.floors){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(f.p,3));g.setIndex(f.i);const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));hits.push(...ray.intersectObject(m));g.dispose();m.material.dispose()}
 expect(hits.length).toBeGreaterThan(0);p.contactErrorM=Math.abs(Math.min(...hits.map(h=>h.distance))-1.65);expect(p.contactErrorM).toBeLessThan(.04);delete p.floors;return p
}
test('base tiles: all three ground boundaries stay continuous during a real key walk',async({page},info)=>{
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname))
 const gpu=await ready(page,'/?world=colony&walk=1'),probes=[]
 for(const [id,y] of [['tokyo',-378],['tama',-372],['azumino',-400]]){
  // A validated source-space checkpoint at x=100 m; movement itself uses real input.
  await page.locator('#walk').click();await page.locator(`[data-region=${id}]`).click()
  await page.evaluate(({id,y})=>{const w=window.__plateau.walkWorlds.get(id),original=w.spawn.bind(w);w.spawn=()=>{w.spawn=original;return{x:92,y,h:w.ground(92,y),yaw:-Math.PI/2,pitch:0,rejected:0}}},{id,y})
  await page.locator('#walk').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
  const before=await probe(page);await page.screenshot({path:info.outputPath(id+'-before.png')})
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await page.waitForFunction(()=>window.__plateau.walk.x>=108,null,{timeout:15000});await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft')
  const after=await probe(page);expect(after.walk.rejected).toBe(0);expect(after.walk.y).toBeCloseTo(y,4);await page.screenshot({path:info.outputPath(id+'-after.png')})
  const active=after.base.find(b=>b.id===id);expect(active.resident.length).toBeGreaterThan(0);expect(active.resident.length).toBeLessThanOrEqual(25);expect(active.nearDecodedBytes).toBeLessThanOrEqual(12*1024*1024)
  for(const b of after.base.filter(b=>b.id!==id))expect(b.nearDecodedBytes).toBe(0)
  probes.push({before,after})
 }
 expect(requests.filter(p=>p.endsWith('.positions.bin')||p.endsWith('.indices.bin'))).toEqual([]);expect(errors).toEqual([])
 await fs.writeFile(info.outputPath('boundaries.json'),JSON.stringify({gpu,probes,errors,requests},null,2))
})
test('base tiles: failed near tile retains the exact ground, then recovers on revisit',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/base-tiles/tokyo-3-3.bin.gz',route=>route.fulfill({status:503,body:'offline'}))
 await page.goto('/?region=tokyo&world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.rendered)
 await page.waitForFunction(()=>{const e=window.__plateau.baseTiles.get('tokyo').entries.get('3-3');return e.status==='failed'&&e.attempts===3})
 await expect(page.locator('#detail-status')).toContainText('遠景の建物と道路')
 const before=await probe(page);await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.__plateau.walk.x>2);await page.keyboard.up('KeyW');const after=await probe(page)
 await page.screenshot({path:info.outputPath('fallback.png')})
 await page.unroute('**/base-tiles/tokyo-3-3.bin.gz');await page.locator('[data-region=tama]').click();await page.locator('[data-region=tokyo]').click();await page.waitForFunction(()=>window.__plateau.detailsReady)
 await expect(page.locator('#detail-status')).toBeEmpty();await page.screenshot({path:info.outputPath('recovered.png')})
 expect(errors).toEqual([]);await fs.writeFile(info.outputPath('fallback.json'),JSON.stringify({before,after,recovered:await probe(page),errors},null,2))
})
test('base tiles: same-view comparison with untiled source and measured GPU buffers',async({page},info)=>{
 const rows=[]
 for(const variant of ['legacy','streamed']){
  const url='/?region=tokyo&site=east&world=colony&walk=1'+(variant==='legacy'?'&tiles=legacy':'');const gpu=await ready(page,url)
  await page.screenshot({path:info.outputPath(variant+'.png')})
  const metrics=await page.evaluate(async()=>{
   const w=window.__plateau,arrays=new Set(),gpuArrays=new Set();let cpuBytes=0,gpuBytes=0
   w.scene.traverse(o=>{if(!o.isMesh)return;const g=o.geometry;for(const a of [...Object.values(g.attributes),g.index].filter(Boolean)){if(!gpuArrays.has(a)){gpuArrays.add(a);gpuBytes+=a.array.byteLength}if(!arrays.has(a.array.buffer)){arrays.add(a.array.buffer);cpuBytes+=a.array.buffer.byteLength}}
    for(const a of Object.values(o.userData.native??{}))if(!arrays.has(a.buffer)){arrays.add(a.buffer);cpuBytes+=a.buffer.byteLength}
   })
   const times=[];let last=performance.now();await new Promise(resolve=>{const frame=now=>{times.push(now-last);last=now;times.length<250?requestAnimationFrame(frame):resolve()};requestAnimationFrame(frame)})
   const sorted=times.slice(20).sort((a,b)=>a-b);return{geometryAttributeBytes:gpuBytes,observedArrayBuffers:cpuBytes,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],render:{...w.renderer.info.render},base:[...w.baseTiles].map(([id,b])=>({id,...b.diagnostics()}))}
  });rows.push({variant,gpu,metrics})
  await page.locator('#walk').click();await page.locator('[data-region=tama]').click()
  await page.evaluate(()=>{const w=window.__plateau.walkWorlds.get('tama'),original=w.spawn.bind(w);w.spawn=()=>{w.spawn=original;return{x:92,y:-372,h:w.ground(92,-372),yaw:-Math.PI/2,pitch:0,rejected:0}}})
  await page.locator('#walk').click();await page.waitForFunction(()=>window.__plateau.detailsReady);await page.screenshot({path:info.outputPath('tama-'+variant+'.png')})
 }
 // Memory claim is scoped to declared geometry attributes, not total browser/VR memory.
 expect(rows[1].metrics.geometryAttributeBytes).toBeLessThan(rows[0].metrics.geometryAttributeBytes)
 await fs.writeFile(info.outputPath('comparison.json'),JSON.stringify(rows,null,2))
})
