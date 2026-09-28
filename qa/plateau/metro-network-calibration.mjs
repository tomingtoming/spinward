// Isolate the test instrument: small static transfers, with no simulation.
import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
import {X509Certificate,createHash} from 'node:crypto'
const url=process.env.SPINWARD_METRO_URL,out=process.env.SPINWARD_METRO_EVIDENCE
if(!url||!out)throw Error('Set candidate URL and evidence output')
const cert=new X509Certificate(await fs.readFile(new URL('../../node_modules/.vite/basic-ssl/_cert.pem',import.meta.url)))
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64')
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-certificate-errors-spki-list='+spki]})
const rows=[]
try{
  const page=await browser.newPage();page.setDefaultNavigationTimeout(10000)
  await page.goto(url+'/manifest.webmanifest')
  const entry=await page.evaluate(async()=>{const html=await(await fetch('/')).text();return /src="([^"]+\.js)"/.exec(html)?.[1]})
  if(!entry)throw Error('No application entry in candidate HTML')
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable')
  for(const mode of ['plain','legacy','rule']){
    if(mode==='legacy')await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1250000,uploadThroughput:1250000})
    if(mode==='rule'){
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
      await cdp.send('Network.emulateNetworkConditionsByRule',{matchedNetworkConditions:[{urlPattern:'',latency:100,downloadThroughput:1250000,uploadThroughput:1250000}]})
    }
    for(let n=0;n<3;n++){
      const r=await page.evaluate(async entry=>{
        const at=performance.now()
        try{const r=await fetch(entry,{cache:'reload',signal:AbortSignal.timeout(5000)}),body=await r.arrayBuffer();return{elapsed:performance.now()-at,bytes:body.byteLength,status:r.status}}
        catch(e){return{elapsed:performance.now()-at,error:String(e)}}
      },entry);rows.push({mode,...r});console.log(JSON.stringify(rows.at(-1)))
    }
  }
}finally{await browser.close();await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/network-calibration.json',JSON.stringify(rows,null,2))}
