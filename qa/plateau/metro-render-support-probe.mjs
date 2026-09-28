// Fixed-pose inspection of a failed rendered-support assertion. Does not alter
// readiness, collision, geometry, or camera state through debug globals.
import {chromium} from '@playwright/test'
import {BufferGeometry,BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Vector3,Raycaster} from 'three'
import fs from 'node:fs/promises'
const {SPINWARD_METRO_URL:url,SPINWARD_METRO_EVIDENCE:output}=process.env
if(!url||!output)throw Error('Explicit URL and output required')
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}})
 await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
 await page.goto(url+'/?city=tokyo&preset=izma&region=central&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=-2.086084855021013&ax=-11716.92123413086&gh=64.10010352343761')
 await page.waitForFunction(()=>window.__spinwardMetro?.ready&&window.__spinwardMetro.layers.every(l=>l.base.ready)&&window.__spinward.regional.state==='ready',null,{timeout:120000})
 await page.waitForTimeout(1000)
 const data=await page.evaluate(()=>{
  const city=window.__spinwardCity,m=window.__spinwardMetro,s=window.__spinward
  city.group.updateWorldMatrix(true,true);const inverse=city.group.matrixWorld.clone().invert(),meshes=[]
  for(const l of m.layers)for(const mesh of l.base.group.children)if(['terrain','buildings'].includes(mesh.name)&&mesh.userData.level==='near')
   meshes.push({name:mesh.name,p:Array.from(mesh.geometry.attributes.position.array),i:Array.from(mesh.geometry.index.array),matrix:inverse.clone().multiply(mesh.matrixWorld).elements})
  return{s,meshes,indexKeys:Object.keys(m.index),tiles:m.layers.map(l=>l.base.diagnostics())}
 })
 const material=new MeshBasicMaterial({side:DoubleSide}),meshes=data.meshes.map(d=>{
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(Float32Array.from(d.p),3)).setIndex(d.i),mesh=new Mesh(geometry,material)
  mesh.name=d.name;mesh.matrixWorld.fromArray(d.matrix);return mesh
 }),s=data.s,outward=new Vector3(Math.cos(s.azimuth),0,Math.sin(s.azimuth)),tangent=new Vector3(-Math.sin(s.azimuth),0,Math.cos(s.azimuth)),rows=[]
 for(const dx of [0,-.1,.1,-.3,.3,-1,1])for(const dy of [0,-.1,.1,-.3,.3]){
  const origin=outward.clone().multiplyScalar(s.radial-100).addScaledVector(tangent,dx);origin.y=s.axial+dy
  const hits=meshes.flatMap(m=>new Raycaster(origin,outward,0,200).intersectObject(m)).sort((a,b)=>a.distance-b.distance)
  rows.push({dx,dy,hits:hits.slice(0,6).map(h=>({name:h.object.name,height:3200-Math.hypot(h.point.x,h.point.z),distance:h.distance,face:h.faceIndex}))})
 }
 await page.screenshot({path:output+'/fixed-pose.png'})
 await fs.writeFile(output+'/probe.json',JSON.stringify({state:s,rows,indexKeys:data.indexKeys,tiles:data.tiles},null,2))
 await fs.writeFile(output+'/geometry.json',JSON.stringify(data))
 console.log(JSON.stringify({mode:s.mode,h:s.groundHeight,radial:s.radial,center:rows[0],near:rows.filter(r=>r.hits.some(h=>Math.abs(h.height-s.groundHeight)<.1))},null,2))
 for(const m of meshes)m.geometry.dispose();material.dispose()
}finally{await browser.close()}
