import {test,expect} from 'bun:test'
import {Group,Vector3} from 'three'
import {NightPaneStream} from './night-pane-stream.js'
import {NightField} from './metro-night.js'
import {TileCoverage} from './tile-coverage.js'
import {surfacePoint} from './surface-frame.js'

const sample={band:0,anchor:{local:[0,0]},bounds:[-1700,-20000,1700,20000]}
const owner=()=>({group:new Group(),study:{radius:3200},sample,coverage:new TileCoverage(),prepareVisual:async()=>{}})
const tile=(id:string,y:number)=>({id,path:id,decodedBytes:40,instances:1,bounds:[-5,y-5,5,y+5],heightRange:[0,8]})
const payload=(y=0)=>[{name:'night-panes',attributes:{instances:new Float32Array([0,y,3,1,0,2,1,.2,.1,.05])}}]
const eye=(y:number)=>new Vector3(...surfacePoint(3200,sample,'colony',0,y,12))
const facade=()=>({chunks:[{site:'8-100',level:'near',preparing:false}],uniforms:{kitNightCoverage:{value:null},kitNightTransition:{value:0}}})
const flush=()=>new Promise(r=>setTimeout(r,20))

test('night pane residency stays bounded while outgoing light fades before eviction',async()=>{
  const base=owner(),field=new NightField({}),stream=new NightPaneStream(base,facade(),[tile('8-100',0),tile('8-130',6000)],field,{maxBytes:40,maxResident:1,fetchData:async(t:any)=>payload(t.id==='8-100'?0:6000)})
  base.coverage.target('8-100',true);base.coverage.target('8-130',true)
  let now=performance.now();stream.update(eye(0),{now});await flush()
  expect(stream.diagnostics()).toMatchObject({resident:1,bytes:40,instances:1,loads:1})
  for(let n=0;n<8;n++)stream.update(eye(0),{now:now+=100})
  expect(field.paneValues[(100*17+8)*4]).toBe(255)
  expect(field.paneValues[(100*17+8)*4+1]).toBe(255)
  stream.update(eye(6000),{now:now+=300});await flush()
  expect(stream.diagnostics().loads).toBe(1)
  for(let n=0;n<10;n++)stream.update(eye(6000),{now:now+=100})
  await flush();expect(stream.diagnostics()).toMatchObject({resident:1,bytes:40,loads:2})
  expect(field.paneValues[(100*17+8)*4]).toBe(0)
  stream.dispose();field.dispose();base.coverage.dispose()
})

test('prefetched windows begin their fade only when the matching source wall appears',async()=>{
  const base=owner(),field=new NightField({}),f=facade();f.chunks=[]
  const stream=new NightPaneStream(base,f,[tile('8-100',0)],field,{fetchData:async()=>payload()})
  let now=performance.now();stream.update(eye(0),{now});await flush()
  for(let n=0;n<10;n++)stream.update(eye(0),{now:now+=100})
  const i=(100*17+8)*4;expect(field.paneValues[i]).toBe(0)
  base.coverage.target('8-100',true);stream.update(eye(0),{now:now+=100})
  expect(field.paneValues[i]).toBeGreaterThan(0);expect(field.paneValues[i]).toBeLessThan(100)
  for(let n=0;n<6;n++)stream.update(eye(0),{now:now+=100})
  expect(field.paneValues[i]).toBe(255)
  expect(f.uniforms.kitNightTransition.value).toBe(0)
  field.ready=true;field.update(.25);stream.update(eye(0),{now:now+=100})
  expect(f.uniforms.kitNightTransition.value).toBe(.5)
  field.update(.25);stream.update(eye(0),{now:now+=100})
  expect(f.uniforms.kitNightTransition.value).toBe(1)
  stream.dispose();field.dispose();base.coverage.dispose()
})

test('late pane upload cannot attach to a disposed world or consume its budget',async()=>{
  const base=owner(),field=new NightField({});let release:any
  base.prepareVisual=()=>new Promise<void>(resolve=>release=resolve)
  const stream=new NightPaneStream(base,facade(),[tile('8-100',0)],field,{fetchData:async()=>payload()})
  stream.update(eye(0));await flush();expect(release).toBeDefined()
  stream.dispose();release();await flush()
  expect(stream.diagnostics()).toMatchObject({resident:0,pending:0,bytes:0,loads:0})
  expect(stream.group.children).toHaveLength(0)
  field.dispose();base.coverage.dispose()
})

test('a fetch that ignores cancellation cannot add windows from the old neighbourhood',async()=>{
  const base=owner(),field=new NightField({});let release:any
  const stream=new NightPaneStream(base,facade(),[tile('8-100',0)],field,{fetchData:()=>new Promise(resolve=>release=resolve)})
  const now=performance.now();stream.update(eye(0),{now});stream.update(eye(6000),{now:now+300})
  release(payload());await flush()
  expect(stream.diagnostics()).toMatchObject({resident:0,pending:0,bytes:0,loads:0,aborted:1})
  stream.dispose();field.dispose();base.coverage.dispose()
})
