// Select clear, traversable bridge strips and the two designed city seams.
// Coordinates are derived from generated geometry rather than fixed screenshots.
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {WalkStream} from './walk-stream.js'
const root=path.resolve(process.argv[2]),d=path.join(root,'derived'),read=p=>JSON.parse(fs.readFileSync(p)),study=read(path.join(d,'study.json')),out=[]
for(const s of study.samples){
 const plan=read(path.join(root,s.id+'-band-routes.json')),manifest=read(path.join(d,s.walkTiles)),world=new WalkStream(manifest,{fetchTile:async t=>JSON.parse(gunzipSync(fs.readFileSync(path.join(d,t.path))))})
 async function ready(x,y){world.update(x,y,{force:true,now:performance.now()});for(let i=0;!world.readyAt(x,y);i++){if(i>1000)throw Error('Tile not ready');await new Promise(r=>setTimeout(r,1))}}
 let selected
 for(const bridge of read(path.join(root,s.id+'-bridges.json')).crossings.filter(v=>v.kind==='bridge').sort((a,b)=>b.area-a.area)){
  const [a,b,c,e]=bridge.bounds,x=(a+c)/2,y=(b+e)/2;await ready(x,y)
  if(world.blocked(x,y)||world.ground(x,y)-world.terrain(x,y)<.2)continue
  for(let k=0;k<24;k++){
   const angle=k*Math.PI/24,dx=Math.cos(angle),dy=Math.sin(angle),points=Array.from({length:81},(_,j)=>[x+dx*(j/2-20),y+dy*(j/2-20)])
   let state={x:points[0][0],y:points[0][1],h:world.ground(...points[0])},ok=!world.blocked(state.x,state.y)
   for(const [px,py] of points.slice(1)){await ready(px,py);const next=world.move(state,px-state.x,py-state.y);if(Math.hypot(next.x-px,next.y-py)>.003){ok=false;break}state=next}
   if(ok){selected={region:s.id,id:'bridge',points,bridge};break}
  }
  if(selected)break
 }
 if(!selected)throw Error('No clear bridge strip: '+s.id);out.push(selected)
 for(const c of plan.connectors){const points=[];for(let i=1;i<c.points.length;i++){const a=c.points[i-1],b=c.points[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5);for(let j=i===1?0:1;j<=n;j++)points.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n])}out.push({region:s.id,id:c.id,points})}
 world.dispose();console.log(s.id,selected.bridge.bounds)
}
fs.writeFileSync(path.join(root,'band-transition-probes.json'),JSON.stringify(out,null,2))
