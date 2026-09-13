import * as THREE from 'three'

const data=(window as any).bandGeometryReview
const focus=document.querySelector<HTMLSelectElement>('#focus')!,container=document.querySelector<HTMLElement>('#mesh')!
const scenes=data.meshes.map((pair:any[])=>{
  const scene=new THREE.Scene()
  pair.forEach((json,i)=>scene.add(new THREE.Mesh(new THREE.BufferGeometryLoader().parse(json),new THREE.MeshBasicMaterial({color:i?'#adbbb9':'#4c5b60',side:THREE.DoubleSide}))))
  return scene
})
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.autoClear=false
renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','道路の3D比較');container.append(renderer.domElement)
const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info')
const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'GPU情報取得不可'
document.querySelector('#gpu')!.textContent=gpu
if(/SwiftShader|llvmpipe|Software/i.test(gpu))throw Error('Hardware GPU required for this visual review')
const camera=new THREE.PerspectiveCamera(45,1,.1,2000)
let oblique=false,dark=false
const places={
  south:{x:970,y:-19300,span:1000,note:'同じ立体横断へ向かう二つの接近路を、固定した南端ICの先で共有します。赤い鋭角が消え、ICの橙点は同じ位置を保ちます。'},
  east:{x:1200,y:3880,span:820,note:'ほぼ並走していた集散道路を一本の接近路へまとめます。横から入る道路の外側の接続先は保持します。'},
  short:{x:490.64,y:8538.35,span:160,note:'0.64mしか離れていなかった二つの交差点を一つにまとめます。中心線表示を切り替えると、車道幅の中に隠れていた区間を確認できます。'},
  north:{x:530,y:18180,span:1300,note:'未解決：北部の長い並走路に0.855°の鋭角が残ります。赤円の位置が移っただけで、ここを走行可能な合流として扱っていません。'}
}
function draw() {
  const p=places[focus.value as keyof typeof places]
  document.querySelector('#focus-note')!.textContent=p.note
  document.querySelectorAll('.compare h2').forEach((h,i)=>h.textContent=(i?'整理後':'整理前')+' — '+focus.selectedOptions[0].textContent)
  for(const svg of document.querySelectorAll('svg'))svg.setAttribute('viewBox',`${p.x-p.span/2} ${-p.y-p.span/2} ${p.span} ${p.span}`)
  const width=container.clientWidth,height=container.clientHeight,half=width/2
  renderer.setSize(width,height,false);renderer.setClearColor(dark?'#17272c':'#e7e6d9',1);renderer.setScissorTest(false);renderer.clear()
  const angle=p.x/3200,c=Math.cos(angle),s=Math.sin(angle),heightAbove=p.span*.8
  camera.position.set(c*(3200-heightAbove),p.y-(oblique?p.span*.5:0),s*(3200-heightAbove))
  camera.up.set(0,1,0);camera.lookAt(c*3200,p.y,s*3200);camera.aspect=half/height;camera.updateProjectionMatrix()
  renderer.setScissorTest(true)
  scenes.forEach((scene:THREE.Scene,i:number)=>{renderer.setViewport(i*half,0,half,height);renderer.setScissor(i*half,0,half,height);renderer.render(scene,camera)})
  renderer.setScissorTest(false)
  document.querySelector('#mesh-status')!.textContent=`半径3,200m / ${oblique?'斜め':'真上'} / ${dark?'暗背景':'明背景'} / 幅・高さの同じ比較。夜景の照明検証ではありません。`
}
focus.addEventListener('change',draw)
document.querySelector('#lines')!.addEventListener('change',e=>document.body.classList.toggle('hide-lines',!(e.target as HTMLInputElement).checked))
document.querySelector('#angle')!.addEventListener('click',()=>{oblique=!oblique;document.querySelector('#angle')!.textContent=oblique?'真上から見る':'斜めから見る';draw()})
document.querySelector('#night')!.addEventListener('click',()=>{dark=!dark;document.querySelector('#night')!.textContent=dark?'明るい背景で見る':'暗い背景で見る';draw()})
window.addEventListener('resize',draw)
window.addEventListener('pagehide',()=>{for(const scene of scenes)scene.traverse((o:any)=>{o.geometry?.dispose();o.material?.dispose()});renderer.dispose()})
draw()
