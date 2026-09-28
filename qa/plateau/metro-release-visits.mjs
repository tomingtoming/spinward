// Repeated user-facing Places navigation in one browser session. No readiness
// or player-position mutation: the scene keeps its normal streaming budgets.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {X509Certificate,createHash} from 'node:crypto'
import {findRenderedSupport} from './rendered-support.mjs'
import {releaseEndpoints} from './metro-release-network.mjs'

const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit candidate URL and evidence directory required')
const endpoints=releaseEndpoints(url,process.env.SPINWARD_METRO_DATA_URL)
await fs.mkdir(output,{recursive:true})
const cert=new X509Certificate(await fs.readFile(new URL('../../node_modules/.vite/basic-ssl/_cert.pem',import.meta.url)))
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64')
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'spinward-visits-'))
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`],viewport:{width:1280,height:960},deviceScaleFactor:1,locale:'en-US'})
const visits=[],errors=[],failures=[],observedData=new Set()
try{
  const page=await context.newPage(),cdp=await context.newCDPSession(page)
  await cdp.send('Network.enable');await cdp.send('Performance.enable')
  await cdp.send('Network.setBlockedURLs',{urls:['*static.cloudflareinsights.com*']})
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{
    if(endpoints.isData(r.url()))observedData.add(r.url())
    if(endpoints.owns(r.url())&&r.status()>=400)failures.push({url:r.url(),status:r.status()})
  })
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),name=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return name})
  assert.ok(!/unknown|SwiftShader|software|llvmpipe/i.test(gpu))
  await page.addInitScript(()=>{
    window.__visitSamples=[]
    setInterval(()=>{
      const s=window.__spinward,r=window.__spinwardRenderer
      if(s?.metro)window.__visitSamples.push({at:performance.now(),regional:s.regional,metro:s.metro,memory:{...r.info.memory}})
    },500)
  })
  await page.goto(url+'/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42')
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
  const releasePath=await page.evaluate(()=>window.__spinward.metro.release.path)
  assert.ok(observedData.has(endpoints.wire(releasePath)),'Count failures from the actual city data origin')
  const latency=Number(process.env.SPINWARD_STREAM_LATENCY_MS??100),bandwidth=Number(process.env.SPINWARD_STREAM_BANDWIDTH??1250000)
  await cdp.send('Network.emulateNetworkConditionsByRule',{matchedNetworkConditions:[{urlPattern:'',latency,downloadThroughput:bandwidth,uploadThroughput:bandwidth}]})
  const places=await page.evaluate(()=>window.__spinwardMetro.places)
  const ids=(process.env.SPINWARD_VISIT_PLACES??'tokyo,shinjuku,omiya,shibuya').split(',')
  for(let cycle=0;cycle<3;cycle++)for(const id of ids){
    const place=places.find(p=>p.id===id);assert.ok(place)
    await page.getByRole('button',{name:'Places',exact:true}).click()
    const at=await page.evaluate(()=>performance.now())
    await page.getByRole('button',{name:`Go now to ${place.label}`,exact:true}).click()
    await page.waitForFunction(({id,y})=>{const s=window.__spinward;return s.tour==='visit-metro-'+id&&s.regional.state==='ready'&&!s.regional.pendingArrival&&s.mode==='grounded'&&Math.abs(s.axial+y)<.2},{id,y:place.spawn[1]},{timeout:90000})
    const usable=await page.evaluate(()=>performance.now())
    const arrival=await page.evaluate(()=>({radial:window.__spinward.radial,ground:window.__spinward.groundHeight,mode:window.__spinward.mode}))
    // Arrival readiness and the camera/body settling to its 0.32 m contact
    // volume are distinct. Preserve both times instead of sampling mid-settle.
    await page.waitForFunction(()=>{const s=window.__spinward;return s.mode==='grounded'&&s.radius-s.radial-s.groundHeight<.34},null,{timeout:10000})
    // Inspect real rendered near triangles at the player's contact volume.
    const probe=await page.evaluate(()=>{
      const c=window.__spinwardCity,s=window.__spinward,meshes=[]
      c.group.updateWorldMatrix(true,true);const inverse=c.group.matrixWorld.clone().invert()
      for(const l of window.__spinwardMetro.layers)for(const m of l.base.group.children)
        if(['terrain','buildings'].includes(m.name)&&m.userData.level==='near')meshes.push({p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array),matrix:inverse.clone().multiply(m.matrixWorld).elements})
      return{a:s.azimuth,y:s.axial,h:s.groundHeight,radial:s.radial,r:s.radius,meshes}
    })
    const support=findRenderedSupport(probe)
    if(!support)await fs.writeFile(output+'/support-failure.json',JSON.stringify({id,arrival,a:probe.a,y:probe.y,h:probe.h,radial:probe.radial,r:probe.r,meshes:probe.meshes.length,nearest:findRenderedSupport(probe,{radius:3,separation:0})}))
    assert.ok(support,id+' must land on rendered source ground')
    assert.ok(Math.abs(support.drawnHeight-probe.h)<.08)
    assert.ok(Math.abs(probe.h-place.ground)<.15)
    await page.waitForTimeout(3000)
    const snapshot=await page.evaluate(id=>({expected:window.__spinwardMetro.visit('metro-'+id),actual:{azimuth:window.__spinward.azimuth,axial:window.__spinward.axial},regional:window.__spinward.regional,metro:window.__spinward.metro,memory:{...window.__spinwardRenderer.info.memory}}),id)
    const angle=snapshot.actual.azimuth-snapshot.expected.azimuth
    assert.ok(Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))*3200<3,'Arrival must be in the requested band')
    assert.ok(Math.abs(snapshot.actual.axial-snapshot.expected.axial)<3,'Arrival must be at the requested axial coordinate')
    const metrics=(await cdp.send('Performance.getMetrics')).metrics
    const row={cycle,id,region:place.region,usableMs:usable-at,arrival,support,heap:metrics.find(m=>m.name==='JSHeapUsedSize')?.value,...snapshot}
    visits.push(row)
    console.log(JSON.stringify({cycle,id,usableMs:row.usableMs,heap:row.heap,memory:row.memory,collisionBytes:row.regional.bytes}))
    await fs.writeFile(output+'/progress.json',JSON.stringify(visits,null,2))
  }
  const samples=await page.evaluate(()=>window.__visitSamples)
  const result={origin:'ai',created:new Date().toISOString(),gpu,latency,bandwidth,dataRoot:endpoints.dataRoot,method:'Initial scene without artificial bandwidth restriction, then three rounds of actual Places UI in the same persistent Chrome; no cache clearing or forced GC between visits.',visits,samples,errors,failures}
  await fs.writeFile(output+'/visits.json',JSON.stringify(result,null,2))
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[])
  assert.equal(new Set(visits.map(v=>v.region)).size,3,'All three bands are exercised')
  for(const s of samples){
    assert.ok(s.regional.entries<=96&&s.regional.bytes<=144*1024*1024,'Collision budget')
    assert.ok(s.metro.nativeTiles.bytes<=s.metro.nativeTiles.maxBytes,'Shared native tile budget')
    for(const l of s.metro.layers){
      assert.ok(l.base.nearDecodedBytes<=24*1024*1024,'Near render budget')
      assert.ok(!l.base.far||l.base.far.decodedBytes<=48*1024*1024,'Far render budget')
      for(const x of [l.lowrise,l.nightPanes])if(x)assert.ok(x.bytes<=x.maxBytes,'Instance budget')
    }
  }
  console.log('PASS: 12 visits, real ground contacts, three bands, bounded residency')
}catch(error){
  await fs.writeFile(output+'/failure.json',JSON.stringify({error:String(error),visits,errors,failures},null,2));throw error
}finally{await context.close();await fs.rm(profile,{recursive:true,force:true})}
