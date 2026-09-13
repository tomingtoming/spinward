import * as THREE from 'three'

const places=await (await fetch('scenes.json')).json()
const select=document.querySelector<HTMLSelectElement>('#place')!,view=document.querySelector<HTMLSelectElement>('#view')!,container=document.querySelector<HTMLElement>('#mesh')!
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#d6ded7')
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap
renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','川と道路の高さの3D検査');container.append(renderer.domElement)
const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'GPU情報取得不可'
document.querySelector('#gpu')!.textContent=gpu
if(/SwiftShader|llvmpipe|Software/i.test(gpu))throw Error('Hardware GPU required')
const point=(x:number,y:number,h:number)=>new THREE.Vector3(Math.cos(x/3200)*(3200-h),y,Math.sin(x/3200)*(3200-h))
const scenes=places.map((p:any)=>{
  const scene=new THREE.Scene(),issueGroup=new THREE.Group()
  const light=new THREE.DirectionalLight('#fff4db',2);light.position.copy(point(p.x-200,p.y-200,500));light.target.position.copy(point(p.x,p.y,0))
  light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-p.span,right:p.span,top:p.span,bottom:-p.span,near:1,far:4000});light.shadow.bias=-.00001;light.shadow.normalBias=.05
  scene.add(light,light.target,new THREE.AmbientLight('#d4e1eb',.9))
  p.parts.forEach((part:any)=>{const mesh=new THREE.Mesh(new THREE.BufferGeometryLoader().parse(part.geometry),new THREE.MeshStandardMaterial({color:part.color,roughness:.93,metalness:0,side:THREE.DoubleSide,transparent:!!part.opacity,opacity:part.opacity??1}));mesh.castShadow=/橋桁|専用道路|一般道路面/.test(part.name);mesh.receiveShadow=true;scene.add(mesh)})
  p.conflicts.forEach((c:any)=>{
    const marker=new THREE.Mesh(new THREE.SphereGeometry(p.id==='jct'?4:2,12,8),new THREE.MeshBasicMaterial({color:c.sharedNode?'#d88724':'#cb3b2e'}))
    marker.position.copy(point(c.point[0],c.point[1],12));issueGroup.add(marker)
  })
  scene.add(issueGroup);return {scene,issueGroup}
})
// The review has no sub-metre camera shots. Preserve depth precision for the
// thin paving/grass layers instead of inheriting the inhabited world's range.
const camera=new THREE.PerspectiveCamera(45,1,2,6000)
let revision=0
async function draw(){
  const drawRevision=++revision
  const i=places.findIndex((p:any)=>p.id===select.value),p=places[i],s=scenes[i],river=p.id==='river'
  for(const option of view.options)if(option.value.endsWith('walk'))option.disabled=!river
  if(!river&&view.value.endsWith('walk'))view.value='near'
  const issue=p.conflicts.find((c:any)=>!c.sharedNode)??p.conflicts[0]
  for(const option of view.options)if(option.value==='conflict')option.disabled=!issue
  if(view.value==='conflict'&&!issue)view.value='near'
  const width=container.clientWidth,height=container.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix()
  const poses=river?{near:[-65,-65,12,0,0,2],wide:[-160,-160,90,0,0,1],side:[0,-90,3,0,0,2],top:[0,0,400,0,0,0],
    'west-walk':[-13.5,-24,2.9,-13.5,30,2.6],'east-walk':[13.5,-24,2.9,13.5,30,2.6]}:
    {near:[-p.span*.45,-p.span*.35,70,0,0,5],wide:[-p.span*.8,-p.span*.7,p.span*.5,0,0,5],side:[-p.span*.75,0,12,0,0,6],top:[0,0,p.span*1.4,0,0,0]}
  const close=view.value==='conflict',v=close?[-30,-45,20,0,0,9]:poses[view.value as keyof typeof poses]
  const x=close?issue.point[0]:p.x,y=close?issue.point[1]:p.y
  camera.position.copy(point(x+v[0],y+v[1],v[2]));camera.up.set(-Math.cos(x/3200),0,-Math.sin(x/3200))
  if(view.value==='top')camera.up.set(0,1,0)
  camera.lookAt(point(x+v[3],y+v[4],v[5]))
  s.issueGroup.visible=document.querySelector<HTMLInputElement>('#issues')!.checked
  renderer.render(s.scene,camera)
  document.querySelector('#note')!.textContent=river?'上の街路と低い川沿い歩道を分け、橋の下に通行空間を残します。桁下面から川沿い歩道まで3.39m。橋の構造・柵・上下移動の入口は次段です。':
    p.id==='underpass'?'一般道を高さ0.2mで通し、高架本線の下面は9.2m。車道幅が重なる位置でも9.0mの空間を確認。支柱の位置と径間はまだ設計していません。':
    '未成立の高さ案。赤＝共通ノードなし、橙＝共通ノードありの干渉位置。反対車線との交差や、合流する路面の段差を平面配置と縦断から設計し直します。'
  document.querySelector('#dimensions')!.textContent=river?'水面 0.65m ／ 下歩道 1.26m ／ 上歩道 5.06m ／ 橋面 5.20m ／ 桁下面 4.65m。外殻＝0m。':
    close?`焦点の道路組の最小空間 ${issue.minimumClearance.toFixed(2)}m（負値＝桁への食い込み）。印は測定した平面位置で、高さの目盛りではありません。`:
      '一般道・ICゲート 0.20m ／ 高架上面 10.20m・下面 9.20m ／ JCT上昇の最大 17.20m。外殻＝0m。'
  // A separate DOM status acknowledges a committed frame before evidence is
  // captured. Rapid UI actions must not label an earlier compositor frame.
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
  if(drawRevision!==revision)return
  document.querySelector('#status')!.textContent=`${p.name} / ${view.selectedOptions[0].textContent} / 半径3,200m / 三角形 ${renderer.info.render.triangles.toLocaleString()} / ${renderer.shadowMap.enabled?'影あり':'影なし'} / 実寸比`
}
select.addEventListener('change',draw);view.addEventListener('change',draw);document.querySelector('#issues')!.addEventListener('change',draw);window.addEventListener('resize',draw)
document.querySelector('#shadows')!.addEventListener('change',e=>{
  const enabled=(e.target as HTMLInputElement).checked;renderer.shadowMap.enabled=enabled
  for(const s of scenes)s.scene.traverse((o:any)=>{if(o.isDirectionalLight)o.castShadow=enabled;if(o.material)o.material.needsUpdate=true})
  draw()
})
window.addEventListener('pagehide',()=>{for(const s of scenes)s.scene.traverse((o:any)=>{o.geometry?.dispose();o.material?.dispose()});renderer.dispose()})
draw()
