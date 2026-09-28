// Capture the accepted inland geography in the original Spinward renderer.
// Run after the dataset is frozen; this supplements the walking/XR checks.
import {chromium,expect} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import path from 'node:path'

const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Set explicit preview URL and evidence directory')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const gpu=await page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info')
    const name=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unknown'
    gl.getExtension('WEBGL_lose_context')?.loseContext();return name
  })
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const study=await (await page.request.get(url+'/metro-overview.json')).json()
  expect(study.layout).toBe('inland-b')
  const pin=study.sourcePins.imperialPalace,band=study.samples.find(s=>s.id===pin.band)
  if(!band)throw Error('Missing palace source band')
  const a=-(band.band*Math.PI*2/3+pin.local[0]/study.radius)
  const radial=new Vector3(Math.cos(a),0,Math.sin(a))
  const eye=radial.clone().multiplyScalar(study.radius-1400);eye.y=-pin.local[1]+1700
  const target=radial.clone().multiplyScalar(study.radius-25);target.y=-pin.local[1]
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,radial.clone().negate()))
  const query=new URLSearchParams({city:'tokyo',preset:'izma',region:pin.band,debug:'',metrics:'off',lock:'0',dpr:'1',tier:'quest',t:'.42',m:'f',p:eye.toArray().join(','),q:q.toArray().join(',')})
  await page.goto(url+'/?'+query)
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
  await page.waitForTimeout(1200)
  const observation=await page.evaluate(({a,y})=>{
    const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
    camera.updateWorldMatrix(true,false)
    const marker=camera.position.clone().set(Math.cos(a)*3175,y,Math.sin(a)*3175)
    window.__spinwardCity.group.localToWorld(marker);marker.project(camera)
    return{state:window.__spinward,palaceCenterNdc:marker.toArray(),camera:camera.matrixWorld.elements}
  },{a,y:-pin.local[1]})
  expect(observation.state.mode).toBe('free-fly')
  for(const coordinate of observation.palaceCenterNdc)expect(Math.abs(coordinate)).toBeLessThan(1)
  await page.screenshot({path:path.join(output,'palace-port-aerial.png')})
  expect(errors).toEqual([])
  await fs.writeFile(path.join(output,'palace-port-aerial.json'),JSON.stringify({gpu,url:url+'/?'+query,pin,observation,errors},null,2))
}finally{await browser.close()}
