import fs from 'node:fs'
import * as T from 'three'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], samples = []
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
    page.on('pageerror', error => errors.push(error.message))
    const params = `debug&stats&preset=izma&t=${phone ? '.9' : '.42'}&tier=${phone ? 'phone' : 'desktop'}&dpr=1`
    await page.goto(base + '/?' + params)
    await page.waitForFunction(() => window.__spinwardCity?.trafficKitBacked)
    const crossing = await page.evaluate(() => {
      const c = window.__spinwardCity, r = window.__spinward.radius
      const all = [...new Set(c.trafficRoutes.flatMap(route => route.signals ?? []).map(stop => stop.crossing))]
      return all.filter(x => ['avenue', 'street'].every(kind => c.trafficRoutes.some(route => route.kind === kind && route.signals?.some(s => s.crossing === x))))
        .sort((a,b) => Math.hypot(a.azimuth*r,a.axial)-Math.hypot(b.azimuth*r,b.axial))[0]
    })
    if (!crossing) throw Error('No real two-road signalled traffic fixture')
    const radius = 3200, a = crossing.azimuth + (crossing.avenueWidth/2+3)/radius, ax = crossing.axial-30
    const position = new T.Vector3(Math.cos(a)*(radius-(phone?1.6:1.8)),ax,Math.sin(a)*(radius-(phone?1.6:1.8)))
    const target = new T.Vector3(Math.cos(crossing.azimuth)*(radius-3),crossing.axial,Math.sin(crossing.azimuth)*(radius-3))
    const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(position,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))))
    const url = `${base}/?${params}&m=g&a=${a}&ax=${ax}&q=${q.toArray()}`
    for (const kind of ['avenue','street']) for (const direction of [1,-1]) {
      await page.goto(url)
      await page.waitForSelector('#splash',{state:'detached'})
      await page.waitForFunction(() => window.__spinwardCity?.trafficKitBacked && window.__spinwardIntersections?.heads.mesh.count > 0)
      const fixture = await page.evaluate(({crossing,kind,direction}) => {
        document.querySelector('.lil-gui')?.remove()
        const c=window.__spinwardCity, radius=window.__spinward.radius
        const route = c.trafficRoutes.find(r=>r.kind===kind && r.signals?.some(s=>Math.abs(s.crossing.azimuth-crossing.azimuth)<1e-7&&Math.abs(s.crossing.axial-crossing.axial)<.01))
        if (!route) throw Error('No live route for '+kind)
        const stop=route.signals.find(s=>Math.abs(s.crossing.azimuth-crossing.azimuth)<1e-7&&Math.abs(s.crossing.axial-crossing.axial)<.01)
        // Isolate one already-compiled route, mirroring its lane when testing
        // the opposite approach. Normal motion, signal clock and render remain.
        if(route.direction!==direction){if(kind==='avenue')route.laneAzimuth=2*crossing.azimuth-route.laneAzimuth;else route.laneAxial=2*crossing.axial-route.laneAxial}
        route.direction=direction; route.speedMetersPerSecond=8
        const along=stop.along-direction*(stop.lineOffset+25)
        route.motion={progress:direction===1?along-route.spanStart:route.spanStart+route.spanLength-along,speed:8}
        c.neighborhoodTurn=null;c.crossingGate=null;c.trafficRoutes=[route]
        c.trafficMeshes.forEach((mesh,i)=>mesh.count=i===0?1:0)
        c.trafficTime=((kind==='avenue'?18:2)-stop.phase+32)%32
        window.signalFixture={route,stop}
        return {phase:stop.phase,lineOffset:stop.lineOffset,along:stop.along}
      },{crossing,kind,direction})
      await page.waitForTimeout(5500)
      const read = () => page.evaluate(kind => {
        const c=window.__spinwardCity, f=window.__spinwardIntersections,{route,stop}=window.signalFixture
        const progress=((route.motion.progress%route.spanLength)+route.spanLength)%route.spanLength
        const along=route.direction===1?route.spanStart+progress:route.spanStart+route.spanLength-progress
        const phase=((c.trafficTime+stop.phase-(kind==='street'?16:0))%32+32)%32
        const aspect=phase<10?0:phase<13?1:2
        const head=f.headPhases.findIndex((p,i)=>Math.abs(p-stop.phase)<1e-7&&f.headRoads[i]===kind)
        if(head<0)throw Error('Fixture signal is not rendered')
        const colors=[0,1,2].map(i=>{const color=f.lamps.mesh.material.color.clone();f.lamps.mesh.getColorAt(head*3+i,color);return Math.max(color.r,color.g,color.b)})
        return {clock:c.trafficTime,renderClock:f.elapsed,aspect,colors,speed:route.motion.speed,progress:route.motion.progress,lineDistance:(stop.along-along)*route.direction-stop.lineOffset}
      },kind)
      const stopped=await read()
      if(stopped.aspect!==2||Math.abs(stopped.lineDistance-2.7)>.1||stopped.speed>.08||Math.abs(stopped.clock-stopped.renderClock)>1e-8||stopped.colors[2]<.9)throw Error('Red stop/display mismatch: '+JSON.stringify(stopped))
      const name=`signal-${phone?'phone-night':'desktop-day'}-${kind}-${direction}`
      await page.screenshot({path:out+name+'-red.png'})
      await page.evaluate(kind=>{const c=window.__spinwardCity; c.trafficTime=((kind==='avenue'?2:18)-window.signalFixture.stop.phase+32)%32},kind)
      await page.waitForTimeout(3000)
      const moving=await read()
      if(moving.aspect!==0||moving.progress-stopped.progress<5||moving.speed<3||moving.colors[0]<.9)throw Error('Green failed to release traffic: '+JSON.stringify(moving))
      await page.screenshot({path:out+name+'-green.png'})
      samples.push({name,crossing,fixture,stopped,moving});console.log(JSON.stringify({name,stopDistance:stopped.lineDistance,stopSpeed:stopped.speed,greenTravel:moving.progress-stopped.progress}))
    }
    await page.close()
  }
  fs.writeFileSync(out+'intersection-signals.json',JSON.stringify({errors,samples},null,2))
  if(errors.length)throw Error(JSON.stringify(errors))
} finally { await browser.close() }
