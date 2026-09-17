import {chromium} from '@playwright/test'
import {Matrix4,Quaternion,Vector3} from 'three'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const base=process.env.SPINWARD_URL
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL(`../webxr/evidence/river-finish-20260917/${process.env.LABEL??'desktop'}/`,import.meta.url))
await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const errors=[],cases=[]
try{
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|context.*lost/i.test(m.text()))errors.push(m.text())})
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const boot=async(query,time)=>{
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${time}&${query}`)
    await page.waitForSelector('#splash',{state:'detached',timeout:60000})
    await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
    if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  }
  await boot('',.42)
  const initial=await page.evaluate(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info')
    return {gpu:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown',data:window.__spinwardCity.authoredLandscape.data}
  })
  if(/unknown|SwiftShader|Software|llvmpipe/i.test(initial.gpu))throw Error('Hardware GPU required: '+initial.gpu)
  const pose=(at,aim,flying=false)=>{
    const r=3200,point=([x,y,h])=>new Vector3(Math.cos(x/r)*(r-h),y,Math.sin(x/r)*(r-h))
    const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0],at[1],at[2]+1.8]),point(aim),new Vector3(-Math.cos(at[0]/r),0,-Math.sin(at[0]/r))))
    return flying?`m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`:`m=g&a=${at[0]/r}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
  }
  const river=initial.data.visits.river.position
  const views=[['bridge','visit=landscape'],['market','visit=shops'],['homes','visit=garden'],
    ['river-arch',pose(river,[12,-80,5.8])],['overview',pose([-280,-225,178],[-115,30,11],true)]]
  for(const [shop,aim] of [['bakery',[-126,-62,10]],['greengrocer',[-128,-43,10]],['books',[-141,-3,11]],['tea',[-78,-22,11]]]){
    const at=initial.data.walks[shop+'-entry'].at(-1)
    views.push([shop,pose(at,aim)])
  }
  for(const [period,time] of [['day',.42],['night',.9]])for(const [name,query] of views){
    if(process.env.VIEWS&&!process.env.VIEWS.split(',').includes(name))continue
    await boot(query,time)
    const state=await page.evaluate(()=>{
      const a=window.__spinwardCity.authoredLandscape,materials=a.group.getObjectByName('landscape-lod-0').children.map(m=>({name:m.name,emission:m.material.emissiveIntensity,map:!!m.material.map}))
      return {mode:window.__spinward.mode,altitude:window.__spinward.groundHeight,world:a.group.userData,materials}
    })
    if(state.world.activeLights>6)throw Error('Local light budget exceeded')
    if(period==='night'&&name==='market'&&state.world.activeLights===0)throw Error('Market has no night light')
    if(period==='day'&&state.world.activeLights!==0)throw Error('Daylight lamps stayed on')
    let frameTimes
    if(name==='market')frameTimes=await page.evaluate(async()=>{
      await new Promise(r=>setTimeout(r,500))
      const times=[];let last=performance.now(),start=last
      await new Promise(resolve=>{const frame=now=>{times.push(now-last);last=now;if(now-start<3000)requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)})
      times.shift();times.sort((a,b)=>a-b)
      return {samples:times.length,median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)}
    })
    await page.screenshot({path:out+period+'-'+name+'.png'})
    cases.push({period,name,state,frameTimes})
  }
  if(errors.length)throw Error(errors.join('; '))
  await fs.writeFile(out+'report.json',JSON.stringify({gpu:initial.gpu,cases,errors},null,2))
  console.log(JSON.stringify({gpu:initial.gpu,cases:cases.length,errors,out}))
}finally{await browser.close()}
