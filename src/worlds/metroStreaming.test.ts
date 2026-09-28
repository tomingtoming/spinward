import {test,expect} from 'bun:test'
import {MetroSpatialIndex,metroTileBounds,metroMotionVolumes,metroCoast} from './metroStreaming'
import {MetroCollision,type NativeMesh} from './metroCollision'
import type {RegionalMotion,RegionalPreparation} from './regionalMotion'
const motion=(y=0,height=0,v=0):RegionalMotion=>({omega:.055,deltaSeconds:.05,bodies:[{position:{x:3200-height,y,z:0},velocity:{x:0,y:v,z:0},acceleration:20,radius:2}]})
const prep=(m:RegionalMotion):RegionalPreparation=>({motion:m})
const tile=(id:string,y:number)=>({id,path:id,band:0,bounds:[-100,-y-100,100,-y+100],heightRange:[-5,30],decodedBytes:256})
const mesh:NativeMesh={name:'terrain',attributes:{position:Float32Array.from([-10,-10,-5,10,-10,-5,10,10,-5]),index:Uint32Array.from([0,1,2])}}
const tick=()=>new Promise(r=>setTimeout(r,10))
test('curved bounds contain source vertices and quadrant extrema in all three bands',()=>{
  for(const band of [0,1,2])for(const offset of [-300,0,300]){
    const t={band,bounds:[-500+offset,-200,500+offset,200],heightRange:[-16,400]}
    const b=metroTileBounds(t,3200)
    for(let x=t.bounds[0];x<=t.bounds[2];x+=5)for(const h of t.heightRange){
      const a=-(band*Math.PI*2/3+x/3200),p=[(3200-h)*Math.cos(a),0,(3200-h)*Math.sin(a)]
      for(let i=0;i<3;i++){expect(p[i]).toBeGreaterThanOrEqual(b[i]-1e-6);expect(p[i]).toBeLessThanOrEqual(b[i+3]+1e-6)}
    }
  }
})
test('critical demand covers the intervening path of a fast crossing, not only endpoints',()=>{
  const index=new MetroSpatialIndex([tile('middle',0)],3200),m=motion(-400,0,16000)
  const hits:number[]=[]
  for(const b of metroMotionVolumes(m).critical)index.query(b,id=>hits.push(id))
  expect(hits).toContain(0)
})
test('high flight has no critical terrain demand; a descending trajectory prefetches it',()=>{
  const index=new MetroSpatialIndex([tile('ground',0)],3200),m=motion(0,400)
  m.bodies[0].velocity.x=140
  const volumes=metroMotionVolumes(m),critical:number[]=[],future:number[]=[]
  for(const b of volumes.critical)index.query(b,id=>critical.push(id))
  for(const {bounds} of volumes.prefetch)index.query(bounds,id=>future.push(id))
  expect(critical).toEqual([]);expect(future).toContain(0)
})
test('co-rotation is removed from forecast velocity and angular seams are spatially continuous',()=>{
  const m=motion(),p=metroCoast(m.bodies[0],m.omega,.05)
  expect(Math.hypot(p.x-3200,p.y,p.z)).toBeLessThan(.02)
  const idx=new MetroSpatialIndex([{band:0,bounds:[Math.PI*3200-20,-10,Math.PI*3200+20,10],heightRange:[0,30]}],3200)
  const ids:number[]=[];idx.query([-3210,-5,-5,-3190,5,5],id=>ids.push(id));expect(ids).toEqual([0])
})
test('pending or failed background fetches never freeze an already supported body',async()=>{
  let background!:(m:NativeMesh[])=>void
  const s=new MetroCollision([tile('here',0),tile('ahead',400)],3200,40000,t=>t.id==='here'?Promise.resolve([mesh]):new Promise(r=>background=r))
  const p=prep(motion(0,0,160))
  expect(s.request([],p)).toBe(false);await tick()
  expect(s.request([],p)).toBe(true);expect(s.stats.pending).toBe(1);expect(s.stats.prefetch).toBe(1)
  background([mesh]);await tick();expect(s.request([],p)).toBe(true);s.dispose()
})
test('critical selection overtakes catalog order and queued background; arrivals remain mandatory',async()=>{
  const loads:string[]=[],resolvers=new Map<string,(m:NativeMesh[])=>void>()
  const s=new MetroCollision([tile('far',400),tile('near',0)],3200,40000,t=>{loads.push(t.id);return new Promise(r=>resolvers.set(t.id,r))},{maxEntries:10,maxBytes:4096,concurrency:1})
  const p=prep(motion(0,0,160));s.request([],p);expect(loads).toEqual(['near'])
  resolvers.get('near')!([mesh]);await tick();expect(s.request([],p)).toBe(true)
  expect(s.request([],{...p,arrival:{azimuth:0,axial:400,distance:20}})).toBe(false)
  resolvers.get('far')!([mesh]);await tick();expect(s.request([],{...p,arrival:{azimuth:0,axial:400,distance:20}})).toBe(true);s.dispose()
})
test('short direction changes retain collision and do not re-fetch; memory admission evicts background first',async()=>{
  let loads=0
  const tiles=[tile('a',0),tile('b',1000),tile('c',2000)]
  const s=new MetroCollision(tiles,3200,40000,async()=>{loads++;return[mesh]},{maxEntries:2,maxBytes:512,concurrency:2})
  s.request([],prep(motion()));await tick();s.request([],prep(motion(1000)));await tick()
  expect(s.request([],prep(motion()))).toBe(true);expect(loads).toBe(2)
  s.request([],prep(motion(2000)));await tick();expect(s.stats.entries).toBe(2);expect(s.stats.bytes).toBeLessThanOrEqual(512*3)
  expect(s.request([],prep(motion(2000)))).toBe(true);s.dispose();expect(s.index.all.length).toBe(0)
})
test('a genuine critical failure is fail-closed and explicit retry restores it',async()=>{
  let fail=true
  const s=new MetroCollision([tile('a',0)],3200,40000,async()=>{if(fail)throw Error('injected');return[mesh]})
  s.request([],prep(motion()));await tick();expect(s.request([],prep(motion()))).toBe(false);expect(s.stats.missingCritical).toBe(1)
  expect(s.stats.failed[0].message).toContain('injected');fail=false;s.retry();await tick();expect(s.request([],prep(motion()))).toBe(true);s.dispose()
})
test('dispose ignores late asynchronous results',async()=>{
  let resolve!:(m:NativeMesh[])=>void
  const s=new MetroCollision([tile('a',0)],3200,40000,()=>new Promise(r=>resolve=r))
  s.request([],prep(motion()));s.dispose();resolve([mesh]);await tick();expect(s.index.all.length).toBe(0);expect(s.stats.bytes).toBe(0)
})

test('background failure stays nonblocking until that tile actually becomes critical',async()=>{
  const s=new MetroCollision([tile('here',0),tile('ahead',400)],3200,40000,async t=>{if(t.id==='ahead')throw Error('background unavailable');return[mesh]})
  s.request([],prep(motion(0,0,160)));await tick()
  expect(s.request([],prep(motion(0,0,160)))).toBe(true);expect(s.stats.failed).toEqual([])
  expect(s.request([],prep(motion(400)))).toBe(false);expect(s.stats.failed[0].message).toContain('background unavailable');s.dispose()
})
test('a distant projectile owns critical data independently of the player',async()=>{
  let deliver!:(m:NativeMesh[])=>void
  const s=new MetroCollision([tile('body',0),tile('projectile',1000)],3200,40000,t=>t.id==='body'?Promise.resolve([mesh]):new Promise(r=>deliver=r))
  const m=motion();m.bodies.push({...motion(1000).bodies[0],radius:.1,acceleration:0})
  s.request([],prep(m));await tick();expect(s.request([],prep(m))).toBe(false);expect(s.stats.missingCritical).toBe(1)
  deliver([mesh]);await tick();expect(s.request([],prep(m))).toBe(true);s.dispose()
})
