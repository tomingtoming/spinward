import assert from 'node:assert/strict'
import fs from 'node:fs'
import {WalkWorld,insideShape} from './walking.js'
const square=(a,b,c,d)=>({bounds:[a,b,c,d],rings:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]})
const ring=square(-2,-2,2,2);ring.rings.push([[-1,-1],[-1,1],[1,1],[1,-1],[-1,-1]])
assert(!insideShape(0,0,ring),'courtyard must stay open');assert(insideShape(1.5,0,ring))
const fixture={half:10,step:10,axis:[-10,0,10],heights:[[0,0,0],[0,0,0],[0,0,0]],buildings:[square(0,-5,.05,5)],water:[square(-8,-8,-6,-6)],roads:[],arrival:{spawn:[-2,0],yaw:0}}
const wall=new WalkWorld(fixture)
assert(wall.blocked(-.1,0));assert(!wall.blocked(-1,0));assert(wall.blocked(-7,-7));assert(wall.blocked(9.9,0))
const stopped=wall.move(wall.spawn(),4,0);assert(stopped.x<-.28,'substeps must not tunnel through a 5cm wall')
const slid=wall.move({...stopped},1,1);assert(slid.x<-.28&&slid.y>.9,'slide along the wall')
const frozen=wall.move(wall.spawn(),10000,0);assert.equal(frozen.x,-2,'unbounded delta must be rejected')
const results=[]
for(const id of ['tokyo','tama','azumino']){
  const data=JSON.parse(fs.readFileSync(new URL(`../webxr/evidence/plateau-transfer-20260922/derived/${id}/walk.json`,import.meta.url)))
  const w=new WalkWorld(data);let s=w.spawn(),maxCandidates=0,steps=0
  const then=performance.now()
  for(const [x,y] of data.arrival.route.slice(1)){
    while(Math.hypot(s.x-x,s.y-y)>.025){const d=Math.hypot(s.x-x,s.y-y),step=Math.min(.07,d),before={...s};s=w.move(s,(x-s.x)/d*step,(y-s.y)/d*step);assert(!w.blocked(s.x,s.y));assert(Math.hypot(s.x-before.x,s.y-before.y)>.01,'route must remain connected');assert.equal(s.h,w.ground(s.x,s.y));maxCandidates=Math.max(maxCandidates,w.lastCandidateCount);assert(++steps<4000)}
  }
  assert(maxCandidates<128,'local queries stay bounded');results.push({id,metres:data.arrival.length,steps,maxCandidates,totalMs:performance.now()-then})
}
console.log(JSON.stringify({passed:true,tests:['holes','thin-wall sweep','wall slide','water','bounds','pause delta','three source-road routes'],results},null,2))
