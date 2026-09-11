// Compare the same night facade with individual detail batches hidden.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const prefix=process.env.PREFIX??'window-occlusion'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base+'/?debug&stats&lock=0&preset=izma&t=.9&tier=desktop&dpr=1')
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity?.colonyBuildings.group.userData.asset)
  await page.getByRole('button', { name: 'Overlook', exact: true }).click()
  await page.waitForTimeout(2300)
  await page.evaluate(() => {
    document.querySelector('.lil-gui')?.remove()
    const scene=window.__spinwardScene,camera=scene.getObjectByName('coffee-held').parent
    const world=camera.matrixWorld.clone(),inverse=camera.matrixWorldInverse.clone()
    scene.onBeforeRender=(_renderer,_scene,active)=>{if(active===camera){camera.matrixWorld.copy(world);camera.matrixWorldInverse.copy(inverse)}}
    const origin=camera.position.clone().setFromMatrixPosition(world)
    const direction=camera.position.clone().set(.67,.2,.5).unproject(camera).sub(origin).normalize()
    const colony=window.__spinwardCity.colonyBuildings,hits=[]
    const sources=[...colony.entries.map(entry=>({entry,frame:colony.group.matrixWorld.clone().multiply(entry.matrix),kind:'colony'})),
      ...window.__spinwardCity.authoredBlock.entries.map(entry=>({entry,frame:entry.group.matrixWorld.clone(),kind:'authored'}))]
    for(const {entry,frame,kind} of sources) {
      const inverseFrame=frame.invert()
      const o=origin.clone().applyMatrix4(inverseFrame),d=direction.clone().transformDirection(inverseFrame)
      entry.spec.volumes.forEach((v,index)=>{
        let near=0,far=Infinity
        for(const [axis,extent] of [['x','w'],['y','h'],['z','d']]) {
          if(Math.abs(d[axis])<1e-10){if(Math.abs(o[axis]-v[axis])>v[extent]/2)far=-1;continue}
          const t1=(v[axis]-v[extent]/2-o[axis])/d[axis],t2=(v[axis]+v[extent]/2-o[axis])/d[axis]
          near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2))
        }
        if(near<=far)hits.push({distance:near,index,kind,spec:entry.spec,design:entry.design})
      })
    }
    window.facadeProbeHits=hits.sort((a,b)=>a.distance-b.distance).slice(0,4)
  })
  for (const hidden of ['', 'stair-metal', 'balconies', 'trim', 'window-frames']) {
    const data = await page.evaluate(hidden => {
      const c = window.__spinwardCity.colonyBuildings
      for (const [name, batch] of c.batches) batch.visible = name !== hidden
      return { hidden, hits:window.facadeProbeHits, state: window.__spinward, batches: [...c.batches].map(([name,b])=>({name,count:b.count,visible:b.visible})) }
    }, hidden)
    await page.waitForTimeout(100)
    await page.screenshot({ path: out+`${prefix}-${hidden || 'baseline'}.png` })
    reports.push(data)
  }
  if (process.env.CAPTURE_LODS) for (const lod of [0,1,2,3]) {
    await page.evaluate(lod => { const url=new URL(location.href);url.searchParams.set('blockLod',String(lod));history.replaceState(null,'',url);for(const batch of window.__spinwardCity.colonyBuildings.batches.values())batch.visible=true },lod)
    await page.waitForTimeout(600)
    await page.screenshot({path:out+`${prefix}-lod${lod}.png`})
    reports.push({lod,blocks:await page.evaluate(()=>window.__spinwardCity.authoredBlock.group.userData)})
  }
  fs.writeFileSync(out+prefix+'.json', JSON.stringify({ errors, reports }, null, 2))
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
