import * as T from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {VRButton} from 'three/addons/webxr/VRButton.js'
import {MetroTiles,MetroWalkStream,fetchMetroTile,fetchCompressedJSON} from '../../worlds/plateau/metro-tiles.js'
import {FacadeInstances} from '../../worlds/plateau/facade-instances.js'
import {FacadeStream} from '../../worlds/plateau/facade-stream.js'
import {surfacePoint,surfaceAngle} from '../../worlds/plateau/surface-frame.js'
import {ThreeBandWalker} from '../threeBands/walker'
import {ThreeBandBody} from '../threeBands/body'
import {StudyWrist} from '../threeBands/wrist.js'
import {omegaForSurfaceG} from '../../units/units'
import './style.css'

const scene=new T.Scene(),world=new T.Group(),rig=new T.Group();scene.add(world,rig)
scene.background=new T.Color('#23343b')
const camera=new T.PerspectiveCamera(50,1,.05,150000);rig.add(camera)
const renderer=new T.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true})
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace
renderer.xr.enabled=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap
document.querySelector('#viewport').append(renderer.domElement)
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true
const ambient=new T.AmbientLight('#d4e2df',1.25),sun=new T.DirectionalLight('#fff1d9',2)
sun.position.set(-1000,8000,4000);scene.add(ambient,sun,sun.target)
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:500})
sun.shadow.normalBias=.25;sun.shadow.bias=-.0002
const body=new ThreeBandBody(scene);body.root.visible=false
const layers=new Map(),query=new URLSearchParams(location.search),keys=new Set()
let study,arrivals,selected=query.get('region')??'south',walker=null,walking=false,everWalked=false,wrist=null
let jump=false,night=false,last=0,snapArmed=true,trackingValid=false,drag=null,ready=false,xrJumpHeld=false
const right=new T.Vector3(),up=new T.Vector3(),basis=new T.Matrix4(),headForward=new T.Vector3(),headPoint=new T.Vector3()
const times=[],errors=[],started=performance.now(),status=document.querySelector('#status')
const read=async path=>{const r=await fetch(path);if(!r.ok)throw Error(`${r.status} ${path}`);return r.json()}
function failure(error){errors.push(String(error));const el=document.querySelector('#error');el.hidden=false;el.textContent=error.message??String(error);console.error(error)}
function sample(){return study.samples.find(s=>s.id===selected)}
function model(){
  walking=false;keys.clear();controls.enabled=!renderer.xr.isPresenting;body.root.visible=false
  world.scale.setScalar(1);world.position.set(0,0,0);rig.position.set(0,0,0);rig.quaternion.identity()
  camera.fov=50;camera.near=5;camera.far=150000;camera.updateProjectionMatrix()
  camera.position.set(22000,18000,36500);controls.target.set(0,0,0);controls.update()
  sun.castShadow=false;document.body.classList.remove('walking');document.querySelector('#hint').textContent='ドラッグで回転 · ホイールで拡大'
  if(renderer.xr.isPresenting){world.scale.setScalar(.00005);world.position.set(0,1.2,-1.8);camera.position.set(0,0,0);camera.quaternion.identity();camera.near=.01;camera.updateProjectionMatrix()}
}
function walk(){
  if(!walker){const a=arrivals[selected];walker=new ThreeBandWalker(layers.get(selected).walk,sample(),{x:a.spawn[0],y:a.spawn[1],h:a.ground,yaw:a.yaw,pitch:0,rejected:0},study.radius,omegaForSurfaceG(9.81,study.radius))}
  walking=true;everWalked=true;keys.clear();controls.enabled=false;world.scale.setScalar(1);world.position.set(0,0,0)
  document.querySelector('#region').disabled=true;document.body.classList.add('walking')
  document.querySelector('#hint').textContent='WASD: 歩く · Shift: ダッシュ · Space: ジャンプ · ドラッグ: 見回す'
  pose();updateStreams(true)
}
function pose(){
  if(!walker||!walking)return
  const p=walker.state,s=sample(),a=surfaceAngle(study.radius,s,'colony',p.x)
  right.set(Math.cos(a),Math.sin(a),0);up.set(-Math.sin(a),Math.cos(a),0);basis.makeBasis(right,up,new T.Vector3(0,0,1))
  const q=new T.Quaternion().setFromRotationMatrix(basis).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),p.yaw))
  camera.fov=70;camera.near=.04;camera.far=60000;camera.updateProjectionMatrix()
  if(renderer.xr.isPresenting){rig.position.set(...surfacePoint(study.radius,s,'colony',p.x,p.y,p.h+.035));rig.quaternion.copy(q);camera.position.set(0,0,0);camera.quaternion.identity()}
  else{rig.position.set(0,0,0);rig.quaternion.identity();camera.position.set(...surfacePoint(study.radius,s,'colony',p.x,p.y,p.h+1.65));camera.quaternion.copy(q).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),p.pitch))}
  const ground=new T.Vector3(...surfacePoint(study.radius,s,'colony',p.x,p.y,p.h))
  sun.target.position.copy(ground);sun.position.copy(ground).add(new T.Vector3(-110,210,80).applyMatrix4(basis));sun.shadow.camera.up.copy(up);sun.shadow.camera.updateProjectionMatrix()
  sun.castShadow=!renderer.xr.isPresenting&&!night
}
function toggleDay(){night=!night;ambient.intensity=night?.17:1.25;sun.intensity=night?.13:2;scene.background.set(night?'#10191f':'#23343b')}
function wristAction(action){if(action==='walk')walking?model():walk();if(action==='jump')jump=true;if(action==='daylight')toggleDay()}
function updateStreams(force=false){
  if(!ready)return
  world.updateWorldMatrix(true,true);rig.updateWorldMatrix(true,true);camera.updateWorldMatrix(true,false)
  const eye=new T.Vector3(),direction=new T.Vector3()
  if(renderer.xr.isPresenting){if(!trackingValid)return;eye.copy(headPoint).applyMatrix4(rig.matrixWorld);direction.copy(headForward).transformDirection(rig.matrixWorld)}
  else{camera.getWorldPosition(eye);camera.getWorldDirection(direction)}
  for(const [id,layer] of layers){
    const active=walking&&id===selected
    layer.base.update(eye,{active,visible:active,overview:!walking,direction,force})
    layer.walk.update(walker?.state.x??0,walker?.state.y??0,{active,force})
    layer.stream.update(eye,{active,force});layer.facade.updateLOD(eye)
  }
  status.textContent=walking?(walker.waiting?'足元の街区を読み込み中…':arrivals[selected].label+' · '+sample().name):'3.35 × 40 km を三帯 · 実都市 約402 km²'
}
function move(dt){
  if(!walking||!walker||renderer.xr.isPresenting&&!trackingValid)return
  let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)
  let fx=-Math.sin(walker.state.yaw),fy=Math.cos(walker.state.yaw)
  const speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?3.4:1.45
  if(renderer.xr.isPresenting){
    let pressed=false
    const direction=headForward.clone().transformDirection(rig.matrixWorld);fx=direction.dot(right);fy=-direction.z
    const length=Math.hypot(fx,fy);if(length>.1){fx/=length;fy/=length}
    for(const input of renderer.xr.getSession().inputSources){
      const axes=input.gamepad?.axes??[]
      if(input.handedness==='left'){side=axes[2]??axes[0]??0;forward=-(axes[3]??axes[1]??0);if(Math.abs(side)<.15)side=0;if(Math.abs(forward)<.15)forward=0}
      if(input.handedness==='right'){const turn=axes[2]??axes[0]??0;if(Math.abs(turn)<.3)snapArmed=true;if(snapArmed&&Math.abs(turn)>.7){walker.state.yaw-=Math.sign(turn)*Math.PI/6;snapArmed=false}pressed=!!input.gamepad?.buttons[4]?.pressed}
    }
    if(pressed&&!xrJumpHeld)jump=true;xrJumpHeld=pressed
  }
  const length=Math.max(1,Math.hypot(side,forward));forward/=length;side/=length
  walker.step(dt,(fx*forward+fy*side)*speed,(fy*forward-fx*side)*speed,jump);jump=false
  pose();body.root.visible=true;body.update(walker,dt,renderer,rig,camera)
}
async function load(){
  [study,arrivals]=await Promise.all([read('/metro-overview.json'),read('/metro-arrivals.json')])
  if(!study.ready)throw Error('三帯全域の遠景生成がまだ完了していません')
  if(!study.samples.some(s=>s.id===selected))selected=study.defaultRegion??study.samples[0].id
  const select=document.querySelector('#region');select.replaceChildren(...study.samples.map(s=>new Option(s.name+' · '+arrivals[s.id].label,s.id)))
  select.value=selected
  const kit=await read('/facade-kit.json')
  for(const s of study.samples){
    const [baseManifest,walkManifest,facadeManifest]=await Promise.all([read('/'+s.id+'/base.json'),read('/'+s.id+'/walk.json'),read('/'+s.id+'/facades.json')])
    const overview=[]
    // At most two decompressed overview chunks/bitmaps are in flight.
    for(let i=0;i<s.overview.length;i+=2){for(const data of await Promise.all(s.overview.slice(i,i+2).map(d=>fetchMetroTile(d))))overview.push(...data)}
    const base=new MetroTiles(study,s,baseManifest,overview,{onError:failure});world.add(base.group)
    const facade=new FacadeInstances(kit,[],study,s);facade.midRange=180;facade.updateMode('colony');world.add(facade.group)
    const stream=new FacadeStream(facade,facadeManifest,{...facadeManifest,fetchSite:fetchCompressedJSON,onError:failure})
    const walkingWorld=new MetroWalkStream({...walkManifest,arrival:arrivals[s.id]})
    layers.set(s.id,{base,facade,stream,walk:walkingWorld})
    status.textContent=s.name+'を配置しました'
  }
  ready=true;document.querySelector('#walk').disabled=false
  document.querySelector('#source-state').textContent=study.layout==='inland-b'?'皇居・渋谷から埼玉方面へ続く三帯。地表の欠落と公共交通の整備状況は別途検証中です。':'地表の欠落と公共交通の整備状況は別途検証中です。'
  const button=VRButton.createButton(renderer);document.body.append(button)
  const localizeVR=()=>{const labels={'ENTER VR':'VRで入る','EXIT VR':'VRを終了','VR NOT SUPPORTED':'VR未対応','VR NOT ALLOWED':'VRの許可が必要'};if(labels[button.textContent])button.textContent=labels[button.textContent]}
  new MutationObserver(localizeVR).observe(button,{childList:true,characterData:true,subtree:true});localizeVR()
  const controllers=[renderer.xr.getController(0),renderer.xr.getController(1)],grips=[renderer.xr.getControllerGrip(0),renderer.xr.getControllerGrip(1)],hands={}
  for(const c of [...controllers,...grips])rig.add(c)
  controllers.forEach((c,i)=>c.addEventListener('connected',event=>{
    hands[event.data.handedness]={controller:c,grip:grips[i]}
    if(hands.left&&hands.right&&!wrist){wrist=new StudyWrist(hands.left.controller,hands.right.controller,wristAction);wrist.mainButtons=['walk','jump','daylight'].map((id,j)=>({id,x:24,y:104+j*96,w:392,h:80}))}
  }))
  for(const c of controllers)c.addEventListener('select',()=>wrist?.select())
  renderer.xr.addEventListener('sessionstart',()=>{trackingValid=false;walking?pose():model()})
  renderer.xr.addEventListener('sessionend',()=>{trackingValid=false;walking?pose():model()})
  if(query.get('walk')==='1')walk();else model()
  window.__metro.readyMs=performance.now()-started
}
document.querySelector('#walk').onclick=()=>walk();document.querySelector('#model').onclick=()=>model();document.querySelector('#night').onclick=toggleDay
document.querySelector('#region').onchange=e=>{if(!everWalked)selected=e.target.value}
addEventListener('keydown',e=>{if(!walking||e.target.closest?.('input,select,textarea'))return;if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','Space'].includes(e.code)){keys.add(e.code);if(e.code==='Space'&&!e.repeat)jump=true;e.preventDefault()}})
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();drag=null})
renderer.domElement.addEventListener('pointerdown',e=>{if(!walking)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)})
renderer.domElement.addEventListener('pointermove',e=>{if(!walking||drag?.id!==e.pointerId)return;walker.state.yaw-=(e.clientX-drag.x)*.004;walker.state.pitch=T.MathUtils.clamp(walker.state.pitch-(e.clientY-drag.y)*.003,-1.25,1.25);drag={id:e.pointerId,x:e.clientX,y:e.clientY}})
for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,()=>drag=null)
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize()
window.__metro={get ready(){return ready},get study(){return study},get layers(){return layers},get walker(){return walker},get walking(){return walking},get wrist(){return wrist},get selected(){return selected},get trackingValid(){return trackingValid},camera,renderer,scene,world,rig,body,model,walk,errors,
  pick(x,y){const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x,y),camera);return ray.intersectObject(world,true).slice(0,6).map(hit=>{
    const owner=[...layers].find(([,layer])=>hit.object.parent===layer.base.group),s=study.samples.find(s=>s.id===owner?.[0])
    const p=world.worldToLocal(hit.point.clone()),angle=Math.atan2(p.x,-p.y)-(s?.band??0)*Math.PI*2/3
    return{name:hit.object.name,level:hit.object.userData.level,band:s?.id,distance:hit.distance,point:hit.point.toArray(),native:[Math.atan2(Math.sin(angle),Math.cos(angle))*study.radius,-p.z,study.radius-Math.hypot(p.x,p.y)],face:hit.faceIndex}
  })},
  diagnostics(){const sorted=times.slice().sort((a,b)=>a-b);return{ready,walking,selected,pose:walker?.state,frameP95:sorted[Math.floor(sorted.length*.95)],frames:times.length,render:renderer.info.render,memory:renderer.info.memory,heap:performance.memory?.usedJSHeapSize,
    layers:Object.fromEntries([...layers].map(([id,l])=>[id,{base:l.base.diagnostics(),walk:l.walk.diagnostics(),facade:l.facade.diagnostics(),recipes:{resident:l.stream.diagnostics().resident,bytes:l.stream.diagnostics().recipeBytes}}]))}}}
renderer.setAnimationLoop((time,frame)=>{
  const dt=last?Math.min((time-last)/1000,.05):0;if(ready&&last){times.push(time-last);if(times.length>600)times.shift()}last=time
  if(frame){const pose=frame.getViewerPose(renderer.xr.getReferenceSpace());trackingValid=!!pose;if(pose){const t=pose.transform;headPoint.set(t.position.x,t.position.y,t.position.z);headForward.set(0,0,-1).applyQuaternion(new T.Quaternion(t.orientation.x,t.orientation.y,t.orientation.z,t.orientation.w))}}
  move(dt);if(!walking&&!renderer.xr.isPresenting)controls.update();updateStreams();wrist?.update(renderer.xr.isPresenting&&trackingValid,selected,walking);renderer.render(scene,camera)
})
load().catch(failure)
