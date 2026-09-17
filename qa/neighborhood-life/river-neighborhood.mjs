import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base=process.env.SPINWARD_URL
if(!base)throw Error('SPINWARD_URL required')
const out=fileURLToPath(new URL(`../webxr/evidence/river-neighborhood-20260917/${process.env.LABEL??'desktop'}/`,import.meta.url))
await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const errors=[],states=[]
try{
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({status:200,body:''}))
  const boot=async query=>{
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&${query}`)
    await page.waitForSelector('#splash',{state:'detached',timeout:60000})
    await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
    if(await page.locator('.tour-notice button').count())await page.locator('.tour-notice button').first().click()
  }
  await boot('')
  const gpu=await page.evaluate(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info')
    return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'
  })
  if(/unknown|SwiftShader|Software|llvmpipe/i.test(gpu))throw Error('Hardware GPU required: '+gpu)
  for(const [name,visit] of [['bridge','landscape'],['market','shops'],['homes','garden'],['river','river']]){
    await boot('visit='+visit)
    states.push({name,state:await page.evaluate(()=>({mode:window.__spinward.mode,h:window.__spinward.groundHeight,world:window.__spinwardCity.authoredLandscape.group.userData}))})
    await page.screenshot({path:out+name+'.png'})
  }
  const r=3200,at=[-280,-225,180],aim=[-115,30,11]
  const point=([x,y,h])=>new Vector3(Math.cos(x/r)*(r-h),y,Math.sin(x/r)*(r-h))
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point(at),point(aim),new Vector3(-Math.cos(at[0]/r),0,-Math.sin(at[0]/r))))
  await boot(`m=f&rpm=0&p=${point([at[0],at[1],at[2]-1.8]).toArray()}&q=${q.toArray()}`)
  await page.screenshot({path:out+'overview.png'})
  if(errors.length)throw Error(errors.join('; '))
  await fs.writeFile(out+'report.json',JSON.stringify({gpu,states,errors},null,2))
  console.log(JSON.stringify({gpu,errors,out}))
}finally{await browser.close()}
