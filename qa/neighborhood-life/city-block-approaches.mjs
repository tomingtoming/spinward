const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import * as T from 'three';
const out=fileURLToPath(new URL('.',import.meta.url)),placements=JSON.parse(fs.readFileSync(new URL('../../assets/blender/city-block-expansion.json',import.meta.url),'utf8'));
const lod=process.env.BLOCK_LOD;
if(lod!==undefined&&!['0','1','2'].includes(lod))throw Error('BLOCK_LOD must be 0, 1 or 2');
const suffix=lod===undefined?'':'-lod'+lod;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const reports=[];for(const side of [-1,1])for(const model of ['residential','office','commercial']){
 const {building:b}=placements.filter(p=>p.model===model&&p.building.front.axis==='tangent'&&p.building.front.side===side).sort((p,q)=>Math.hypot((p.building.azimuth-.05)*3200,p.building.axial)-Math.hypot((q.building.azimuth-.05)*3200,q.building.axial))[0];
 const a=b.azimuth+side*(b.width/2+5)/3200,pos=new T.Vector3(Math.cos(a)*3197.2,b.axial-side*4,Math.sin(a)*3197.2),target=new T.Vector3(Math.cos(b.azimuth)*3199.85,b.axial,Math.sin(b.azimuth)*3199.85),q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos,target,new T.Vector3(-Math.cos(a),0,-Math.sin(a))));
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`https://127.0.0.1:5192/?debug&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=.42&dpr=1${lod===undefined?'':'&blockLod='+lod}`);await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardCity.authoredBlock.group.userData.buildings.every(b=>b.asset));await page.waitForTimeout(500);await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())});await page.screenshot({path:out+'block-approach-tangent-'+side+'-'+model+suffix+'.png'});reports.push({model,side,building:b,errors});if(errors.length)throw Error(errors.join('\n'));await page.close();
}fs.writeFileSync(out+'city-block-approaches'+suffix+'.json',JSON.stringify(reports));console.log('All six tangent-facing approaches rendered without JavaScript errors.')}finally{await browser.close()}
