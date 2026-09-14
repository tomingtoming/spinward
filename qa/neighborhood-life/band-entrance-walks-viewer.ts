import * as THREE from 'three'
import {StreetAccessLayer} from '../../src/objects/streetAccessLayer'
import {buildStreetSurfaceGeometry} from '../../src/objects/streetSurfaceGeometry'
import {getCityGroundHeight} from '../../src/objects/cityLayout'
import {planNeighborhoodRoute} from '../../src/app/neighborhoodRoute'

const data=await fetch('walks.json').then(r=>r.json()),r=3200
const focus=document.querySelector<HTMLSelectElement>('#focus')!,container=document.querySelector<HTMLElement>('#mesh')!,status=document.querySelector('#status')!
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));container.append(renderer.domElement)
renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','玄関と歩道を結ぶ通路の3D検証')
const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'
document.querySelector('#gpu')!.textContent=gpu
if(/SwiftShader|llvmpipe|Software|unknown/i.test(gpu))throw Error('Hardware GPU required')
const scene=new THREE.Scene();scene.background=new THREE.Color('#dfe5de')
scene.add(new THREE.HemisphereLight(0xffffff,0x657860,2.4))
const light=new THREE.DirectionalLight(0xfff3df,2);scene.add(light)
const group=new THREE.Group();scene.add(group)
const access=new StreetAccessLayer(group),camera=new THREE.PerspectiveCamera(52,1,.04,700)
let current:any,colliders:any[]=[],motion:{start:number;reverse:boolean}|null=null,ground=.12
const pos=(x:number,y:number,h:number)=>new THREE.Vector3(Math.cos(x/r)*(r-h),y,Math.sin(x/r)*(r-h))
function resize(){renderer.setSize(container.clientWidth,container.clientHeight,false);camera.aspect=container.clientWidth/container.clientHeight;camera.updateProjectionMatrix()}
function draw(){resize();renderer.render(scene,camera)}
function overview(){
  motion=null;const {walk:w,place:p}=current,[nx,ny]=p.normal,x=w.entrance.x,y=w.entrance.y
  camera.up.set(-Math.cos(x/r),0,-Math.sin(x/r))
  camera.position.copy(pos(x+nx*25+ny*16,y+ny*25-nx*16,16))
  camera.lookAt(pos(x+nx*5,y+ny*5,1));status.textContent=focus.selectedOptions[0].textContent+' — 玄関・通路・歩道を表示済み。';draw()
}
function select(){
  motion=null;access.clear()
  for(const m of [...group.children] as THREE.Mesh[]){if(m===access.group)continue;m.geometry?.dispose();(m.material as THREE.Material)?.dispose();group.remove(m)}
  current=data.find((d:any)=>d.place.id===focus.value);const {walk:w,sidewalks,roads,parts}=current
  const plan={roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null,entranceWalks:[w]}
  access.rebuild(plan,r,w.source.azimuth,w.source.axial)
  const x=w.entrance.x,y=w.entrance.y,polygon=[[-80,-80],[80,-80],[80,80],[-80,80]].map(([dx,dy])=>({x:x+dx,y:y+dy,u:0,v:0}))
  for(const [surfaces,color]of [[[{polygon,lift:0}],'#9fae88'],[roads,'#566061'],[sidewalks,'#a7b2a6']]as const){
    const inputs=surfaces.map((s:any)=>({source:{azimuth:0,axial:0},polygon:s.polygon,lift:s.lift}))
    const geometry=buildStreetSurfaceGeometry(inputs,r,4)
    if(geometry)group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.95})))
  }
  const palette={wall:'#c9bdad',upper:'#cdc8b9',wood:'#89745b',green:'#738971',light:'#eee0ad',sign:'#9c7960'}
  for(const {box:b,material}of parts){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(b.width,b.height,b.depth),new THREE.MeshStandardMaterial({color:palette[material],roughness:.9}))
    // Box x=tangent, y=inward, z=axial. Preserve the authored opening.
    const a=b.azimuth;mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-Math.sin(a),0,Math.cos(a)),new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)),new THREE.Vector3(0,-1,0)))
    mesh.position.copy(pos(a*r,b.axial,(b.baseHeight??0)+b.height/2));group.add(mesh)
  }
  colliders=[w.collider,...sidewalks.map((s:any)=>{
    const mesh:number[]=[],p=s.polygon
    for(let i=1;i<p.length-1;i++)for(const v of [p[0],p[i],p[i+1]])mesh.push(v.x-x,v.y-y,s.lift)
    return{...w.collider,surfaceMesh:mesh}
  })]
  const route=planNeighborhoodRoute(plan,r,{...w.source,groundHeight:.12},{azimuth:w.landing.x/r,axial:w.landing.y,groundHeight:w.landingHeight},false)!
  if(!route)throw Error('Missing entrance route')
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.map(p=>pos(p.azimuth*r,p.axial,p.groundHeight!+.025))),new THREE.LineBasicMaterial({color:'#287e99'}));group.add(line)
  light.position.copy(pos(x+30,y-40,60));light.target.position.copy(pos(x,y,0));scene.add(light.target)
  document.querySelector('#measure')!.textContent=`幅 ${w.width} m　長さ ${w.length.toFixed(2)} m　最大勾配 ${(w.maximumGrade*100).toFixed(2)}%　歩道の高さ ${w.landingHeight.toFixed(2)} m`
  overview()
}
function walk(reverse:boolean){motion={start:performance.now(),reverse};ground=reverse?current.walk.landingHeight:.12;requestAnimationFrame(tick)}
function tick(now:number){
  if(!motion)return
  const {walk:w,place:p}=current,t=Math.min(1,(now-motion.start)/6000),f=motion.reverse?1-t:t
  const x=w.entrance.x+(w.landing.x-w.entrance.x)*f,y=w.entrance.y+(w.landing.y-w.entrance.y)*f
  ground=getCityGroundHeight(colliders,r,x/r,y,ground,.1)
  if(ground<.1199)throw Error('Unsupported walk')
  camera.position.copy(pos(x,y,ground+1.65));camera.up.set(-Math.cos(x/r),0,-Math.sin(x/r))
  const direction=motion.reverse?-1:1;camera.lookAt(pos(x+p.normal[0]*direction*10,y+p.normal[1]*direction*10,ground+1.35))
  status.textContent=focus.selectedOptions[0].textContent+` — ${t===1?(motion.reverse?'玄関に到着':'歩道に到着'):'歩行中'} / 足元 ${ground.toFixed(3)} m`;draw()
  if(t<1)requestAnimationFrame(tick);else motion=null
}
focus.addEventListener('change',select);document.querySelector('#overview')!.addEventListener('click',overview)
document.querySelector('#walk')!.addEventListener('click',()=>walk(false));document.querySelector('#back')!.addEventListener('click',()=>walk(true))
window.addEventListener('resize',draw);window.addEventListener('pagehide',()=>{motion=null;access.dispose();scene.traverse((o:any)=>{o.geometry?.dispose();o.material?.dispose()});renderer.dispose()})
focus.disabled=false;select()
