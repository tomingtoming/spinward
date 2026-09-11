// Real rain viewed from the street, occupied cafe, apartment and open court.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',out=fileURLToPath(new URL('.',import.meta.url)),prefix=process.env.PREFIX??'rain-rooms'
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],reports=[]
try {
 for(const config of [{preset:'izma',tier:'desktop',time:'.42'},{preset:'cooper',tier:'phone',time:'.9'}]) {
  const phone=config.tier==='phone',page=await browser.newPage({ignoreHTTPSErrors:true,viewport:phone?{width:390,height:844}:{width:1440,height:1000},hasTouch:phone,deviceScaleFactor:1})
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/i.test(m.text()))errors.push(m.text())})
  await page.goto(`${base}/?debug&stats&rain&lock=0&preset=${config.preset}&tier=${config.tier}&t=${config.time}&dpr=1`)
  await page.waitForSelector('#splash',{state:'detached'})
  await page.waitForFunction(()=>window.__spinwardCity?.colonyBuildings.group.userData.asset)
  await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
  for(const place of ['Café','Courtyard',...(config.preset==='izma'?['Apartment']:[])]) {
   await page.getByRole('button',{name:phone?'Travel ▾':'Places ▾',exact:true}).click()
   await page.locator('.preset-menu:not([hidden])').getByRole('button',{name:place,exact:true}).click()
   await page.waitForTimeout(600)
   await page.keyboard.down('w');await page.waitForTimeout(2600);await page.keyboard.up('w')
   await page.waitForTimeout(1000)
   const report=await page.evaluate(()=>{
    let rain;window.__spinwardScene.traverse(o=>{if(o.isLineSegments&&o.geometry.getAttribute('aSeed'))rain=o})
    if(!rain)throw Error('Rain layer unavailable')
    const u=rain.material.uniforms,seeds=rain.geometry.getAttribute('aSeed'),tips=rain.geometry.getAttribute('aTip'),c=window.__spinwardCity
    const camera=window.__spinwardScene.getObjectByName('coffee-held').parent,counts={active:0,insideCoveredRoom:0,projectedInsideRoom:0,maskedInsideRoom:0,unmaskedInsideRoom:0,unmaskedProjectedRoom:0,unmaskedOutsideRoom:0,masked:0}
    const hidden=p=>{
     const habitat=u.uHabitat?.value
     if(habitat&&(p.x*p.x+p.z*p.z>habitat.x*habitat.x||Math.abs(p.y)>habitat.y))return true
     for(let j=0;j<(u.uRoofCount?.value??0);j++) {
      const f=u.uRoofFrames.value[j],b=u.uRoofBounds.value[j]
      if(p.x*f.x+p.z*f.y>=f.w&&Math.abs(-p.x*f.y+p.z*f.x)<=b.x&&Math.abs(p.y-f.z)<=b.y)return true
     }
     return false
    }
    for(let i=0;i<seeds.count;i+=2) {
     const p=u.uCenter.value.clone()
     for(const [axis,method] of [['x','getX'],['y','getY'],['z','getZ']]) {const box=u.uBox.value[axis],v=seeds[method](i)*box+u.uOffset.value[axis]-u.uCenter.value[axis];p[axis]+=((v%box)+box)%box-box/2}
     const edge=p.clone().sub(u.uCenter.value).divide(u.uBox.value.clone().multiplyScalar(.5)).length()
     if(edge>=1)continue
     counts.active++
     const masked=hidden(p)||hidden(p.clone().add(u.uStreak.value))
     if(masked)counts.masked++
     let inside=false
     const radial=Math.hypot(p.x,p.z),altitude=c.radius-radial,azimuth=Math.atan2(p.z,p.x)
     for(const {interior} of c.interiorLayer.entries) {
      if(interior.kind==='court'||altitude<.2||altitude>3)continue
      const b=interior.building,t=Math.atan2(Math.sin(azimuth-b.azimuth),Math.cos(azimuth-b.azimuth))*c.radius,a=p.y-b.axial
      if(Math.abs(t)<b.width/2-.3&&Math.abs(a)<b.depth/2-.3) {
       counts.insideCoveredRoom++
       inside=true
       if(masked)counts.maskedInsideRoom++;else counts.unmaskedInsideRoom++
       const projected=p.clone().applyMatrix4(rain.matrixWorld).project(camera)
       if(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1){counts.projectedInsideRoom++;if(!masked)counts.unmaskedProjectedRoom++}
       break
      }
     }
     if(!inside&&!masked)counts.unmaskedOutsideRoom++
    }
    return {state:window.__spinward,visible:rain.visible,intensity:u.uIntensity.value,roofCount:u.uRoofCount?.value??0,counts,stats:document.querySelector('.stats-overlay')?.textContent}
   })
   await page.screenshot({path:out+`${prefix}-${config.preset}-${place.toLowerCase().replace('é','e')}.png`})
   reports.push({...config,place,...report});console.log(JSON.stringify({config,place,visible:report.visible,shelter:report.state.room.shelter,counts:report.counts,roofCount:report.roofCount}))
   if(process.env.VERIFY) {
    if(report.counts.unmaskedInsideRoom)throw Error(`${config.preset} ${place}: unmasked room rain`)
    if(report.counts.unmaskedOutsideRoom<20)throw Error(`${config.preset} ${place}: outdoor shower missing`)
    if(place!=='Courtyard'&&(report.state.room.shelter<.9||report.counts.insideCoveredRoom<5))throw Error(`${config.preset} ${place}: insufficient indoor coverage`)
   }
   if(process.env.OUTWARD && place!=='Courtyard') {
    await page.keyboard.down('ArrowLeft');await page.waitForTimeout(2245);await page.keyboard.up('ArrowLeft')
    await page.waitForTimeout(400)
    await page.screenshot({path:out+`${prefix}-${config.preset}-${place.toLowerCase().replace('é','e')}-outward.png`})
   }
  }
  await page.close()
 }
 fs.writeFileSync(out+prefix+'.json',JSON.stringify({errors,reports},null,2))
 if(errors.length)throw Error(JSON.stringify(errors))
}finally{await browser.close()}
