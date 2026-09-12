import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const temp=await fs.mkdtemp('/private/tmp/spinward-rain-shader-'),bundle=temp+'/probe.js'
execFileSync('bun',['build',fileURLToPath(new URL('./rain-shader.ts',import.meta.url)),'--target','browser','--outfile',bundle],{stdio:'pipe'})
const browser=await chromium.launch({channel:'chrome',headless:true}),evidence={errors:[]}
try{
 const page=await browser.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text())})
 await page.goto('about:blank');evidence.gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),d=gl.getExtension('WEBGL_debug_renderer_info'),r=gl.getParameter(d.UNMASKED_RENDERER_WEBGL);gl.getExtension('WEBGL_lose_context')?.loseContext();return r});if(/SwiftShader|Software|llvmpipe/i.test(evidence.gpu))throw Error('Hardware GPU required')
 await page.addScriptTag({path:bundle});evidence.results=await page.evaluate(()=>window.runRainShaderProbe());if(evidence.errors.length)throw Error(JSON.stringify(evidence.errors));console.log(JSON.stringify(evidence))
}finally{await fs.writeFile(fileURLToPath(new URL('./rain-shader-result.json',import.meta.url)),JSON.stringify(evidence,null,2));await browser.close();await fs.rm(temp,{recursive:true,force:true})}
