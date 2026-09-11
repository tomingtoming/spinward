import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const prefix=process.env.PREFIX??'dock'
const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(new T.Vector3(3198.4,-200,0),new T.Vector3(3199.78,-199.35,0),new T.Vector3(-1,0,0)))
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1}),errors=[],samples=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+`/?debug&m=g&a=0&ax=-200&t=.42&tier=phone&q=${q.toArray()}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
  await page.evaluate(()=>{document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())})
  const snapshot=async(name)=>{
    await page.waitForTimeout(100)
    const state=await page.evaluate(name=>{
      const dock=document.querySelector('.dock'),rect=dock.getBoundingClientRect(),more=document.querySelector('.dock-more')
      const buttons=[...dock.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>({label:b.textContent,rect:b.getBoundingClientRect().toJSON()}))
      const mobile=document.querySelector('.mobile-controls').getBoundingClientRect()
      return {name,width:innerWidth,height:innerHeight,dock:rect.toJSON(),expanded:more.getAttribute('aria-expanded'),buttons,mobile:mobile.toJSON()}
    },name)
    if(state.buttons.some(b=>b.rect.x<0||b.rect.right>state.width+.5||b.rect.bottom>state.height))throw Error('Control outside viewport: '+name)
    if(state.mobile.height&&state.mobile.bottom>state.dock.top)throw Error('Game actions overlap dock: '+name)
    samples.push(state);await page.screenshot({path:out+prefix+'-'+name+'.png'});return state
  }
  for(const width of [320,390,720]){
    await page.setViewportSize({width,height:844})
    const collapsed=await snapshot('collapsed-'+width)
    if(collapsed.dock.height>50||collapsed.expanded!=='false'||!collapsed.buttons.some(b=>b.label==='Travel ▾'))throw Error('Dock not compact')
    await page.getByRole('button',{name:'More controls',exact:true}).tap()
    const expanded=await snapshot('expanded-'+width)
    if(expanded.dock.height<90||expanded.expanded!=='true'||!expanded.buttons.some(b=>b.label==='Photo'))throw Error('Controls inaccessible')
    await page.getByRole('button',{name:'Sound on',exact:true}).tap();await page.waitForFunction(()=>window.__spinward.room.audio.muted)
    await page.getByRole('button',{name:'Sound off',exact:true}).tap();await page.waitForFunction(()=>!window.__spinward.room.audio.muted)
    await page.getByRole('button',{name:'Rain',exact:true}).tap();await page.waitForFunction(()=>window.__spinward.raining)
    await page.getByRole('button',{name:'Rain',exact:true}).tap();await page.waitForFunction(()=>!window.__spinward.raining)
    await page.keyboard.press('Escape')
    if(await page.getByRole('button',{name:'More controls',exact:true}).getAttribute('aria-expanded')!=='false')throw Error('Escape failed')
    await page.getByRole('button',{name:'Travel ▾',exact:true}).tap()
    if(!await page.locator('.preset-menu:not([hidden])').getByRole('button',{name:'Exterior',exact:true}).isVisible())throw Error('Travel menu lost')
    await page.locator('.dropdown-backdrop').tap({position:{x:10,y:20}})
  }
  await page.setViewportSize({width:1280,height:900});await snapshot('wide')
  if(await page.locator('.dock-more').isVisible())throw Error('Wide-screen toggle should be hidden')
  if(!await page.getByRole('button',{name:'Surface',exact:true}).isVisible())throw Error('Wide Travel buttons lost')
  if(errors.length)throw Error(JSON.stringify(errors))
  fs.writeFileSync(out+prefix+'-layout.json',JSON.stringify({errors,samples},null,2));console.log(JSON.stringify({errors,heights:samples.map(s=>[s.name,s.dock.height])}))
}finally{await browser.close()}
