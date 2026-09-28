// Source-centred close views complement the unchanged palace overview fixture.
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
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const study=await (await page.request.get(url+'/metro-overview.json')).json()
  const trees=await (await page.request.get(url+'/finish-v1/palace-trees.json')).json()
  const arrivals=await (await page.request.get(url+'/metro-arrivals.json')).json()
  const point=(band,x,y,h)=>{
    const a=-(band.band*Math.PI*2/3+x/study.radius)
    return new Vector3(Math.cos(a)*(study.radius-h),-y,Math.sin(a)*(study.radius-h))
  }
  async function capture(name,bandId,at,eyeAt,nearTrees=false){
    const band=study.samples.find(s=>s.id===bandId)
    const target=point(band,...at),eye=point(band,...eyeAt)
    const up=new Vector3(-target.x,0,-target.z).normalize()
    const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye,target,up))
    const query=new URLSearchParams({city:'tokyo',preset:'izma',region:bandId,debug:'',metrics:'off',lock:'0',dpr:'1',tier:'quest',t:'.42',m:'f',p:eye.toArray().join(','),q:q.toArray().join(',')})
    await page.goto(url+'/?'+query)
    await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready'&&!window.__spinward.regional.pendingArrival,null,{timeout:120000})
    await page.waitForFunction(()=>window.__spinwardMetro.layers.every(l=>l.base.ready))
    await page.waitForTimeout(1200)
    const result=await page.evaluate(({target})=>{
      const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0]
      camera.updateWorldMatrix(true,false)
      const marker=camera.position.clone().fromArray(target)
      window.__spinwardCity.group.localToWorld(marker);marker.project(camera)
      return{state:window.__spinward,targetNdc:marker.toArray(),treeDetail:window.__spinwardMetro.trees.group.userData,
        landmarkMeshes:window.__spinwardScene.getObjectsByProperty('name','landmark-surface-detail').length}
    },{target:target.toArray()})
    for(const c of result.targetNdc)expect(Math.abs(c)).toBeLessThan(1)
    expect(result.landmarkMeshes).toBeGreaterThan(0)
    if(nearTrees)expect(result.treeDetail.near).toBeGreaterThan(0)
    expect(result.treeDetail.near).toBeLessThanOrEqual(384)
    expect(result.treeDetail.near+result.treeDetail.far).toBe(trees.trees.length)
    await page.screenshot({path:path.join(output,name+'.png')})
    await fs.writeFile(path.join(output,name+'.json'),JSON.stringify({url:url+'/?'+query,result,errors},null,2))
  }
  const shibuya=study.sourcePins.shibuya,[x,y]=shibuya.local,h=arrivals.west.ground
  await capture('shibuya-crossings',shibuya.band,[x,y,h],[x+12,y-18,h+135])
  const tree=trees.trees[Math.floor(trees.trees.length/2)], [tx,ty,th]=tree
  await capture('palace-woodland-near',trees.band,[tx,ty,th+6],[tx-42,ty-46,th+18],true)
  // A compact viewport must keep source credit and navigation on screen.
  await page.setViewportSize({width:390,height:844})
  await page.goto(url+'/?city=tokyo&preset=izma&debug&lock=0&dpr=1&tier=quest&t=.42')
  await page.waitForFunction(()=>window.__spinward?.metro?.ready&&window.__spinward.regional.state==='ready')
  await page.waitForFunction(()=>!window.__spinward.regional.pendingArrival&&window.__spinward.mode==='grounded'&&window.__spinwardMetro.layers.every(l=>l.base.ready))
  await page.waitForTimeout(1000)
  const credit=await page.locator('.metro-source-credit').boundingBox()
  expect(credit.x).toBeGreaterThanOrEqual(0);expect(credit.x+credit.width).toBeLessThanOrEqual(390)
  expect(credit.y+credit.height).toBeLessThanOrEqual(844)
  await page.screenshot({path:path.join(output,'shibuya-mobile.png')})
  expect(errors).toEqual([])
}finally{await browser.close()}
