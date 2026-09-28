import {test,expect} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

test('bands: actual rendered contact across three bridges and six city seams',async({page},info)=>{
 test.setTimeout(360000)
 const root=process.env.PLATEAU_DATA_ROOT;if(!root)throw Error('Set PLATEAU_DATA_ROOT')
 const cases=JSON.parse(await fs.readFile(path.join(root,'band-transition-probes.json'))),errors=[],report=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/?world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.detailsReady,null,{timeout:120000})
 for(const item of cases){
  await page.click(`[data-region=${item.region}]`);await page.waitForFunction(()=>window.__plateau.detailsReady)
  const [a,b]=item.points,yaw=Math.atan2(-(b[0]-a[0]),b[1]-a[1])
  await page.evaluate(({point,yaw})=>{const w=window.__plateau;w.navigation.data.destinations.push({id:'qa-transition',label:'QA transition',point,ground:0,yaw});w.visitDestination('qa-transition')},{point:a,yaw});await page.waitForFunction(()=>window.__plateau.detailsReady);await page.evaluate(()=>window.__plateau.advanceWalk(0,0))
  let maxContactErrorM=0,maxStep=0,previous=null
  for(let i=0;i<item.points.length;i++){
   const point=item.points[i]
   const state=await page.evaluate(point=>{const w=window.__plateau,s=w.walk;return w.advanceWalk(point[0]-s.x,point[1]-s.y)},point)
   expect(Math.hypot(state.x-point[0],state.y-point[1])).toBeLessThan(.003)
   if(previous)maxStep=Math.max(maxStep,Math.abs(state.h-previous.h));previous=state
   if(i%8===0||i===item.points.length-1){
    await page.waitForFunction(()=>window.__plateau.detailsReady)
    const probe=await page.evaluate(()=>{const w=window.__plateau;return{hits:w.groundProbe(),blocked:w.walkWorlds.get(w.state.selected).blocked(w.walk.x,w.walk.y)}})
    expect(probe.blocked).toBe(false);expect(probe.hits.length).toBeGreaterThan(0);const error=Math.abs(probe.hits[0].distance-1.65);maxContactErrorM=Math.max(maxContactErrorM,error);expect(error).toBeLessThan(.055)
   }
   if([0,Math.floor(item.points.length/2),item.points.length-1].includes(i))await page.screenshot({path:info.outputPath(`${item.region}-${item.id}-${i}.png`)})
  }
  report.push({region:item.region,id:item.id,samples:item.points.length,maxContactErrorM,maxStep})
  await page.evaluate(()=>{const n=window.__plateau.navigation;n.data.destinations=n.data.destinations.filter(d=>d.id!=='qa-transition')})
 }
 expect(errors).toEqual([]);await fs.writeFile(info.outputPath('transitions.json'),JSON.stringify({report,errors},null,2))
})
