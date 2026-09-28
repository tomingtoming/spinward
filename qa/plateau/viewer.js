import * as T from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {VRButton} from 'three/addons/webxr/VRButton.js'
import {WalkWorld} from './walking.js'
import {WalkStream} from './walk-stream.js'
import {StudyWrist} from './wrist.js'
import {FacadeInstances} from './facade-instances.js'
import {FacadeStream} from './facade-stream.js'
import {BaseTiles,fetchTile} from './base-tiles.js'
import {surfacePoint,surfaceAngle} from './surface-frame.js'
import {NavigationGuide} from './navigation.js'
import {BandWorld,loadBandLandscape} from './band-landscape.js'
import './style.css'

const viewport=document.querySelector('#viewport'),scene=new T.Scene(),content=new T.Group()
scene.background=new T.Color('#e4e7e2');scene.add(content)
const camera=new T.PerspectiveCamera(42,1,.1,100000),renderer=new T.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true})
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.xr.enabled=true
renderer.domElement.id='study-world'
viewport.append(renderer.domElement);const controls=new OrbitControls(camera,renderer.domElement)
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49
const hemisphere=new T.HemisphereLight(0xf5fbff,0x78745a,1.7);scene.add(hemisphere)
const sun=new T.DirectionalLight(0xfff4dc,2.2);sun.position.set(-1000,1700,900);sun.castShadow=true
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-1100,right:1100,top:1100,bottom:-1100,near:1,far:5000})
sun.shadow.bias=-.00025;sun.shadow.normalBias=.35;scene.add(sun)
let study,selected='tokyo',mode='flat',groups=[],shell,first=true,walking=false,player=null,wrist=null,lastTime=0,snapReady=true
const walkWorlds=new Map(),keys=new Set(),xrRig=new T.Group();scene.add(xrRig);xrRig.add(camera)
const facades=new Map(),queryOptions=new URLSearchParams(location.search),legacyFacades=queryOptions.get('facades')==='legacy'
let siteManifest=null,currentSite='station',walkSpace='local',exploration=null,activeLandmark=null,navigation=null
const streams=new Map(),baseTiles=new Map(),legacyBase=legacyFacades||queryOptions.get('tiles')==='legacy'
const bandLandscapes=new Map(),navigations=new Map()
const headForward=new T.Vector3(),basis=new T.Matrix4(),walkUp=new T.Vector3(),walkRight=new T.Vector3(),walkBack=new T.Vector3(0,0,1)
const trackedHead=new T.Vector3(),trackedForward=new T.Vector3(0,0,-1),trackedQuaternion=new T.Quaternion()
let trackingValid=false
let drag=null,touchMove=[0,0]
const source=new Map(),character={tokyo:'密な住宅街を、太い街道が貫く。東高円寺を中心とする既成市街地。',tama:'駅前の大きな街区から丘陵の住宅地へ。多摩センター周辺の起伏を保持。',azumino:'集落と田畑が入り交じる。柏矢町周辺の実際の農地区画を保持。'}
const fetchJSON=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${url}`);return r.json()}
const fetchBuffer=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${url}`);return r.arrayBuffer()}
const fail=e=>{console.error(e);const el=document.querySelector('#error');el.hidden=false;el.textContent='読み込みに失敗しました: '+e.message}

// The study's native frame is right-handed X cross-band, Y axial, Z height.
function position(x,y,h,band,view,anchor){
  return surfacePoint(study.radius,{band,anchor:{local:anchor}},view,x,y,h)
}
function updateMesh(mesh,s){
  const original=source.get(mesh),out=mesh.geometry.attributes.position.array
  for(let i=0;i<out.length;i+=3)out.set(position(original[i],original[i+1],original[i+2],s.band,mode,s.anchor.local),i)
  mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere()
}
function buildShell(){
  if(study.fullBands)return new T.Group()
  const g=new T.Group(),material=new T.MeshBasicMaterial({color:'#b5c1b9',transparent:true,opacity:.19,side:T.DoubleSide,depthWrite:false})
  for(let band=0;band<3;band++){
    const p=[],idx=[],n=48,s=study.samples.find(s=>s.band===band),[cx,cy]=s.anchor.local,edge=walkWorlds.get(s.id).data.edge,apron=edge?Math.min(120,study.bandWidth/2-Math.abs(cx)-s.half-20):0,half=s.half+apron
    const xs=[...new Set([...Array.from({length:n+1},(_,i)=>(i/n-.5)*study.bandWidth),cx-half,cx+half])].sort((a,b)=>a-b)
    const ys=[-study.span/2,cy-half,cy+half,study.span/2]
    // Cut the real sample out of the placeholder sheet: datum-zero land must not
    // overpaint roads/terrain lying below the sample's local height origin.
    for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
      if(Math.abs((xs[i]+xs[i+1])/2-cx)<half&&Math.abs((ys[j]+ys[j+1])/2-cy)<half)continue
      const start=p.length/3
      for(const [x,y] of [[xs[i],ys[j]],[xs[i+1],ys[j]],[xs[i+1],ys[j+1]],[xs[i],ys[j+1]]])p.push(...position(x,y,0,band,'colony',[0,0]))
      idx.push(start,start+1,start+2,start,start+2,start+3)
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setIndex(idx)
    g.add(new T.Mesh(geo,material));const outline=new T.EdgesGeometry(geo,30);g.add(new T.LineSegments(outline,new T.LineBasicMaterial({color:'#657d72',transparent:true,opacity:.45})))
    if(edge){
      const positions=[],colours=[],indices=[],c=new T.Color('#b6b7a6')
      for(const [x,y,h] of edge){positions.push(...position(x,y,h+.03,band,'colony',s.anchor.local),...position(x*half/s.half,y*half/s.half,0,band,'colony',s.anchor.local));colours.push(c.r,c.g,c.b,1,c.r,c.g,c.b,.19)}
      for(let i=0;i<edge.length-1;i++){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2)}
      const apronGeo=new T.BufferGeometry();apronGeo.setAttribute('position',new T.Float32BufferAttribute(positions,3));apronGeo.setAttribute('color',new T.Float32BufferAttribute(colours,4));apronGeo.setIndex(indices);apronGeo.computeVertexNormals()
      const mesh=new T.Mesh(apronGeo,new T.MeshStandardMaterial({vertexColors:true,roughness:1,transparent:true,side:T.DoubleSide}));mesh.name=s.id+'-transition';g.add(mesh)
    }
  }
  return g
}
function home(){
  if(renderer.xr.isPresenting)return
  if(walking){poseWalker();return}
  camera.fov=42
  hemisphere.position.set(0,1,0)
  sun.shadow.camera.up.set(0,1,0)
  sun.position.set(-1000,1700,900);sun.target.position.set(0,0,0)
  Object.assign(sun.shadow.camera,{left:-1100,right:1100,top:1100,bottom:-1100,near:1,far:5000});sun.shadow.camera.updateProjectionMatrix()
  content.position.set(0,0,0);content.scale.setScalar(1)
  controls.target.set(0,mode==='colony'?-400:15,0)
  camera.position.set(...(mode==='colony'?[22000,23500,36500]:[1130,1280,1570].map(v=>v*study.samples.find(s=>s.id===selected).half/700)))
  if(study.fullBands&&mode!=='colony'){
    const s=study.samples.find(s=>s.id===selected),[cx,cy]=s.anchor.local
    controls.target.set(...position(-cx,-cy,0,s.band,mode,s.anchor.local))
    camera.position.copy(controls.target).add(new T.Vector3(7000,30000,34000))
  }
  // A portrait viewport needs a wider view to retain the complete same-size sample.
  if(camera.aspect<1){
    const halfFov=Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov/2))*camera.aspect)
    const distance=(mode==='colony'||study.fullBands?20500:1100*study.samples.find(s=>s.id===selected).half/700)*1.06/Math.sin(halfFov)
    camera.position.sub(controls.target).setLength(distance).add(controls.target)
  }
  camera.near=mode==='colony'?5:.1;camera.far=mode==='colony'?200000:100000;camera.updateProjectionMatrix();controls.update()
}
function updateHint(){document.querySelector('#hint').textContent=renderer.xr.isPresenting?(walking?'左スティック: 歩く · 右: 30°旋回 · 手首メニュー':'手首メニュー · トリガーで地域切替'):walking?(matchMedia('(max-width:720px)').matches?'画面をなぞって見回す · 矢印で移動':'WASD: 歩く · Shift: ダッシュ · ドラッグ: 見回す'):matchMedia('(max-width:720px)').matches?'1本指で回転 · 2本指で拡大・移動':'ドラッグで回転 · ホイールで拡大 · 右ドラッグで移動'}
function xrLayout(){
  if(walking){content.scale.setScalar(1);content.position.set(0,0,0);controls.enabled=false;poseWalker();return}
  xrRig.position.set(0,0,0);xrRig.quaternion.identity()
  hemisphere.position.set(0,1,0)
  controls.enabled=false;camera.position.set(0,0,0);camera.rotation.set(0,0,0)
  content.scale.setScalar(mode==='colony'?.000055:.001);content.position.set(0,.9,-1.8)
  sun.castShadow=false;camera.near=.01;camera.updateProjectionMatrix()
}
function show(id=selected,view=mode){
  const changed=selected!==id;selected=id;mode=walking?(walkSpace==='colony'?'colony':'curved'):view
  const nextNavigation=navigations.get(id)??null
  if(navigation!==nextNavigation){
    navigation=nextNavigation
    const select=document.querySelector('#destination');select.replaceChildren()
    for(const stop of navigation?.data.destinations??[]){const option=document.createElement('option');option.value=stop.id;option.textContent=stop.label;select.append(option)}
    if(wrist){wrist.navigation=navigation;wrist.page='main';wrist.destinationIndex=0}
    if(window.__plateau)window.__plateau.navigation=navigation
  }
  if(walking&&(changed||!player))player=spawnPlayer()
  for(let i=0;i<groups.length;i++){const g=groups[i],s=study.samples[i];g.visible=mode==='colony'||s.id===selected;for(const m of g.children)if(source.has(m))updateMesh(m,s);facades.get(s.id)?.updateMode(mode);baseTiles.get(s.id)?.updateMode(mode);bandLandscapes.get(s.id)?.updateMode(mode);bandLandscapes.get(s.id)?.setWalking(walking)}
  shell.visible=mode==='colony';sun.castShadow=(walking||mode!=='colony')&&!renderer.xr.isPresenting
  document.querySelectorAll('[data-region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.region===selected)))
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)))
  const s=study.samples.find(s=>s.id===selected)
  document.querySelector('#place').textContent=mode==='colony'&&!walking?'3 × 40 km の内壁':(selected==='tokyo'&&activeLandmark?activeLandmark.label:s.station+'周辺')+(mode==='colony'?' · 内壁'+(s.band+1):'')
  document.querySelector('#character').textContent=mode==='colony'?(walking?'三枚の内壁に三地域を配置した試作。見上げると他の街が見えます。淡い帯は未転写の範囲です。':'淡い帯は未転写の範囲。小さく見える三つの街区が、今回取り込んだ実データです。'):character[selected]
  document.querySelector('#stats').innerHTML=mode==='colony'&&!walking?`<dt>内壁1枚の幅</dt><dd>${(study.bandWidth/1000).toFixed(2)} km</dd><dt>半径</dt><dd>3.2 km</dd><dt>実データの面積</dt><dd>${(study.samples.reduce((n,s)=>n+4*s.half*s.half,0)/1e6).toFixed(2)} / 402.12 km²</dd>`:
    `<dt>取り込み範囲</dt><dd>${s.half/500} × ${s.half/500} km</dd><dt>建物</dt><dd>${s.buildingCount.toLocaleString('ja-JP')} 棟</dd><dt>地表の標高差</dt><dd>${(s.reliefM[1]-s.reliefM[0]).toFixed(1)} m</dd>`
  if(study.fullBands){
    const area=(s.bounds[2]-s.bounds[0])*(s.bounds[3]-s.bounds[1])/1e6
    document.querySelector('#place').textContent=mode==='colony'&&!walking?'3 × 40 km の内壁':(activeLandmark?.label??s.name)+(mode==='colony'?' · 内壁'+(s.band+1):'')
    document.querySelector('#character').textContent=character[selected]+' 都市の外は、緑道・生産区・水循環施設を経て両端部へ続きます。'
    document.querySelector('#stats').innerHTML=`<dt>内壁の広さ</dt><dd>3.35 × 40 km</dd><dt>実都市の範囲</dt><dd>${area.toFixed(1)} km²</dd><dt>実データの建物</dt><dd>${s.buildingCount.toLocaleString('ja-JP')} 棟</dd>`
  }
  if(renderer.xr.isPresenting)xrLayout();else home()
  window.__plateau.state={selected,mode,walkSpace,buildingCount:s.buildingCount}
  if(!walking)window.__plateau.walk={active:false}
  document.querySelector('#walk').textContent=walking?'模型に戻る':'地上を歩く'
  document.querySelector('#interior').textContent=walking&&walkSpace==='colony'?'街区だけで歩く':'内壁の中で歩く'
  document.querySelector('#interior').setAttribute('aria-pressed',String(walking&&walkSpace==='colony'))
  document.body.classList.toggle('walking',walking);controls.enabled=!walking&&!renderer.xr.isPresenting
  document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=walking)
  document.querySelector('#sites').hidden=selected!=='tokyo'
  document.querySelector('#exploration').hidden=selected!=='tokyo'||!exploration
  document.querySelector('#navigation-panel').hidden=!navigation
  document.querySelector('#return-home').textContent=s.station+'へ戻る'
  document.querySelectorAll('[data-site]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.site===currentSite)))
  updateHint()
  resize()
  updateStreams(true)
}
function spawnPlayer(){
  activeLandmark=null;const world=walkWorlds.get(selected),state=world.spawn()
  if(selected==='tokyo'&&currentSite!=='station'){
    const a=siteManifest.sites.find(s=>s.id===currentSite).arrival,[x,y]=a.spawn
    if((!world.readyAt||world.readyAt(x,y))&&world.blocked(x,y))throw Error('Unsafe district arrival')
    return{...state,x,y,h:a.ground??world.ground(x,y),yaw:a.yaw}
  }
  return state
}
function visitSite(id){
  if(!siteManifest?.sites.some(s=>s.id===id))throw Error('Unknown district')
  currentSite=id;selected='tokyo';walking=true;keys.clear();touchMove=[0,0];player=spawnPlayer();show('tokyo','curved')
  closeMenu()
}
function visitLandmark(id){
  const stop=exploration.stops.find(s=>s.id===id);if(!stop)throw Error('Unknown landmark')
  activeLandmark=stop;document.querySelector('#landmark').value=id;selected='tokyo';walking=true;keys.clear();touchMove=[0,0];player={x:stop.point[0],y:stop.point[1],h:stop.ground,yaw:stop.yaw,pitch:0,rejected:0};show()
  closeMenu()
}
function closeMenu(){document.body.classList.remove('menu-open');document.querySelector('#menu-toggle').setAttribute('aria-expanded','false');document.activeElement?.blur()}
function visitDestination(id){
  const stop=navigation.data.destinations.find(s=>s.id===id);if(!stop)throw Error('Unknown destination')
  document.querySelector('#destination').value=id
  activeLandmark=stop;currentSite='station';walking=true;keys.clear();touchMove=[0,0];player={x:stop.point[0],y:stop.point[1],h:stop.ground,yaw:stop.yaw,pitch:0,rejected:0};closeMenu();show();navigation.lastUpdate=-Infinity
}
function startGuide(id){
  navigation.setGoal(id)
  if(!walking)visitDestination('home')
  document.querySelector('#destination').value=id
  closeMenu();keys.clear();touchMove=[0,0]
}
function wristAction(id){
  if(id.startsWith('guide:'))startGuide(id.slice(6))
  else if(id.startsWith('travel:'))visitDestination(id.slice(7))
  else if(id==='home'){navigation.setGoal('home');visitDestination('home')}
  else if(id==='walk')toggleWalk();else show(id)
}
function toggleInterior(){
  walkSpace=walking&&walkSpace==='colony'?'local':'colony'
  if(!walking){walking=true;player=spawnPlayer()}
  keys.clear();touchMove=[0,0];show()
}
function toggleWalk(){
  if(!walking&&mode==='colony')walkSpace='colony'
  walking=!walking;keys.clear();touchMove=[0,0];player=walking?spawnPlayer():null
  if(!walking){xrRig.position.set(0,0,0);xrRig.quaternion.identity()}
  show(selected,walkSpace==='colony'?'colony':walking?'curved':'flat')
}
function poseWalker(){
  if(!player)return
  const sample=study.samples.find(s=>s.id===selected),view=walkSpace==='colony'?'colony':'curved'
  const a=surfaceAngle(study.radius,sample,view,player.x),point=h=>surfacePoint(study.radius,sample,view,player.x,player.y,h)
  walkRight.set(Math.cos(a),Math.sin(a),0);walkUp.set(-Math.sin(a),Math.cos(a),0);basis.makeBasis(walkRight,walkUp,walkBack)
  const q=new T.Quaternion().setFromRotationMatrix(basis).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),player.yaw))
  content.scale.setScalar(1);content.position.set(0,0,0);camera.fov=70;camera.near=.04;camera.far=50000;camera.updateProjectionMatrix()
  if(renderer.xr.isPresenting){
    xrRig.position.set(...point(player.h+.035));xrRig.quaternion.copy(q)
    camera.position.set(0,0,0);camera.quaternion.identity()
  }else{
    xrRig.position.set(0,0,0);xrRig.quaternion.identity()
    camera.position.set(...point(player.h+1.65));camera.quaternion.copy(q).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),player.pitch))
  }
  // Near-ground shadows need a local frustum; the entire square can stay visible without a huge shadow texture.
  const p=new T.Vector3(...point(player.h));sun.target.position.copy(p);hemisphere.position.copy(walkUp)
  sun.position.copy(p).add(new T.Vector3(-100,180,100).applyMatrix4(basis));Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:1,far:450});sun.shadow.camera.up.copy(walkUp);sun.shadow.camera.updateProjectionMatrix()
  if(window.__plateau)window.__plateau.walk={...player,active:walking,candidates:walkWorlds.get(selected).lastCandidateCount}
}
function updateWalking(dt){
  if(!walking||!player)return
  if(renderer.xr.isPresenting&&!trackingValid){poseWalker();return}
  let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)+touchMove[1],side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+touchMove[0]
  let fx=-Math.sin(player.yaw),fy=Math.cos(player.yaw),speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?3.4:1.45
  if(renderer.xr.isPresenting){
    const session=renderer.xr.getSession()
    for(const input of session.inputSources){const axes=input.gamepad?.axes??[]
      if(input.handedness==='left'){side=axes[2]??axes[0]??0;forward=-(axes[3]??axes[1]??0)}
      if(input.handedness==='right'){const axis=axes[2]??axes[0]??0;if(Math.abs(axis)<.2)snapReady=true;else if(Math.abs(axis)>.65&&snapReady){player.yaw-=Math.sign(axis)*Math.PI/6;snapReady=false}}
    }
    // The ArrayCamera is still in reference space at the start of Three's frame.
    // Use this XRFrame's tracked head, transformed by the actual locomotion rig.
    poseWalker();xrRig.updateWorldMatrix(true,false)
    headForward.copy(trackedForward).transformDirection(xrRig.matrixWorld);const a=surfaceAngle(study.radius,study.samples.find(s=>s.id===selected),mode,player.x)
    fx=headForward.x*Math.cos(a)+headForward.y*Math.sin(a);fy=-headForward.z;const l=Math.hypot(fx,fy);if(l>.05){fx/=l;fy/=l}else{fx=-Math.sin(player.yaw);fy=Math.cos(player.yaw)}
    if(Math.abs(side)<.12)side=0;if(Math.abs(forward)<.12)forward=0
  }
  const length=Math.hypot(side,forward);if(length>1){side/=length;forward/=length}
  player=walkWorlds.get(selected).move(player,(fx*forward+fy*side)*speed*dt,(fy*forward-fx*side)*speed*dt)
  poseWalker()
}
async function main(){
  study=await fetchJSON('/study.json');if(study.samples.length!==3)throw Error('Three samples required')
  for(const s of study.samples){const group=new T.Group();group.name=s.id
    if(!s.walk)throw Error('Walking data missing; run prepare_walk.py')
    walkWorlds.set(s.id,s.walkTiles?new WalkStream(await fetchJSON('/'+s.walkTiles)):new WalkWorld(await fetchJSON('/'+s.walk)))
    if(s.exploration)exploration=await fetchJSON('/'+s.exploration)
    if(s.navigation)navigations.set(s.id,new NavigationGuide(await fetchJSON('/'+s.navigation),document.querySelector('#city-map')))
    let instanceFacade=null,facadeManifest=null
    if(s.facadeSites){
      facadeManifest=await fetchJSON('/'+s.facadeSites);if(s.id==='tokyo')siteManifest=facadeManifest
      if(!legacyFacades){
        const kit=await fetchJSON('/'+facadeManifest.kit)
        instanceFacade=new FacadeInstances(kit,[],study,s);if(facadeManifest.version>=2)instanceFacade.midRange=facadeManifest.version>=3?180:360;facades.set(s.id,instanceFacade)
        streams.set(s.id,new FacadeStream(instanceFacade,facadeManifest,{maxResident:facadeManifest.maxResident??4,maxBytes:facadeManifest.maxBytes??Infinity,loadDistance:facadeManifest.loadDistance??780,evictDistance:facadeManifest.evictDistance??920,onError:()=>{document.querySelector('#detail-status').textContent='一部の外観を読み込めませんでした。建物と道路は引き続き表示しています。'}}))
      }
    }
    if(s.baseTiles&&!legacyBase){
      const manifest=await fetchJSON('/'+s.baseTiles),overview=await fetchTile(manifest.overview)
      const tiles=new BaseTiles(study,s,manifest,overview);baseTiles.set(s.id,tiles);group.add(tiles.group)
    }
    if(s.bandLandscape){
      const landscape=await loadBandLandscape(study,s,fetchJSON,fetchBuffer);bandLandscapes.set(s.id,landscape);group.add(landscape.group)
      walkWorlds.set(s.id,new BandWorld(walkWorlds.get(s.id),landscape.data,landscape.terrain))
    }
    const frontage=s.frontage&&!instanceFacade?await fetchJSON('/'+s.frontage):null
    const replacementIds=new Set(frontage?.buildingIds??[])
    const bodyFeatures=(frontage||instanceFacade)&&!baseTiles.has(s.id)?await fetchJSON('/'+s.features):[]
    const bodyColours=new Map(instanceFacade?Object.entries(facadeManifest.bodyColours):[])
    for(const m of (baseTiles.has(s.id)?[]:s.meshes)){
      if(instanceFacade&&m.name.startsWith('frontage-'))continue
      const [pb,ib]=await Promise.all([fetchBuffer('/'+m.path+m.positions),fetchBuffer('/'+m.path+m.indices)])
      const original=new Float32Array(pb),geometry=new T.BufferGeometry()
      let indices=new Uint32Array(ib)
      if(m.name==='buildings'&&replacementIds.size){
        const kept=bodyFeatures.filter(f=>!replacementIds.has(f.id)),filtered=new Uint32Array(kept.reduce((n,f)=>n+f.indexCount,0));let offset=0
        for(const f of kept){filtered.set(indices.subarray(f.firstIndex,f.firstIndex+f.indexCount),offset);offset+=f.indexCount}indices=filtered
      }
      geometry.setAttribute('position',new T.BufferAttribute(original.slice(),3));geometry.setIndex(new T.BufferAttribute(indices,1))
      const coloured=m.name==='buildings'&&!!instanceFacade
      if(coloured){
        const colours=new Float32Array(original.length),base=new T.Color(m.material)
        for(let j=0;j<colours.length;j+=3)base.toArray(colours,j)
        for(const f of bodyFeatures){const shade=bodyColours.get(f.id);if(!shade)continue;const c=new T.Color(shade)
          for(let j=f.firstIndex;j<f.firstIndex+f.indexCount;j++)c.toArray(colours,indices[j]*3)
        }
        geometry.setAttribute('color',new T.BufferAttribute(colours,3))
      }
      const overlay=!m.solid&&!['terrain','buildings','foundations'].includes(m.name)
      const material=new T.MeshStandardMaterial({color:coloured?'#ffffff':m.material,vertexColors:coloured,roughness:m.roughness??.96,metalness:0,side:T.DoubleSide,
        polygonOffset:overlay,polygonOffsetFactor:overlay?-1:0,polygonOffsetUnits:overlay?-4:0})
      const mesh=new T.Mesh(geometry,material);mesh.name=m.name;mesh.castShadow=m.name==='buildings'||m.name.startsWith('frontage-');mesh.receiveShadow=true
      source.set(mesh,original);group.add(mesh)
    }if(instanceFacade)group.add(instanceFacade.group);groups.push(group);content.add(group)
  }
  shell=buildShell();content.add(shell)
  scene.add(sun.target)
  document.body.classList.toggle('citywide',navigations.size>0||study.fullBands)
  window.__plateau={ready:true,state:{},study,renderer,scene,camera,groups,show,home,walkWorlds,toggleWalk,toggleInterior,xrRig,facades,streams,siteManifest,visitSite,visitLandmark,visitDestination,startGuide,navigation,navigations,bandLandscapes,exploration,legacyFacades,baseTiles,legacyBase,
    raycast(x,y){const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x,y),camera);return ray.intersectObjects([...groups,shell],true).slice(0,6).map(h=>({name:h.object.name,parent:h.object.parent.name,distance:h.distance,point:h.point.toArray(),level:h.object.userData.level,face:h.faceIndex}))},
    groundProbe(){
      const sample=study.samples.find(s=>s.id===selected),view=walkSpace==='colony'?'colony':'curved',a=surfaceAngle(study.radius,sample,view,player.x),cam=renderer.xr.isPresenting?renderer.xr.getCamera():camera,eye=cam.getWorldPosition(new T.Vector3()),ray=new T.Raycaster(eye,new T.Vector3(Math.sin(a),-Math.cos(a),0),0,4)
      const names=['terrain','roads','footways','park-path','band-terrain','band-roads','band-connectors','bridge-decks'],meshes=[];groups.find(g=>g.name===selected).traverseVisible(m=>{if(m.isMesh&&names.includes(m.name))meshes.push(m)})
      return ray.intersectObjects(meshes,false).map(hit=>({name:hit.object.name,distance:hit.distance,point:hit.point.toArray(),level:hit.object.userData.level})).slice(0,6)
    },
    advanceWalk(dx,dy){if(!walking)throw Error('Walking required');player=walkWorlds.get(selected).move(player,dx,dy);poseWalker();updateStreams(true);return{...player}},
    visibleMeshes(id,names){const out=[];groups.find(g=>g.name===id).traverseVisible(m=>{if(m.isMesh&&names.includes(m.name))out.push(m)});return out},
    get detailsReady(){return (!walking||!walkWorlds.get(selected).readyAt||walkWorlds.get(selected).readyAt(player.x,player.y))&&[...baseTiles.values()].every(s=>s.ready)&&[...streams.values()].every(s=>[...s.entries.values()].every(e=>!e.wanted||e.status==='resident'))}}
  show();document.querySelectorAll('[data-region]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.region)))
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>show(selected,b.dataset.mode)))
  document.querySelector('#reset').addEventListener('click',home)
  document.querySelector('#walk').addEventListener('click',toggleWalk)
  document.querySelector('#interior').addEventListener('click',toggleInterior)
  document.querySelectorAll('[data-site]').forEach(b=>b.addEventListener('click',()=>visitSite(b.dataset.site)))
  if(siteManifest&&!legacyFacades)document.querySelector('#limits').textContent=`東京${study.samples[0].half/500} km四方、多摩・安曇野1.4 km四方の試作。東京の${siteManifest.sites.reduce((n,s)=>n+s.buildings,0)}棟を共通の外観部品で表示。配置・寸法は実データ、窓・入口はSpinwardの設計です。内装は未制作。`
  if(study.fullBands){
    document.querySelector('#limits').textContent='三枚の内壁を端から端まで探索できます。都市核の建物・道路・地形は実データ。外縁の緑地・生産区・水循環施設と、建物の外観はSpinwardの設計です。'
    document.querySelector('#source-editions').textContent='PLATEAUの東京・多摩・安曇野周辺の自治体データ（主に2025年、一部の松本市建物は2020年）、国土地理院 標高タイル、国土数値情報 鉄道データ2025を加工。自治体・地物ごとの版と取得内容は原典記録に固定しています。'
    document.querySelector('#source-transforms').textContent='実都市の核は縮尺・位置関係・高さを保って円筒に変換。核の外側はコロニー用の地形・緑地・生産区・水系・端部施設です。道路はLOD1を地表へ投影し、水路を渡る箇所の橋桁と取り付け道路を設計しました。立体交差・建物と地形の一部干渉は原典の詳細不足が残ります。窓・入口・材質は現地外観の復元ではありません。'
  }
  if(exploration){
    document.querySelector('#route-length').textContent=`街を巡る ${(exploration.length/1000).toFixed(2)} km`
    const select=document.querySelector('#landmark');for(const stop of exploration.stops){const option=document.createElement('option');option.value=stop.id;option.textContent=stop.label;select.append(option)}
    select.addEventListener('change',()=>visitLandmark(select.value))
  }
  if(navigation){
    const select=document.querySelector('#destination');select.value=navigation.data.destinations.some(s=>s.id==='tour-park')?'tour-park':'home'
    document.querySelector('#guide').onclick=()=>startGuide(select.value)
    document.querySelector('#travel').onclick=()=>visitDestination(select.value)
    document.querySelector('#return-home').onclick=()=>{navigation.setGoal('home');visitDestination('home')}
  }
  document.querySelector('#menu-toggle').onclick=()=>{
    const open=document.body.classList.toggle('menu-open');document.querySelector('#menu-toggle').setAttribute('aria-expanded',String(open));keys.clear();touchMove=[0,0]
    // Opening the map must draw immediately; the regular 200 ms navigation
    // throttle otherwise exposes an empty canvas on the first mobile opening.
    if(open&&navigation&&walking){navigation.mapVisible=true;navigation.draw()}
  }
  document.querySelector('#retry-details').addEventListener('click',()=>{for(const world of walkWorlds.values())world.retry?.();for(const base of baseTiles.values()){base.farStream?.retry();for(const e of base.entries.values())if(e.status==='failed'){e.attempts=0;e.nextTry=0}}for(const stream of streams.values())for(const e of stream.entries.values())if(e.status==='failed'){e.attempts=0;e.nextTry=0}updateStreams(true)})
  document.body.append(VRButton.createButton(renderer))
  renderer.xr.addEventListener('sessionstart',()=>{trackingValid=false;xrLayout();updateHint()})
  renderer.xr.addEventListener('sessionend',()=>{trackingValid=false;controls.enabled=!walking;sun.castShadow=walking||mode!=='colony';xrRig.position.set(0,0,0);xrRig.quaternion.identity();home();updateHint()})
  const controllers=[renderer.xr.getController(0),renderer.xr.getController(1)],grips=[renderer.xr.getControllerGrip(0),renderer.xr.getControllerGrip(1)]
  for(const c of [...controllers,...grips])xrRig.add(c)
  // Resolve handedness at connection: physical browsers do not guarantee index 0 is left.
  const hands={}
  controllers.forEach((c,i)=>c.addEventListener('connected',e=>{hands[e.data.handedness]={controller:c,grip:grips[i]};if(hands.left&&hands.right&&!wrist){wrist=new StudyWrist(hands.left.controller,hands.right.controller,wristAction);wrist.navigation=navigation;window.__plateau.wrist=wrist}}))
  for(const c of controllers)c.addEventListener('select',()=>{if(wrist?.select())return;if(!walking)show(study.samples[(study.samples.findIndex(s=>s.id===selected)+1)%3].id,'flat')})
  const query=new URLSearchParams(location.search),region=query.get('region')
  if(study.samples.some(s=>s.id===region))show(region)
  if(query.get('world')==='colony')walkSpace='colony'
  if(query.get('stop')&&exploration?.stops.some(s=>s.id===query.get('stop')))visitLandmark(query.get('stop'))
  else if(query.get('site')==='east')visitSite('east')
  else if(query.get('walk')==='1')toggleWalk()
}
addEventListener('keydown',e=>{if(!walking||e.target instanceof Element&&e.target.closest('input,select,textarea'))return;if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault()}})
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();touchMove=[0,0];drag=null})
renderer.domElement.addEventListener('pointerdown',e=>{if(!walking)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)})
renderer.domElement.addEventListener('pointermove',e=>{if(!walking||!drag||drag.id!==e.pointerId)return;player.yaw-=(e.clientX-drag.x)*.004;player.pitch=Math.max(-1.25,Math.min(1.25,player.pitch-(e.clientY-drag.y)*.003));drag={id:e.pointerId,x:e.clientX,y:e.clientY};poseWalker()})
renderer.domElement.addEventListener('pointerup',()=>drag=null);renderer.domElement.addEventListener('pointercancel',()=>drag=null)
for(const button of document.querySelectorAll('[data-step]')){button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touchMove=JSON.parse(button.dataset.step)});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>touchMove=[0,0])}
const resize=()=>{const {width,height}=viewport.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();if(study&&!renderer.xr.isPresenting)home();updateHint()}
addEventListener('resize',resize);resize()
const eyeWorld=new T.Vector3(),viewForward=new T.Vector3()
function updateStreams(force=false){
  if(!window.__plateau?.ready)return
  content.updateWorldMatrix(true,true);camera.updateWorldMatrix(true,false)
  if(renderer.xr.isPresenting){if(!trackingValid)return;xrRig.updateWorldMatrix(true,false);eyeWorld.copy(trackedHead).applyMatrix4(xrRig.matrixWorld)}
  else camera.getWorldPosition(eyeWorld)
  if(renderer.xr.isPresenting)viewForward.copy(trackedForward).transformDirection(xrRig.matrixWorld);else camera.getWorldDirection(viewForward)
  window.__plateau.tracking={valid:trackingValid,eyeWorld:eyeWorld.toArray()}
  for(const [id,s] of streams)s.update(eyeWorld,{active:id===selected,tabletop:renderer.xr.isPresenting&&!walking&&mode!=='colony',force})
  for(const [id,s] of baseTiles)s.update(eyeWorld,{active:id===selected&&walking,force,direction:viewForward,visible:mode==='colony'||id===selected,overview:!walking})
  for(const [id,world] of walkWorlds)world.update?.(player?.x??0,player?.y??0,{active:walking&&id===selected,force})
  const failed=list=>[...list.values()].some(s=>[...s.entries.values()].some(e=>e.wanted&&e.status==='failed'))
  const collisionFailed=failed(new Map([...walkWorlds].filter(([,w])=>w.entries))),farFailed=[...baseTiles.values()].some(b=>b.farStream&&failed(new Map([['far',b.farStream]])))
  document.querySelector('#retry-details').hidden=!(collisionFailed||farFailed||failed(baseTiles)||failed(streams))
  document.querySelector('#detail-status').textContent=collisionFailed?'足元の街区を読み込めません。移動を一時停止しています。':walking&&walkWorlds.get(selected).waiting?'足元の街区を読み込み中…':farFailed?'一部の遠景を読み込めませんでした。再読み込みできます。':failed(baseTiles)?'一部の街区を読み込めませんでした。遠景の建物と道路を引き続き表示しています。':failed(streams)?'一部の外観を読み込めませんでした。建物と道路は引き続き表示しています。':''
}
renderer.setAnimationLoop((time,frame)=>{
  if(renderer.xr.isPresenting&&frame){const pose=frame.getViewerPose(renderer.xr.getReferenceSpace());trackingValid=!!pose
    if(pose){const p=pose.transform.position,q=pose.transform.orientation;trackedHead.set(p.x,p.y,p.z);trackedQuaternion.set(q.x,q.y,q.z,q.w);trackedForward.set(0,0,-1).applyQuaternion(trackedQuaternion)}
  }
  const dt=Math.min(.05,Math.max(0,(time-lastTime)/1000));lastTime=time;if(walking)updateWalking(dt);else if(!renderer.xr.isPresenting)controls.update()
  updateStreams()
  const guiding=!!navigation&&walking
  if(guiding){
    navigation.mapVisible=!renderer.xr.isPresenting&&navigation.canvas.offsetParent!==null
    let yaw=player.yaw
    if(renderer.xr.isPresenting&&trackingValid){const a=surfaceAngle(study.radius,study.samples.find(s=>s.id===selected),mode,player.x),x=viewForward.x*Math.cos(a)+viewForward.y*Math.sin(a),y=-viewForward.z;if(Math.hypot(x,y)>.1)yaw=Math.atan2(-x,y)}
    navigation.update(player,walkWorlds.get(selected),yaw,time);document.querySelector('#nav-status').textContent=navigation.status
    document.querySelector('#guide-goal').textContent=navigation.goal?.label??'';document.querySelector('#guide-status').textContent=navigation.status
  }
  document.querySelector('#guide-surface').hidden=!(guiding&&navigation.goal)
  wrist?.update(renderer.xr.isPresenting,selected,walking)
  if(facades.size&&(!renderer.xr.isPresenting||trackingValid))for(const f of facades.values())f.updateLOD(eyeWorld,window.__plateau?.forceFacadeLOD)
  renderer.render(scene,camera);if(first&&window.__plateau){first=false;window.__plateau.rendered=true}})
main().catch(fail)
