import {test,expect} from 'playwright-webxr'
import {aimQuaternion} from 'playwright-webxr/examples/aim-controller'
import fs from 'node:fs/promises'
test.use({xrStereoEnabled:true,xrIpd:.064,viewport:{width:1600,height:1000}})
test('bands: presentation details at physical ends and regional controls',async({page,xr},info)=>{
 test.setTimeout(240000);const edges=[]
 await page.goto('/?world=colony&walk=1');await page.waitForFunction(()=>window.__plateau?.detailsReady,null,{timeout:120000})
 for(const region of ['tokyo','tama','azumino']){
  await page.click(`[data-region=${region}]`);await page.waitForFunction(()=>window.__plateau.detailsReady)
  for(const side of [-1,1]){
   await page.evaluate(side=>{const w=window.__plateau,s=w.study.samples.find(s=>s.id===w.state.selected),point=[500-s.anchor.local[0],side*19988-s.anchor.local[1]],world=w.walkWorlds.get(s.id);w.navigation.data.destinations.push({id:'qa-edge',label:'QA structural edge',point,ground:world.ground(...point),yaw:side>0?0:Math.PI});w.visitDestination('qa-edge')},side)
   await page.waitForFunction(()=>window.__plateau.detailsReady);await page.screenshot({path:info.outputPath(`${region}-${side}-structural-end.png`)})
   edges.push(await page.evaluate(side=>{const w=window.__plateau,world=w.walkWorlds.get(w.state.selected),s=w.walk,b=world.data.bounds;return{region:w.state.selected,side,contact:w.groundProbe(),edgeBlocks:world.blocked(s.x,side<0?b[1]+.1:b[3]-.1)}},side));expect(edges.at(-1).edgeBlocks).toBe(true)
   await page.evaluate(()=>{const n=window.__plateau.navigation;n.data.destinations=n.data.destinations.filter(d=>d.id!=='qa-edge')})
  }
 }
 await page.setViewportSize({width:390,height:844})
 for(const region of ['tokyo','tama','azumino']){
  if(await page.locator('#menu-toggle').getAttribute('aria-expanded')==='false')await page.click('#menu-toggle')
  await page.click(`[data-region=${region}]`);await page.locator('#return-home').scrollIntoViewIfNeeded();await expect(page.locator('#return-home')).toBeVisible();await page.screenshot({path:info.outputPath(`${region}-mobile-return.png`)});await page.click('#return-home');await page.waitForFunction(()=>window.__plateau.detailsReady)
 }
 await page.setViewportSize({width:2560,height:960});await xr.enterVR()
 await xr.setHeadPose({position:[0,1.65,0],euler:[-.38,0,0]});await xr.setControllerPose('left',{position:[-.18,1.38,-.42],quaternion:[0,0,0,1]});await xr.waitForFrames(5)
 for(const region of ['tokyo','tama','azumino']){
  const target=await page.evaluate(id=>window.__plateau.wrist.trackingTarget(id,window.__plateau.xrRig),region),origin=[.2,1.35,-.15];await xr.setControllerPose('right',{position:origin,quaternion:aimQuaternion(origin,target)});await xr.waitForFrames(3);await xr.pressButton('right','trigger');await xr.waitForFrames(5);await page.waitForFunction(()=>window.__plateau.detailsReady)
  await xr.screenshot(info.outputPath(`${region}-wrist-regions.png`),{canvas:'#study-world',metadata:true})
 }
 await xr.endSession();await fs.writeFile(info.outputPath('edges.json'),JSON.stringify(edges,null,2))
})
