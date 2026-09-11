import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base=process.env.SPINWARD_URL??'https://127.0.0.1:5192',out=fileURLToPath(new URL('.',import.meta.url))
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],reports=[]
try {
  for(const preset of (process.env.PRESET ? [process.env.PRESET] : ['izma','cooper'])) {
    const phone=preset==='cooper',page=await browser.newPage({ignoreHTTPSErrors:true,viewport:phone?{width:390,height:844}:{width:1440,height:1000},hasTouch:phone})
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`${base}/?debug&stats&preset=${preset}&tier=${phone?'phone':'desktop'}&t=.42&m=g&a=0&ax=300`)
    await page.waitForSelector('#splash',{state:'detached'})
    await page.waitForFunction(()=>window.__spinwardCity?.trafficKitBacked&&window.__spinwardIntersections?.heads.mesh.count>0)
    await page.waitForTimeout(5000)
    const report=await page.evaluate(async duration=>{
      const c=window.__spinwardCity,f=window.__spinwardIntersections,radius=window.__spinward.radius
      const previous=new Map(),aspects=new Set(),stoppedVehicles=new Set(),events=[],overlapPairs=new Set(),overlapEvents=[]
      let frames=0,redEntries=0,entries=0,stopped=0,clockMismatch=0,overlaps=0,minLaneGap=Infinity
      const until=performance.now()+duration
      while(performance.now()<until){
        frames++;if(Math.abs(c.getTrafficClock()-f.elapsed)>1e-8)clockMismatch++
        const lamps=f.lamps.mesh.instanceColor,lit=new Map()
        for(let i=0;i<f.headPhases.length;i++){
          const powers=[0,1,2].map(l=>Math.max(lamps.getX(i*3+l),lamps.getY(i*3+l),lamps.getZ(i*3+l)))
          lit.set(f.headPhases[i]+':'+f.headRoads[i],powers.indexOf(Math.max(...powers)))
        }
        const lanes=new Map()
        c.trafficRoutes.forEach((route,index)=>{
          if(radius-route.surfaceRadius>=1||(c.neighborhoodTurn&&index===c.trafficRoutes.length-1))return
          const progress=((route.motion.progress%route.spanLength)+route.spanLength)%route.spanLength
          const along=route.direction===1?route.spanStart+progress:route.spanStart+route.spanLength-progress
          for(const stop of route.signals??[]){
            const aspect=lit.get(stop.phase+':'+route.kind);if(aspect===undefined)continue
            const line=(stop.along-along)*route.direction-stop.lineOffset,key=index+':'+stop.phase+':'+stop.along
            const prev=previous.get(key)
            if(prev&&prev.line>0&&line<=0&&prev.line-line<5){
              entries++;if(aspect===2&&prev.aspect===2){redEntries++;if(events.length<20)events.push({index,road:route.kind,phase:stop.phase,before:prev.line,line,clock:c.getTrafficClock(),speed:route.motion.speed})}
            }
            previous.set(key,{line,aspect})
            if(line>-10&&line<80)aspects.add(aspect)
            if(aspect===2&&Math.abs(line-2.7)<.12&&route.motion.speed<.08){stopped++;stoppedVehicles.add(index)}
          }
          const key=[route.kind,route.laneAzimuth,route.laneAxial,route.direction].join(':')
          const lane=lanes.get(key)??[];lane.push({index,along,span:route.spanLength});lanes.set(key,lane)
        })
        for(const lane of lanes.values()){
          lane.sort((a,b)=>a.along-b.along)
          for(let i=0;i<lane.length-1;i++){
            const gap=lane[i+1].along-lane[i].along;minLaneGap=Math.min(minLaneGap,gap)
            if(gap<4.4){
              overlaps++;const pair=lane[i].index+':'+lane[i+1].index
              if(!overlapPairs.has(pair))overlapEvents.push({pair,gap,clock:c.getTrafficClock(),routes:[lane[i],lane[i+1]].map(car=>{
                const r=c.trafficRoutes[car.index]
                return {...car,kind:r.kind,laneAzimuth:r.laneAzimuth,laneAxial:r.laneAxial,direction:r.direction,spanStart:r.spanStart,spanLength:r.spanLength,surfaceRadius:r.surfaceRadius,progress:r.motion.progress,speed:r.motion.speed}
              })})
              overlapPairs.add(pair)
            }
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      const loopOverlap=Math.max(0,...c.trafficRoutes.filter(r=>r.kind==='street').map(r=>r.spanLength-2*Math.PI*radius))
      return {frames,entries,redEntries,stopped,stoppedVehicles:stoppedVehicles.size,aspects:[...aspects],clockMismatch,minLaneGap,overlaps,overlapPairs:[...overlapPairs],overlapEvents,events,routeCount:c.trafficRoutes.length,signalHeads:f.heads.mesh.count,loopOverlap}
    },Number(process.env.DURATION_MS??85000))
    await page.evaluate(()=>document.querySelector('.lil-gui')?.remove())
    await page.screenshot({path:out+`signal-flow-${preset}.png`})
    reports.push({preset,...report});console.log(JSON.stringify({preset,...report}));await page.close()
  }
  fs.writeFileSync(out+`traffic-signal-flow${process.env.PREFIX?'-'+process.env.PREFIX:''}.json`,JSON.stringify({errors,reports},null,2))
  if(errors.length||reports.some(r=>r.redEntries||r.clockMismatch||!r.stopped||!r.entries||r.loopOverlap>.01||(process.env.EXPECT_SPACING==='1'&&r.overlaps)))throw Error('Signal flow probe failed')
}finally{await browser.close()}
