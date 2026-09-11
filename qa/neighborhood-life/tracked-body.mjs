// Deterministic pose injection checks rendered retargeting. It does not
// simulate an XR runtime or establish headset comfort/tracking latency.
import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const out=fileURLToPath(new URL('.',import.meta.url)),base=process.env.SPINWARD_URL??'https://127.0.0.1:5192'
const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(new T.Vector3(3198.2,-200,0),new T.Vector3(3199.78,-199.35,0),new T.Vector3(-1,0,0)))
const gripOrientation=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(0,0,1),new T.Vector3(-1,0,0),new T.Vector3(0,-1,0))).toArray()
const grip=(side,height,reach)=>({position:[3200-height,-200+reach,side],orientation:gripOrientation})
const poses=[
  {name:'rest',eyeHeight:1.8,hands:[grip(-.28,1.2,.28),grip(.28,1.2,.28)]},
  {name:'right-raised',eyeHeight:1.8,hands:[grip(-.28,1.2,.28),grip(.28,1.65,.26)]},
  {name:'crouched',eyeHeight:1.12,hands:[grip(-.25,.73,.26),grip(.25,.83,.3)]},
  {name:'right-lost',eyeHeight:1.8,hands:[grip(-.28,1.2,.28),null]},
  {name:'beyond-reach',eyeHeight:1.8,hands:[grip(-.28,1.2,.28),grip(.6,1.2,1)]}
]
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:1000}}),errors=[],samples=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+`/?debug&m=g&a=0&ax=-200&t=.42&q=${q.toArray()}`)
  await page.waitForSelector('#splash',{state:'detached'});await page.waitForFunction(()=>window.__spinwardBody.group.userData.ready)
  await page.evaluate(()=>{
    document.querySelector('.lil-gui')?.remove();const panels=[];window.__spinwardScene.traverse(o=>{if(o.renderOrder===30)panels.push(o)});panels.forEach(o=>o.removeFromParent())
    const b=window.__spinwardBody,update=b.update.bind(b)
    b.update=frame=>window.__trackedBodySample?update({...frame,azimuth:0,axial:-200,heading:0,tracked:window.__trackedBodySample}):update(frame)
  })
  for(const pose of [...poses,{name:'flat-restored',eyeHeight:1.8,hands:null}]){
    await page.evaluate(p=>{
      window.__trackedBodySample=p.hands?{...p,azimuth:0,axial:-200,heading:0}:null
      window.__spinwardScene.getObjectByName('coffee-held').parent.position.y=p.eyeHeight
    },pose)
    await page.waitForTimeout(400)
    const state=await page.evaluate(()=>{
      const b=window.__spinwardBody
      return {body:b.group.userData,visible:b.group.visible,hands:['right','left'].map(side=>{
        const h=b.root.getObjectByName(side+'_hand'),p=h.getWorldPosition(h.position.clone()),f=b.root.getObjectByName(side+'_forearm')
        return {visible:h.visible,position:p.toArray(),forearm:f.visible,details:['fingers','thumb'].map(part=>b.root.getObjectByName(side+'_hand_'+part)?.visible??false),elbow:b.root.getObjectByName(side+'_elbow').position.toArray()}
      })}
    })
    for(let i=0;i<2&&pose.hands;i++){
      const target=pose.hands[i],actual=state.hands[i]
      if(actual.visible!==!!target)throw Error('Tracking visibility mismatch: '+pose.name)
      if(actual.details.some(visible=>visible!==!!target))throw Error('Hand detail tracking visibility mismatch: '+pose.name)
      if(target&&new T.Vector3().fromArray(actual.position).distanceTo(new T.Vector3().fromArray(target.position))>1e-5)throw Error('Tracked hand moved from grip: '+pose.name)
    }
    if(pose.name==='rest'&&state.hands.some(h=>!h.forearm))throw Error('Ordinary reach lost sleeve')
    if(pose.name==='right-lost'&&state.hands[1].forearm)throw Error('Lost arm remained visible')
    if(pose.name==='beyond-reach'&&state.hands[1].forearm)throw Error('Extreme reach stretched arm')
    if(pose.name==='flat-restored'&&state.hands.some(h=>Math.abs(h.elbow[1]+.282)>1e-5||!h.forearm))throw Error('Flat pose did not restore bind lengths')
    samples.push({name:pose.name,...state});await page.screenshot({path:out+'tracked-'+pose.name+'.png'})
  }
  if(errors.length)throw Error(JSON.stringify(errors))
  fs.writeFileSync(out+'tracked-body.json',JSON.stringify({errors,samples},null,2));console.log(JSON.stringify({errors,modes:samples.map(s=>({name:s.name,pelvis:s.body.pelvis,hands:s.hands.map(h=>[h.visible,h.forearm])}))}))
}finally{await browser.close()}
