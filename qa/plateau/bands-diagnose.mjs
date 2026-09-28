import {chromium} from 'playwright'
import fs from 'node:fs/promises'
const url=process.env.PLATEAU_STUDY_URL;if(!url)throw Error('Set PLATEAU_STUDY_URL')
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});await page.goto(url+'/?world=colony&region=tama&walk=1');await page.waitForFunction(()=>window.__plateau?.detailsReady,null,{timeout:120000});await page.selectOption('#destination','station-京王堀之内');await page.click('#travel');await page.waitForFunction(()=>window.__plateau.detailsReady,null,{timeout:90000})
 const report=await page.evaluate(()=>{const w=window.__plateau;return{state:w.state,walk:w.walk,rays:[[0,0],[-.6,0],[.6,0],[0,.7],[0,-.7]].map(p=>({p,hits:w.raycast(...p)})),base:w.baseTiles.get('tama').diagnostics(),near:[...w.baseTiles.get('tama').entries.values()].filter(e=>e.distance===0).map(e=>({id:e.tile.id,bytes:e.tile.decodedBytes,status:e.status,distance:e.distance,bounds:e.tile.bounds,buildings:e.tile.buildingIds}))}})
 await fs.writeFile('qa/webxr/evidence/plateau-bands-20260923/horinouchi-diagnostic.json',JSON.stringify(report,null,2));console.log(JSON.stringify({walk:report.walk,rays:report.rays,near:report.near.map(v=>({...v,buildings:v.buildings.length}))},null,2))
}finally{await browser.close()}
