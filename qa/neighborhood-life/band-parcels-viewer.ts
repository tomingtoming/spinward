type Point=[number,number]
const data=await fetch('land.json').then(r=>r.json())
const main=document.querySelector<HTMLCanvasElement>('#map')!,overview=document.querySelector<HTMLCanvasElement>('#overview')!
const focus=document.querySelector<HTMLSelectElement>('#focus')!,parcels=document.querySelector<HTMLInputElement>('#parcels')!,buildings=document.querySelector<HTMLInputElement>('#buildings')!
const views:Record<string,{x:number;y:number;span:number;note:string}>={
  arrival:{x:560,y:250,span:1800,note:'到着地区。カフェ・アパート・ロビーの位置を固定して、新しい道と川の案を調整。'},
  public:{x:-100,y:115,span:700,note:'中央広場と公園。緑の輪郭が保持する実際の敷地。道路は保護域を回り、計画中心の移動で元の到着位置を守ります。'},
  garden:{x:660,y:980,span:1750,note:'Garden streetと川沿い。川筋案を西へ寄せ、既存のGarden street敷地を保護。川沿いは既存橋と同じ水辺予約地に含めます。'},
  cafe:{x:380,y:-260,span:410,note:'カフェとアパート。実際の建物・敷地・入口を囲む保護域と、道路への接続点。'},
  lobby:{x:1170,y:100,span:330,note:'ロビー。元の敷地を保護。入口から道路の接続点までの横断設計は未確定。'},
  market:{x:80,y:-12500,span:2800,note:'南部商業・住宅地区。道路に接する敷地と、奥に残る広い土地。'},
  park:{x:30,y:8350,span:2700,note:'北部の公園地区。緑地と川を先に確保し、道路からの奥行きを制限。'},
  port:{x:350,y:-18200,span:2700,note:'南端物流JCT。高速道路と施設の予約地を避ける区画。桁の高さはこの平面図には表示しません。'}
}
let view={...views.arrival}
type Shape={points:Point[];colour:string;bounds:number[];stroke?:string}
const shape=(points:Point[],colour:string,stroke?:string):Shape=>({points,colour,stroke,bounds:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]})
const reserveColours={water:'#a7cbd0',green:'#aac199',facility:'#d9b8b1',transport:'#c0afd1'}
const reserves=data.site.reserves.map(r=>shape(r.polygon,r.id.startsWith('living-')?'#e4c194':reserveColours[r.kind],r.id.startsWith('living-')?'#a66831':undefined))
const pavement=[...data.sidewalks.map(p=>shape(p,'#a9b6b0')),...data.carriageways.map(p=>shape(p,'#596767'))]
const cells=data.parcels.flatMap((p,i)=>p.pieces.map(q=>shape(q,['#d9cdac','#d2c3a1','#ded2b5','#cfc5a7'][i%4])))
const footprints=data.parcels.map(p=>{const b=p.building,c=Math.cos(b.yaw),s=Math.sin(b.yaw);return shape([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[b.x+c*x*b.width/2-s*y*b.depth/2,b.y+s*x*b.width/2+c*y*b.depth/2]),'#7d8177')})
const living=data.places.map(p=>shape(p.footprint,'#985f39','#794421'))
const publicPlaces=(data.publicPlaces??[]).map(p=>shape(p.footprint,p.sharedReserve?'#83b5b6':'#b0c296','#375f42'))
function draw(canvas:HTMLCanvasElement,v:typeof view,mini=false){
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=devicePixelRatio
  canvas.width=w*dpr;canvas.height=h*dpr
  const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.fillStyle='#dde3d8';ctx.fillRect(0,0,w,h)
  const scale=Math.min(w,h)/v.span,halfX=w/scale/2,halfY=h/scale/2
  const project=([x,y]:Point)=>[(x-v.x)*scale+w/2,(v.y-y)*scale+h/2]
  const paint=(s:Shape)=>{
    const [x0,y0,x1,y1]=s.bounds;if(x1<v.x-halfX||x0>v.x+halfX||y1<v.y-halfY||y0>v.y+halfY)return
    ctx.beginPath();s.points.forEach((p,i)=>{const[x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.fillStyle=s.colour;ctx.fill()
    if(s.stroke){ctx.strokeStyle=s.stroke;ctx.lineWidth=1.3;ctx.stroke()}
  }
  paint(shape([[-data.site.width/2,-data.site.length/2],[data.site.width/2,-data.site.length/2],[data.site.width/2,data.site.length/2],[-data.site.width/2,data.site.length/2]],'#cfd8be'))
  reserves.forEach(paint)
  if(!mini&&parcels.checked)cells.forEach(paint)
  publicPlaces.forEach(paint)
  pavement.forEach(paint)
  if(!mini&&buildings.checked)footprints.forEach(paint)
  living.forEach(paint)
  if(!mini){
    ctx.font='13px system-ui';ctx.textAlign='left'
    if(scale>.15)for(const p of data.publicPlaces??[]){
      const x=p.footprint.reduce((n,v)=>n+v[0],0)/p.footprint.length,y=Math.max(...p.footprint.map(v=>v[1]))
      const [px,py]=project([x,y]),label={square:'中央広場',park:'公園',garden:'Garden street',riverside:'既存の川沿い'}[p.id],width=ctx.measureText(label).width
      ctx.fillStyle='#fffdf6e6';ctx.fillRect(px-width/2-4,py-23,width+8,20);ctx.fillStyle='#375f42';ctx.fillText(label,px-width/2,py-8)
    }
    for(const p of data.places){
      const a=project(p.entrance),b=project(p.access.point)
      ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle='#a6632b';ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([])
      ctx.fillStyle='#a6632b';ctx.beginPath();ctx.arc(...b,3,0,2*Math.PI);ctx.fill()
      if(scale>.5){ctx.fillStyle='#704725';ctx.fillText({cafe:'カフェ',apartment:'アパート',lobby:'ロビー'}[p.id],a[0]+9,a[1]-8)}
    }
    const metres=v.span>1000?500:100,y=h-25,x=24;ctx.fillStyle='#fffdf6e6';ctx.fillRect(x-7,y-27,Math.max(60,metres*scale)+14,38)
    ctx.strokeStyle='#33433e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+metres*scale,y);ctx.stroke();ctx.fillStyle='#33433e';ctx.fillText(metres+' m',x,y-6)
  }else{
    const scaleMain=Math.min(main.clientWidth,main.clientHeight)/view.span
    const a=project([view.x-main.clientWidth/scaleMain/2,view.y+main.clientHeight/scaleMain/2]),b=project([view.x+main.clientWidth/scaleMain/2,view.y-main.clientHeight/scaleMain/2])
    ctx.strokeStyle='#994f2d';ctx.lineWidth=1.5;ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1])
  }
}
function render(){
  draw(main,view);draw(overview,{x:0,y:0,span:data.site.length*Math.min(overview.clientWidth,overview.clientHeight)/overview.clientHeight*1.03,note:''},true)
  requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelector('#status')!.textContent=view.note+' 表示済み。'}))
}
function reset(){view={...views[focus.value]};render()}
focus.addEventListener('change',reset);document.querySelector('#reset')!.addEventListener('click',reset)
parcels.addEventListener('change',render);buildings.addEventListener('change',render);window.addEventListener('resize',render)
let drag:{x:number;y:number}|undefined
main.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};main.setPointerCapture(e.pointerId)})
main.addEventListener('pointermove',e=>{if(!drag)return;const s=Math.min(main.clientWidth,main.clientHeight)/view.span;view.x-=(e.clientX-drag.x)/s;view.y+=(e.clientY-drag.y)/s;drag={x:e.clientX,y:e.clientY};render()})
main.addEventListener('pointerup',()=>{drag=undefined});main.addEventListener('pointercancel',()=>{drag=undefined})
main.addEventListener('wheel',e=>{e.preventDefault();view.span=Math.max(100,Math.min(40000,view.span*Math.exp(e.deltaY*.001)));render()},{passive:false})
focus.disabled=false
render()
