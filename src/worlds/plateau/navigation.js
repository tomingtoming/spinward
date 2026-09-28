// Guidance follows the verified street network; an off-route position is never
// silently joined by a straight line through buildings.
export class NavigationGuide {
  constructor(data,canvas){
    this.data=data;this.canvas=canvas;this.goal=null;this.route=[];this.status='行き先を選ぶと、道路に沿った経路を表示します。';this.lastUpdate=-Infinity
    this.adj=data.network.nodes.map(()=>[])
    for(const [a,b,d] of data.network.edges){this.adj[a].push([b,d]);this.adj[b].push([a,d])}
    // The source streets are static. Rasterize once rather than replaying all
    // 21,000 road vertices on every position/heading update.
    if(data.mapTiles){this.mapTiles=new Map(data.mapTiles.map(t=>[t.id,t]));this.mapCache=new Map()}
    else if(canvas){
      this.map=canvas.ownerDocument.createElement('canvas');this.map.width=this.map.height=2048
      const c=this.map.getContext('2d'),half=data.half,scale=2048/(half*2)
      c.fillStyle='#e6e9de';c.fillRect(0,0,2048,2048);c.fillStyle='#b5c0b8'
      for(const polygon of data.mapRoads){c.beginPath();for(const ring of polygon){ring.forEach((p,i)=>{const x=(p[0]+half)*scale,y=(half-p[1])*scale;i?c.lineTo(x,y):c.moveTo(x,y)});c.closePath()}c.fill('evenodd')}
    }
  }
  setGoal(id){
    const destination=this.data.destinations.find(v=>v.id===id);if(!destination)throw Error('Unknown destination')
    this.goal=destination;this.dist=this.adj.map(()=>Infinity);this.next=[];this.dist[destination.node]=0
    const todo=new Set(this.adj.map((_,i)=>i))
    while(todo.size){let best=-1;for(const n of todo)if(best<0||this.dist[n]<this.dist[best])best=n
      if(!Number.isFinite(this.dist[best]))break;todo.delete(best)
      for(const [n,d] of this.adj[best])if(this.dist[n]>this.dist[best]+d){this.dist[n]=this.dist[best]+d;this.next[n]=best}
    }
    this.lastUpdate=-Infinity
  }
  update(player,world,yaw,time){
    if(time-this.lastUpdate<200)return;this.lastUpdate=time;this.player={...player};this.yaw=yaw
    const closest=this.data.destinations.map(d=>({d,distance:Math.hypot(d.point[0]-player.x,d.point[1]-player.y)})).sort((a,b)=>a.distance-b.distance)[0]
    this.location=`${closest.d.label}から ${Math.round(closest.distance)} m`
    if(this.goal){
      const {nodes,edges}=this.data.network;let nearest=null
      for(const [a,b,d] of edges){const A=nodes[a],B=nodes[b],t=Math.max(0,Math.min(1,((player.x-A[0])*(B[0]-A[0])+(player.y-A[1])*(B[1]-A[1]))/(d*d))),p=[A[0]+t*(B[0]-A[0]),A[1]+t*(B[1]-A[1])],away=Math.hypot(p[0]-player.x,p[1]-player.y)
        if(!nearest||away<nearest.away)nearest={a,b,d,t,p,away}
      }
      const n=nearest;let at=n.t*n.d+this.dist[n.a]<(1-n.t)*n.d+this.dist[n.b]?n.a:n.b
      this.route=[n.p,nodes[at]];this.remaining=n.away+Math.hypot(n.p[0]-nodes[at][0],n.p[1]-nodes[at][1])+this.dist[at]
      let count=0;while(at!==this.goal.node&&count++<nodes.length){at=this.next[at];if(at===undefined)break;this.route.push(nodes[at])}
      this.onRoute=n.away<=5
      if(this.onRoute){let prior=world.ground(player.x,player.y);for(let i=1,steps=Math.max(1,Math.ceil(n.away/.15));i<=steps;i++){
        const x=player.x+(n.p[0]-player.x)*i/steps,y=player.y+(n.p[1]-player.y)*i/steps,h=world.ground(x,y)
        if(world.blocked(x,y)||!Number.isFinite(h)||Math.abs(h-prior)>.22+n.away/steps*.7){this.onRoute=false;break}prior=h
      }}
      this.arrived=Math.hypot(player.x-this.goal.point[0],player.y-this.goal.point[1])<5
      let target=this.route.find(p=>Math.hypot(p[0]-player.x,p[1]-player.y)>6)??this.goal.point
      const desired=Math.atan2(-(target[0]-player.x),target[1]-player.y),angle=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw))
      const heading=Math.abs(angle)<.45?'↑ 前方':Math.abs(angle)>2.4?'↓ 後方':angle>0?'← 左へ':'→ 右へ'
      this.status=this.arrived?`${this.goal.label}に到着`:!Number.isFinite(this.remaining)?'経路がつながっていません':!this.onRoute?`経路まで ${Math.ceil(n.away)} m · 地図で周囲の道を確認`:`${heading} · あと ${Math.round(this.remaining)} m`
    }
    this.draw()
  }
  draw(){
    const c=this.canvas?.getContext('2d');if(!c||!this.player||this.mapVisible===false)return
    const w=this.canvas.width,h=this.canvas.height,span=700,scale=w/span,cx=this.player.x,cy=this.player.y,point=p=>[(p[0]-cx)*scale+w/2,h/2-(p[1]-cy)*scale]
    c.fillStyle='#e6e9de';c.fillRect(0,0,w,h)
    c.save();c.beginPath();c.rect(0,0,w,h);c.clip()
    if(this.map){const unit=this.map.width/(this.data.half*2);c.drawImage(this.map,(cx+this.data.half-span/2)*unit,(this.data.half-cy-h/(2*scale))*unit,span*unit,h/scale*unit,0,0,w,h)}
    if(this.mapTiles){
      for(let ix=Math.floor((cx-span/2)/1000);ix<=Math.floor((cx+span/2)/1000);ix++)for(let iy=Math.floor((cy-h/(2*scale))/1000);iy<=Math.floor((cy+h/(2*scale))/1000);iy++){
        const id=ix+','+iy;let image=this.mapCache.get(id)
        if(!image){
          image=this.canvas.ownerDocument.createElement('canvas');image.width=image.height=512;const context=image.getContext('2d'),factor=512/1000
          context.fillStyle='#e6e9de';context.fillRect(0,0,512,512)
          for(const zone of this.data.zones??[]){const b=zone.bounds;context.fillStyle=zone.colour;context.globalAlpha=.35;context.fillRect((b[0]-ix*1000)*factor,((iy+1)*1000-b[3])*factor,(b[2]-b[0])*factor,(b[3]-b[1])*factor)}
          context.globalAlpha=1;context.fillStyle='#9eafa7'
          for(const polygon of this.mapTiles.get(id)?.roads??[]){context.beginPath();for(const ring of polygon){ring.forEach((p,i)=>{const x=(p[0]-ix*1000)*factor,y=((iy+1)*1000-p[1])*factor;i?context.lineTo(x,y):context.moveTo(x,y)});context.closePath()}context.fill('evenodd')}
          this.mapCache.set(id,image);while(this.mapCache.size>16)this.mapCache.delete(this.mapCache.keys().next().value)
        }else{this.mapCache.delete(id);this.mapCache.set(id,image)}
        const p=point([ix*1000,(iy+1)*1000]);c.drawImage(image,p[0],p[1],1000*scale,1000*scale)
      }
    }
    const path=(points,color,width)=>{c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.beginPath();points.forEach((p,i)=>{const q=point(p);i?c.lineTo(...q):c.moveTo(...q)});c.stroke()}
    c.strokeStyle='#899e90';c.lineWidth=2;c.beginPath()
    const extentY=h/(2*scale)
    for(const [a,b] of this.data.network.edges){
      const A=this.data.network.nodes[a],B=this.data.network.nodes[b]
      if(Math.max(A[0],B[0])<cx-span/2||Math.min(A[0],B[0])>cx+span/2||Math.max(A[1],B[1])<cy-extentY||Math.min(A[1],B[1])>cy+extentY)continue
      c.moveTo(...point(A));c.lineTo(...point(B))
    }
    c.stroke()
    if(this.goal)path(this.route,'#176e70',5)
    if(this.goal){const p=point(this.goal.point);c.fillStyle='#965626';c.beginPath();c.arc(...p,7,0,Math.PI*2);c.fill()}
    c.translate(w/2,h/2);c.rotate(-this.yaw);c.fillStyle='#153f52';c.strokeStyle='#fff';c.lineWidth=2;c.beginPath();c.moveTo(0,-11);c.lineTo(8,8);c.lineTo(0,4);c.lineTo(-8,8);c.closePath();c.fill();c.stroke();c.restore()
    c.fillStyle='#25494b';c.font='14px system-ui';c.fillText('現在地',w/2+12,h/2+5)
    const north=this.data.north;c.strokeStyle='#25494b';c.lineWidth=2;c.beginPath();c.moveTo(28,32);c.lineTo(28+north[0]*18,32-north[1]*18);c.stroke();c.fillText('北',18+north[0]*28,38-north[1]*28)
    c.fillRect(12,h-20,100*scale,2);c.fillText('100 m',12,h-26)
  }
}
