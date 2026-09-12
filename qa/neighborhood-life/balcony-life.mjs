import {chromium} from '@playwright/test'
import {Matrix4, Quaternion, Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {probeBalconies} from './balcony-probe.mjs'
import {planBalconyLife} from '../../src/objects/balconyLife.ts'
import {colonyBalconies} from '../../src/objects/colonyBalconies.ts'

const base=process.env.SPINWARD_URL, label=process.env.LABEL??'after', tier=process.env.TIER??'desktop'
if(!base)throw Error('SPINWARD_URL required')
const isBefore=label.startsWith('before')
const out=fileURLToPath(new URL('.',import.meta.url)), evidence={label,tier,views:[],errors:[]}
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},deviceScaleFactor:1})
 await context.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}))
 if(process.env.BASELINE_DIR){
  const files=await fs.readdir(process.env.BASELINE_DIR+'/assets'),file=files.find(f=>/^index-.*\.js$/.test(f))
  const body=await fs.readFile(process.env.BASELINE_DIR+'/assets/'+file)
  evidence.baselineAsset=file
  await context.route('**/assets/index-*.js',r=>r.fulfill({status:200,body,contentType:'application/javascript'}))
 }
 if(process.env.ASSET_FAILURE==='1')await context.route('**/balcony-life.glb',r=>r.fulfill({status:200,body:JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0}),contentType:'model/gltf+json'}))
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message))
 await page.goto('about:blank');evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');if(!d)throw Error('GPU unknown');const s=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return s})
 if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 const visit=async query=>{
  await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${query}`,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('#splash',{state:'detached',timeout:60000})
  await page.waitForFunction(()=>!!window.__spinwardCity?.colonyBuildings.modules)
  if(!isBefore&&process.env.ASSET_FAILURE!=='1')await page.waitForFunction(()=>!!window.__spinwardCity.colonyBuildings.balconyAssets)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  await page.keyboard.press('Escape');await page.waitForTimeout(1200)
 }
 await visit('m=f&rpm=0&t=.42')
 const entries=await page.evaluate(()=>window.__spinwardCity.colonyBuildings.entries.filter(e=>!e.interior&&e.design.use.primary==='apartments'&&e.spec.building.height<50&&Math.abs(e.spec.building.azimuth)<.3&&Math.abs(e.spec.building.axial)<700).map(e=>({spec:e.spec,design:e.design,matrix:e.matrix.elements})))
 const candidates=entries.map(e=>{const balconies=colonyBalconies(e.spec,e.design);return {...e,style:balconies.style,life:planBalconyLife(e.spec,balconies)}}).sort((a,b)=>Math.hypot(a.spec.building.azimuth*3200,a.spec.building.axial)-Math.hypot(b.spec.building.azimuth*3200,b.spec.building.axial))
 const targets=['solid','rail'].map(name=>{
  const e=candidates.find(e=>e.style===name&&e.life.some(b=>b.props.some(p=>p.kind==='chair'&&p.y<18)))
  if(!e)throw Error('No representative residential balcony')
  const p=e.life.flatMap(b=>b.props).find(p=>p.kind==='chair'&&p.y<18)
  return {name,frame:e.matrix,at:[p.x,p.y,p.z],building:e.spec.building}
 })
 evidence.targets=targets
 for(const target of targets){
  const matrix=new Matrix4().fromArray(target.frame), at=new Vector3(...target.at)
  for(const view of [{name:'near',offset:[2.5,2.1,4.2],time:.42},{name:'detail',offset:[.8,2.6,.8],time:.42},{name:'night',offset:[2.5,2.1,4.2],time:.02},{name:'medium',offset:[3,5,31],time:.42},{name:'far',offset:[3,8,120],time:.42}]){
   if(process.env.VIEWS&&!process.env.VIEWS.split(',').includes(view.name))continue
   const p=at.clone().add(new Vector3(...view.offset)).applyMatrix4(matrix),aim=at.clone().add(new Vector3(.6,.45,0)).applyMatrix4(matrix),up=new Vector3(0,1,0).transformDirection(matrix)
   const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p,aim,up))
   // Share URLs place the body; the camera is 1.8m along the rotated local up.
   const body=p.clone().add(new Vector3(0,-1.8,0).applyQuaternion(q))
   await visit(`m=f&rpm=0&p=${body.toArray()}&q=${q.toArray()}&t=${view.time}`)
   const projected=await page.evaluate(point=>{const camera=window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera',true)[0];return camera.position.clone().fromArray(point).project(camera).toArray()},aim.toArray())
   const frameLimit=['near','detail','night'].includes(view.name)?.1:.95
   if(Math.abs(projected[0])>frameLimit||Math.abs(projected[1])>frameLimit||projected[2]<-1||projected[2]>1)throw Error('Furniture inspection target is off-camera: '+projected)
   const data=await page.evaluate(()=>{
    const c=window.__spinwardCity.colonyBuildings,stats=c.group.userData,items=[]
    for(const [key,mesh]of c.batches)if(key.startsWith('balcony-chair-')||key.startsWith('balcony-table-')){
     for(let i=0;i<mesh.count;i++){
      const actual=mesh.matrix.clone();mesh.getMatrixAt(i,actual)
      let found=false
      for(const e of c.entries)for(const bay of e.life??[])for(const p of bay.props){
       if(!key.includes(p.kind))continue
       const expected=e.matrix.clone().multiply(mesh.matrix.clone().makeTranslation(p.x,p.y,p.z))
       if(actual.elements.every((v,j)=>Math.abs(v-expected.elements[j])<.001)){found=true;items.push({key,building:e.spec.building,bay:bay.key,prop:p});break}
      }
      if(!found)throw Error('Furniture is detached or not metric: '+key+'/'+i)
     }
    }
    let plantAttachments=0
    const pots=c.batches.get('planters'),leaves=c.batches.get('planting')
    const matches=(mesh,expected)=>{for(let i=0;i<mesh.count;i++){const m=mesh.matrix.clone();mesh.getMatrixAt(i,m);if(m.elements.every((v,j)=>Math.abs(v-expected.elements[j])<.001))return true}return false}
    for(const e of c.entries)for(const bay of e.life??[])for(const p of bay.props)if(p.kind==='plant'){
     const expected=e.matrix.clone().multiply(pots.matrix.clone().makeScale(p.width,.2,p.depth).setPosition(p.x,p.y+.1,p.z))
     if(!matches(pots,expected))continue
     const h=p.height-.16,leaf=e.matrix.clone().multiply(leaves.matrix.clone().makeScale(p.width*.94,h,p.depth*.94).setPosition(p.x,p.y+.16+h/2,p.z))
     if(!matches(leaves,leaf))throw Error('Balcony leaves are detached from their pot')
     const vertices=pots.geometry.attributes.position;let bottom=Infinity
     for(let i=0;i<vertices.count;i++)bottom=Math.min(bottom,vertices.getY(i))
     if(Math.abs(.1+.2*bottom)>.00001)throw Error('Pot bottom is not on the balcony deck')
     plantAttachments++
    }
    if(plantAttachments!==(stats.balconyLifePlants??0))throw Error('Visible balcony planting does not match its supports')
    if((stats.balconyLifeBays??0)>24)throw Error('Furnishing budget exceeded')
    const hash=values=>{let h=2166136261;for(const x of values){h=Math.imul(h^Math.round(x*1e5),16777619)}return h>>>0}
    const windowFrames=c.batches.get('window-frames')
    return {stats,items,plantAttachments,windowFrameHash:hash(windowFrames.instanceMatrix.array.slice(0,windowFrames.count*16)),batches:[...c.batches].filter(([k])=>k.startsWith('balcony-')).map(([name,m])=>({name,count:m.count,triangles:m.count*(m.geometry.index?.count??m.geometry.attributes.position.count)/3})),asset:!!c.balconyAssets}
   })
   const balcony=await page.evaluate(probeBalconies)
   const targetItems=data.items.filter(item=>Math.abs(item.building.azimuth-target.building.azimuth)<1e-6&&Math.abs(item.building.axial-target.building.axial)<1e-6)
   if(!isBefore&&view.name==='far'&&targetItems.length)throw Error('Distant target furniture retained')
   if(!isBefore&&process.env.ASSET_FAILURE!=='1'&&view.name==='near'&&!data.stats.balconyLifeChairs)throw Error('Near furniture never rendered')
   if(process.env.ASSET_FAILURE==='1'&&(data.asset||data.items.length))throw Error('Failed asset retained invalid furniture')
   const filename=`balcony-life-${tier}-${label}-${target.name}-${view.name}.png`
   await page.screenshot({path:out+filename});evidence.views.push({target:target.name,view:view.name,url:page.url(),filename,...data,balcony,projected})
   console.log(target.name,view.name,JSON.stringify(data.stats))
  }
 }
 if(evidence.errors.length)throw Error(evidence.errors.join('\n'))
}finally{await fs.writeFile(out+`balcony-life-${tier}-${label}.json`,JSON.stringify(evidence,null,2));await browser.close()}
