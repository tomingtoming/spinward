import {writeFileSync} from 'node:fs'
import {initRapier} from '../../src/physics/rapierContext'
import {createRotatingCityColliders} from '../../src/physics/rotatingCityColliders'
import {buildCityCollisionIndex,type CityBuilding} from '../../src/objects/cityLayout'
import {CityCollisionOverlay} from '../../src/objects/cityCollisionOverlay'
import {createUnitsContext} from '../../src/units/units'
import {applyWorldLengthUnit,PLAYER_COLLISION_GROUPS} from '../../src/physics/rapierBoundary'
const rapier=await initRapier(),radius=3200,scale=.02,units=createUnitsContext(scale)
const boxes:CityBuilding[]=Array.from({length:256},(_,i)=>({azimuth:(i%8-4)*4/radius,axial:(Math.floor(i/8)%8-4)*4,width:2.8,depth:i%4===0?1:.07,height:i%4===0?.12:1.05,baseHeight:6.4+Math.floor(i/64)*3.2,kind:'block',tone:.5,collisionMargin:0}))
const stats=(xs:number[])=>{xs.sort((a,b)=>a-b);return {medianMs:xs[Math.floor(xs.length*.5)],p95Ms:xs[Math.floor(xs.length*.95)],maxMs:xs.at(-1)}}
const runs=[]
for(const count of [0,256,0,256]){
 const world=new rapier.World({x:9.81*scale,y:0,z:0});applyWorldLengthUnit(world,units)
 const overlay=new CityCollisionOverlay(buildCityCollisionIndex([],radius,40000),40000)
 const city=createRotatingCityColliders(rapier,world,{radius,index:overlay.index,omega:.01,units})
 const body=world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation((radius-8)*scale,0,0))
 world.createCollider(rapier.ColliderDesc.ball(.32*scale).setCollisionGroups(PLAYER_COLLISION_GROUPS),body)
 try{
  const start=performance.now();overlay.set(boxes.slice(0,count));city.update(0,0);const activationMs=performance.now()-start
  const steps:number[]=[],updates:number[]=[]
  for(let i=0;i<1500;i++){
   let t=performance.now();city.update(0,0);const update=performance.now()-t
   t=performance.now();world.step();const step=performance.now()-t
   if(i>=300){steps.push(step);updates.push(update)}
  }
  runs.push({count,active:city.activeCount(),activationMs,step:stats(steps),update:stats(updates)})
 }finally{city.dispose();world.free()}
}
const result={runtime:Bun.version,platform:process.platform,arch:process.arch,runs,scope:'Isolated 256-box upper bound, one dynamic body, rotating habitat, 1200 measured steps after 300 warmup steps. This is CPU microbenchmarking on the host, not Quest GPU/VR frame-time evidence.'}
writeFileSync(new URL('./balcony-cost.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
