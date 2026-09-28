import {WalkWorld} from './walking.js'

async function fetchWalk(tile,signal){
  const r=await fetch('/'+tile.path,{signal});if(!r.ok)throw Error(`${r.status} ${tile.path}`)
  let b=await r.arrayBuffer();const bytes=new Uint8Array(b)
  if(bytes[0]===31&&bytes[1]===139)b=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if(b.byteLength!==tile.decodedBytes)throw Error('Truncated walking tile')
  return JSON.parse(new TextDecoder().decode(b))
}

// Unknown collision is solid. A late/missing tile can delay walking, never create
// a pass-through building or a fabricated ground height.
export class WalkStream extends WalkWorld{
  constructor(manifest,{fetchTile=fetchWalk,maxBytes=4*1024*1024,maxResident=16,maxConcurrent=2}={}){
    super({buildings:[],water:[],roads:[]});this.data=manifest
    Object.assign(this,{fetchTile,maxBytes,maxResident,maxConcurrent});this.entries=new Map(manifest.tiles.map(t=>[t.id,{tile:t,status:'unloaded',wanted:false,attempts:0,nextTry:0,world:null}]))
    this.running=0;this.loads=0;this.evictions=0;this.failures=0;this.aborted=0;this.lastUpdate=-Infinity;this.disposed=false;this.waiting=false
  }
  entry(x,y){const d=this.data,b=d.bounds??[-d.half,-d.half],g=d.gridShape??[d.grid,d.grid],i=Math.max(0,Math.min(g[0]-1,Math.floor((x-b[0])/d.tileSize))),j=Math.max(0,Math.min(g[1]-1,Math.floor((y-b[1])/d.tileSize)));return this.entries.get(`${i}-${j}`)}
  readyAt(x,y){return this.entry(x,y)?.status==='resident'}
  terrain(x,y){return this.entry(x,y)?.world?.terrain(x,y)??NaN}
  ground(x,y){return this.entry(x,y)?.world?.ground(x,y)??NaN}
  blocked(x,y,r){const e=this.entry(x,y);if(!e?.world){this.lastCandidateCount=0;return true}const result=e.world.blocked(x,y,r);this.lastCandidateCount=e.world.lastCandidateCount;return result}
  move(state,dx,dy){
    this.waiting=!this.readyAt(state.x,state.y)||!this.readyAt(state.x+dx,state.y+dy)
    if(this.waiting)return state
    return super.move(state,dx,dy)
  }
  spawn(){const a=this.data.arrival;return{x:a.spawn[0],y:a.spawn[1],h:a.ground,yaw:a.yaw,pitch:0,rejected:0}}
  update(x,y,{active=true,force=false,now=performance.now()}={}){
    if(this.disposed||(!force&&now-this.lastUpdate<150))return;this.lastUpdate=now
    const candidates=[]
    for(const e of this.entries.values()){
      const b=e.tile.bounds,dx=Math.max(b[0]-x,0,x-b[2]),dy=Math.max(b[1]-y,0,y-b[3]);e.distance=Math.hypot(dx,dy)
      if(active&&e.distance<(e.status==='resident'?150:90))candidates.push(e)
    }
    let bytes=0;const wanted=new Set()
    for(const e of candidates.sort((a,b)=>a.distance-b.distance))if(wanted.size<this.maxResident&&bytes+e.tile.decodedBytes<=this.maxBytes){wanted.add(e.tile.id);bytes+=e.tile.decodedBytes}
    for(const e of this.entries.values()){
      const next=wanted.has(e.tile.id);if(e.wanted&&!next){e.attempts=0;e.nextTry=0}e.wanted=next
      if(!next&&e.status==='resident'){e.world=null;e.status='unloaded';this.evictions++}
      if(!next&&e.status==='loading'&&!e.controller.signal.aborted){e.controller.abort();this.aborted++}
    }
    this.pump(now)
  }
  pump(now=performance.now()){
    if(this.disposed)return
    for(const e of [...this.entries.values()].sort((a,b)=>a.distance-b.distance)){
      if(this.running>=this.maxConcurrent)break
      if(!e.wanted||e.status==='resident'||e.status==='loading'||e.attempts>=3||now<e.nextTry)continue
      const controller=new AbortController();e.controller=controller;e.status='loading';e.attempts++;this.running++
      Promise.resolve().then(()=>this.fetchTile(e.tile,controller.signal)).then(data=>{
        if(this.disposed||controller.signal.aborted||!e.wanted)return
        if(!data.heights?.length||!data.buildings||!data.water||!data.roads)throw Error('Invalid walking tile')
        if(this.boundsOverride)data.bounds=this.boundsOverride
        e.world=new WalkWorld(data);e.status='resident';e.attempts=0;this.loads++
      }).catch(error=>{if(controller.signal.aborted||this.disposed)return;e.status='failed';e.nextTry=performance.now()+500*2**(e.attempts-1);this.failures++})
      .finally(()=>{this.running--;e.controller=null;if(e.status==='loading')e.status='unloaded';this.pump()})
    }
  }
  retry(){for(const e of this.entries.values())if(e.status==='failed'){e.attempts=0;e.nextTry=0}this.pump()}
  diagnostics(){return{resident:[...this.entries.values()].filter(e=>e.world).map(e=>e.tile.id),pending:this.running,loads:this.loads,evictions:this.evictions,failures:this.failures,aborted:this.aborted,waiting:this.waiting,
    decodedBytes:[...this.entries.values()].filter(e=>e.world).reduce((n,e)=>n+e.tile.decodedBytes,0),shapes:[...this.entries.values()].filter(e=>e.world).reduce((n,e)=>n+e.world.data.buildings.length+e.world.data.roads.length+e.world.data.water.length,0)}}
  dispose(){this.disposed=true;for(const e of this.entries.values()){e.wanted=false;e.controller?.abort();e.world=null;e.status='unloaded'}}
}
