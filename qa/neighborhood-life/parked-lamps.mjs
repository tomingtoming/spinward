import * as T from 'three'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/?debug&stats&m=g&a=0&ax=-200&t=.42&dpr=1&people=0')
 await page.waitForFunction(()=>window.__spinward.parking?.drawn>0)
 const matrix=await page.evaluate(()=>{
  const pack=window.__spinwardCity.getKenneyCarPack(),cars=[]
  window.__spinwardScene.traverse(o=>{
   if(o.isInstancedMesh&&o.material===pack.material&&o.geometry.attributes.position.count===pack.cars[4].attributes.position.count)
    for(let i=0;i<o.count;i++)cars.push(Array.from(o.instanceMatrix.array.slice(i*16,i*16+16)))
  })
  return cars.sort((a,b)=>Math.hypot(a[12]-3200,a[13]+200,a[14])-Math.hypot(b[12]-3200,b[13]+200,b[14]))[0]
 })
 if(!matrix)throw Error('No parked taxi found')
 const m=new T.Matrix4().fromArray(matrix),centre=new T.Vector3().setFromMatrixPosition(m)
 const up=new T.Vector3(0,1,0).transformDirection(m),forward=new T.Vector3(0,0,1).transformDirection(m),side=new T.Vector3(1,0,0).transformDirection(m)
 const camera=centre.clone().addScaledVector(forward,6).addScaledVector(side,1.6).addScaledVector(up,1.6)
 const a=Math.atan2(camera.z,camera.x),ax=camera.y
 camera.x=Math.cos(a)*3198.2;camera.z=Math.sin(a)*3198.2
 const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(camera,centre.clone().addScaledVector(up,.7),up))
 const results=[]
 for(const time of ['.42','.9']){
  await page.goto(base+`/?debug&stats&m=g&a=${a}&ax=${ax}&q=${q.toArray()}&t=${time}&dpr=1&people=0`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinward.parking?.drawn>0)
  await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())})
  await page.waitForTimeout(1000)
  for(const corrected of [false,true]){
   const counts=await page.evaluate(corrected=>{
    const pack=window.__spinwardCity.getKenneyCarPack(),counts=[]
    window.__spinwardScene.traverse(o=>{
     if(!o.isInstancedMesh||o.material!==pack.material)return
     const source=pack.cars.find(g=>g.attributes.position.count===o.geometry.attributes.position.count)
     if(!source)return
     const body=source.groups.find(g=>g.materialIndex===0)
     o.geometry.setDrawRange(body.start,corrected?body.count:Infinity)
     counts.push({instances:o.count,drawnIndices:o.geometry.drawRange.count,bodyIndices:body.count})
    })
    return counts
   },corrected)
   if(!counts.length||corrected&&counts.some(c=>c.drawnIndices!==c.bodyIndices))throw Error('Parking body range contract failed')
   await page.waitForTimeout(200)
   await page.screenshot({path:out+`parked-lamps-${time==='.42'?'day':'night'}-${corrected?'after':'before'}.png`})
   results.push({time,corrected,counts})
  }
 }
 if(errors.length)throw Error(JSON.stringify(errors))
 fs.writeFileSync(out+'parked-lamps.json',JSON.stringify({errors,results},null,2));console.log(JSON.stringify({errors,views:results.length}))
}finally{await browser.close()}
