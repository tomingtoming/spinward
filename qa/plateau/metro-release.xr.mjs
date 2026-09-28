import {test,expect} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {releaseEndpoints} from './metro-release-network.mjs'

const root=process.env.SPINWARD_RELEASE_PACKAGE
if(!root)throw Error('Set the exact SPINWARD_RELEASE_PACKAGE under test')
const inventory=JSON.parse(await fs.readFile(path.join(root,'inventory.json')))
const manifest=JSON.parse(await fs.readFile(path.join(root,'public',inventory.release)))
const core=JSON.parse(gunzipSync(await fs.readFile(path.join(root,'public',manifest.core))))
const target='/?city=tokyo&preset=izma&place=shibuya&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.02'
const endpoints=releaseEndpoints(process.env.SPINWARD_METRO_URL,process.env.SPINWARD_METRO_DATA_URL)
const wire=endpoints.wire
const hash=b=>createHash('sha256').update(b).digest('hex')
const snapshot=page=>page.evaluate(()=>({state:window.__spinward,details:window.__spinwardMetro?.layers.map(l=>({band:l.base.sample.id,detail:l.detail})),night:window.__spinwardMetro?.nightscape?.diagnostics()}))
async function init(page){
  await page.goto('about:blank')
  const gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info'),r=g.getParameter(e.UNMASKED_RENDERER_WEBGL);g.getExtension('WEBGL_lose_context').loseContext();return r})
  expect(gpu).not.toMatch(/unknown|SwiftShader|software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  await page.addInitScript(()=>{const poll=()=>{if(!window.__spinwardWatch){requestAnimationFrame(poll);return}for(let i=0;i<3;i++)window.__spinwardWatch.onAction('day-cycle-coarse-decrement')};requestAnimationFrame(poll)})
  return gpu
}
async function ready(page){
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:90000})
  await page.waitForSelector('#splash',{state:'detached'})
}
async function visit(page,id){
  const label=await page.evaluate(id=>window.__spinwardMetro.places.find(p=>p.id===id).label,id)
  await page.getByRole('button',{name:'Places',exact:true}).click()
  await page.getByRole('button',{name:`Go now to ${label}`,exact:true}).click()
}

test('release HTTP contract: immutable opaque gzip, checksum, CORS and no source data',async({page,request},info)=>{
  const gpu=await init(page),observed=[]
  page.on('response',r=>{if(endpoints.owns(r.url()))observed.push({url:r.url(),status:r.status()})})
  // The API client is separate from Chrome and does not inherit its scoped
  // local SPKI trust. Limit this test-only exception to the loopback candidate.
  const localTLS={ignoreHTTPSErrors:/^https:\/\/(127\.0\.0\.1|localhost):/.test(endpoints.dataRoot),headers:{Origin:endpoints.appOrigin}}
  const response=await request.get(wire(manifest.core),localTLS),bytes=await response.body(),headers=response.headers()
  expect(response.status()).toBe(200);expect(hash(bytes)).toBe(manifest.coreSha256)
  expect([...bytes.subarray(0,2)]).toEqual([31,139])
  expect(headers['content-encoding']).toBeUndefined()
  expect(headers['cache-control']).toContain('immutable')
  expect(headers['access-control-allow-origin']).toBe('*');expect(headers['timing-allow-origin']).toBe('*')
  expect((await request.get(wire(manifest.core),{...localTLS,headers:{...localTLS.headers,'If-None-Match':headers.etag}})).status()).toBe(304)
  expect((await request.get(wire('metro.sqlite'),localTLS)).status()).toBe(404)
  await page.goto(target);await ready(page)
  expect(await page.evaluate(()=>window.__spinward.metro.release.path)).toBe(inventory.release)
  expect(observed.some(r=>r.url===wire(inventory.release)),'The page must actually use the configured data origin').toBe(true)
  expect(observed.filter(r=>r.status>=400)).toEqual([])
  await fs.writeFile(info.outputPath('contract.json'),JSON.stringify({gpu,headers,bytes:bytes.length,observed},null,2))
})

test('public CDN caches immutable bytes but never retains missing city objects',async({request},info)=>{
  test.skip(/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(endpoints.dataRoot),'Requires the real CDN')
  const options={headers:{Origin:endpoints.appOrigin}}
  await request.get(wire(manifest.core),options)
  const cached=await request.get(wire(manifest.core),options)
  expect(cached.status()).toBe(200)
  expect(cached.headers()['cf-cache-status']).toBe('HIT')
  expect(hash(await cached.body())).toBe(manifest.coreSha256)
  const absent=wire(`objects/00/${'0'.repeat(64)}.bin.gz`)+`?cdn-check=${Date.now()}`,missing=[]
  for(let i=0;i<2;i++){
    const response=await request.get(absent,options),headers=response.headers()
    expect(response.status()).toBe(404)
    expect(headers['cache-control']).toContain('no-store')
    expect(headers['cf-cache-status']).not.toBe('HIT')
    missing.push(headers)
  }
  await fs.writeFile(info.outputPath('cdn-cache.json'),JSON.stringify({cached:cached.headers(),missing},null,2))
})

test('corrupt core never starts a partial world; the real Reload action recovers',async({page},info)=>{
  await init(page);let corrupt=true
  await page.route(wire(manifest.core),r=>corrupt?r.fulfill({status:200,body:Buffer.from('{"wrongRelease":true}'),contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}}):r.continue())
  await page.goto(target)
  await expect(page.locator('.splash__error-detail')).toContainText('The colony could not be loaded')
  expect(await page.evaluate(()=>window.__spinward?.metro?.operational??false)).toBe(false)
  await page.screenshot({path:info.outputPath('failed.png')})
  corrupt=false;await page.getByRole('button',{name:'RELOAD',exact:true}).click();await ready(page)
  expect(await page.evaluate(()=>window.__spinwardMetro.arrivalId)).toBe('shibuya')
  await fs.writeFile(info.outputPath('recovered.json'),JSON.stringify(await snapshot(page),null,2))
})

test('failed optional facades and night fields preserve movement and retry without duplicates',async({page},info)=>{
  const gpu=await init(page),errors=[];page.on('pageerror',e=>errors.push(e.message))
  const blocked=new Set([wire(core.details.west),wire(core.night.bands.west.pools)]),attempts={};let offline=true
  await page.route(u=>endpoints.isData(u.href),r=>{
    const p=r.request().url()
    if(offline&&blocked.has(p)){attempts[p]=(attempts[p]??0)+1;return r.fulfill({status:503,body:'injected unavailable',headers:{'Access-Control-Allow-Origin':'*'}})}
    return r.continue()
  })
  await page.goto(target);await ready(page)
  await page.waitForFunction(()=>{const m=window.__spinwardMetro,n=m.nightscape,d=m.layers.find(l=>l.base.sample.id==='west').detail;return d.attempts===3&&d.status==='failed'&&n.attempts===3&&!n.loading})
  const before=await snapshot(page)
  await page.keyboard.down('KeyW');await page.waitForTimeout(1200);await page.keyboard.up('KeyW')
  const during=await snapshot(page),a=before.state,b=during.state
  expect(Math.hypot((b.azimuth-a.azimuth)*3200,b.axial-a.axial)).toBeGreaterThan(.5)
  expect(b.regional.state).toBe('ready');expect(Object.values(attempts)).toEqual([3,3])
  offline=false;await visit(page,'shibuya');await ready(page)
  await page.waitForFunction(()=>{const m=window.__spinwardMetro;return m.nightscape.loaded===3&&m.layers.find(l=>l.base.sample.id==='west').detail.status==='ready'})
  const after=await snapshot(page)
  expect(after.night.failures).toEqual([])
  expect(after.night.sourceFixtures).toBe(Object.values(core.night.bands).reduce((n,b)=>n+b.count,0))
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('recovery.json'),JSON.stringify({gpu,attempts,before,during,after,errors},null,2))
})

test('unavailable destination collision holds the body until Places retry succeeds',async({page},info)=>{
  const gpu=await init(page),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(target);await ready(page)
  const destination=await page.evaluate(()=>{
    const m=window.__spinwardMetro,p=m.places.find(p=>p.id==='omiya')
    const paths=m.collision.entries.filter(e=>e.tile.band===m.study.samples.find(s=>s.id===p.region).band&&Math.hypot(Math.max(0,e.tile.bounds[0]-p.spawn[0],p.spawn[0]-e.tile.bounds[2]),Math.max(0,e.tile.bounds[1]-p.spawn[1],p.spawn[1]-e.tile.bounds[3]))<500).map(e=>e.tile.path)
    return{place:p,paths}
  })
  expect(destination.paths.length).toBeGreaterThan(0)
  const blocked=new Set(destination.paths.map(wire)),attempts={};let offline=true
  await page.route(u=>endpoints.isData(u.href),r=>{
    const p=r.request().url()
    if(offline&&blocked.has(p)){attempts[p]=(attempts[p]??0)+1;return r.fulfill({status:503,body:'injected unavailable',headers:{'Access-Control-Allow-Origin':'*'}})}
    return r.continue()
  })
  const before=await snapshot(page);await visit(page,'omiya')
  await page.waitForFunction(()=>window.__spinward.regional.state==='failed')
  const failed=await snapshot(page)
  expect(failed.state.regional.pendingArrival).toBe(true)
  expect(failed.state.regional.missingCritical).toBeGreaterThan(0)
  await page.keyboard.down('KeyW');await page.keyboard.down('Space');await page.waitForTimeout(1000);await page.keyboard.up('Space');await page.keyboard.up('KeyW')
  const held=await snapshot(page)
  expect(Math.hypot((held.state.azimuth-before.state.azimuth)*3200,held.state.axial-before.state.axial)).toBeLessThan(.02)
  await page.screenshot({path:info.outputPath('held.png')})
  offline=false;await visit(page,'omiya');await ready(page)
  await page.waitForFunction(y=>Math.abs(window.__spinward.axial+y)<.2,destination.place.spawn[1])
  const recovered=await snapshot(page)
  expect(recovered.state.regional.missingCritical).toBe(0);expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('safety.json'),JSON.stringify({gpu,destination,attempts,before,failed,held,recovered,errors},null,2))
})
