import * as THREE from './three.module.min.js'
import {VRButton} from './VRButton.js'

// No app bundle, city, network textures, audio, physics, or telemetry. This is
// deliberately the installed r180 XR manager and the same VRButton as the app.
const VERSION='quest-entry-isolation-v1'
const KEY='spinward.xr-entry-isolation.v1'
const status=document.querySelector('#status'),details=document.querySelector('#details')
const previous=document.querySelector('#previous'),view=document.querySelector('#view')
const depth=new URLSearchParams(location.search).get('depth')==='plain'?'plain':'log'
const alternative=document.querySelector('#depth-alternative')
alternative.href=depth==='log'?'?depth=plain':'?depth=log'
alternative.textContent=depth==='log'?'通常の奥行き設定で比較する':'本編の奥行き設定で比較する'
const labels={
  requested:'VR開始ボタンを押した',granted:'VRセッションを取得した',
  attached:'描画先を準備した',rendering:'最初のVR描画を開始した',
  rendered:'最初のVR描画処理が戻った',frames:'60フレーム進んだ',
  completed:'10秒の描画が完了した',ended:'途中でVRを終了した',
  lost:'描画コンテキストを失った',error:'エラーを受け取った'
}
let record=null,renderer,frameCount=0,startedAt=0,ending=false
try{
  const old=JSON.parse(localStorage.getItem(KEY)??'null')
  previous.textContent=old?`前回：${labels[old.stage]??old.stage}\n${old.depth==='plain'?'通常':'本編と同じ'}の奥行き設定 · ${old.at}`:'前回の記録はありません。'
  if(old)details.textContent=JSON.stringify(old,null,2)
}catch{previous.textContent='このブラウザでは前回の記録を読み出せません。'}

function mark(stage,extra={}){
  record={...record,version:VERSION,depth,stage,at:new Date().toISOString(),frames:frameCount,...extra}
  try{localStorage.setItem(KEY,JSON.stringify(record))}catch{}
  status.textContent=labels[stage]??stage
  details.textContent=JSON.stringify(record,null,2)
}
function failure(error){mark('error',{error:String(error).slice(0,600)})}
window.addEventListener('error',event=>failure(event.error??event.message))
window.addEventListener('unhandledrejection',event=>failure(event.reason))

try{
  renderer=new THREE.WebGLRenderer({antialias:false,logarithmicDepthBuffer:depth==='log'})
  renderer.setPixelRatio(1);renderer.setSize(view.clientWidth,200)
  renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor')
  renderer.xr.setFramebufferScaleFactor(.7);renderer.xr.setFoveation(1)
  view.append(renderer.domElement)
  const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
  const device={userAgent:navigator.userAgent,three:THREE.REVISION,
    renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',
    context:gl.getContextAttributes()}
  renderer.domElement.addEventListener('webglcontextlost',()=>mark('lost'))
  const scene=new THREE.Scene();scene.background=new THREE.Color('#102539')
  const camera=new THREE.PerspectiveCamera(65,view.clientWidth/200,.1,100)
  camera.position.set(0,1.6,0)
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshBasicMaterial({color:'#4b6767'}))
  floor.rotation.x=-Math.PI/2;scene.add(floor)
  const cube=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshStandardMaterial({color:'#298bd7',roughness:.8}))
  cube.position.set(0,1.3,-2);scene.add(cube)
  scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2))

  const setSession=renderer.xr.setSession.bind(renderer.xr)
  renderer.xr.setSession=async session=>{
    mark('granted',{...device,features:session.enabledFeatures?[...session.enabledFeatures]:null})
    try{await setSession(session)}catch(error){failure(error);throw error}
  }
  const button=VRButton.createButton(renderer)
  button.addEventListener('click',()=>{
    if(renderer.xr.isPresenting)return
    record=null;frameCount=0;mark('requested',device)
  },{capture:true})
  document.querySelector('#entry').append(button)
  renderer.xr.addEventListener('sessionstart',()=>{
    frameCount=0;startedAt=performance.now();ending=false
    const layer=renderer.xr.getBaseLayer()
    mark('attached',{layer:layer?.constructor.name,width:layer?.framebufferWidth??layer?.textureWidth,height:layer?.framebufferHeight??layer?.textureHeight})
  })
  renderer.xr.addEventListener('sessionend',()=>{
    if(!['completed','error','lost'].includes(record?.stage))mark('ended')
  })
  renderer.setAnimationLoop(()=>{
    const immersive=renderer.xr.isPresenting
    if(immersive&&frameCount===0)mark('rendering')
    cube.rotation.y+=.005
    renderer.render(scene,camera)
    if(!immersive)return
    frameCount++
    if(frameCount===1)mark('rendered')
    if(frameCount===60)mark('frames')
    if(performance.now()-startedAt>=10000&&!ending){
      ending=true;mark('completed')
      renderer.xr.getSession()?.end().catch(failure)
    }
  })
  status.textContent=`準備完了 · ${depth==='log'?'本編と同じ':'通常'}の奥行き設定 · ${VERSION}`
}catch(error){failure(error)}
