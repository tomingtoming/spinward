import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL/output required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  for(const region of (process.env.SPINWARD_METRO_REGIONS??'east,central,west').split(',')){
    await page.goto(url+'/?city=tokyo&preset=izma&region='+region+'&debug&metrics=off&lock=0&dpr=1&tier=quest&t='+(process.env.SPINWARD_METRO_TIME??'.8')+(process.env.SPINWARD_METRO_POSE??''))
    await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.mode==='grounded'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    await page.waitForTimeout(1000)
    for(const yaw of [0,-1.1,1.1]){
      const result=await page.evaluate(({yaw})=>{
        const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
        camera.rotation.set(.45,yaw,0,'YXZ')
        return {state:window.__spinward,depth:window.__spinwardWatch.snapshot.depthMode,
          facades:window.__spinwardMetro.layers.map(l=>l.facade.diagnostics()),cameraQuaternion:camera.quaternion.toArray()}
      },{yaw})
      await page.waitForTimeout(300)
      const name=region+'-'+yaw
      await page.screenshot({path:path.join(output,name+'.png')})
      await fs.writeFile(path.join(output,name+'.json'),JSON.stringify(result,null,2))
      for(const l of result.state.metro.layers){
        assert.ok(l.base.nearDecodedBytes<=24*1024*1024)
        assert.ok(l.base.far.decodedBytes<=48*1024*1024)
        assert.equal(l.base.failures+l.base.far.failures,0)
      }
    }
  }
  assert.deepEqual(errors,[])
}finally{await browser.close()}
