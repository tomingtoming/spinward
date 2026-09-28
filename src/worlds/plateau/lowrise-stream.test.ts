import {test,expect} from 'bun:test'
import {Group,Vector3} from 'three'
import {LowriseStream} from './lowrise-stream.js'
import {TileCoverage} from './tile-coverage.js'
import {surfacePoint} from './surface-frame.js'

const sample={band:0,anchor:{local:[0,0]},bounds:[-1700,-20000,1700,20000]}
const owner=()=>({group:new Group(),study:{radius:3200},sample,coverage:new TileCoverage(),prepareVisual:async()=>{}})
const tile=(id:string,y:number)=>({id,path:id,decodedBytes:36,instances:1,bounds:[-5,y-5,5,y+5],heightRange:[-2,8]})
const payload=(y=0)=>[{name:'lowrise',attributes:{instances:new Float32Array([0,y,-2,10,10,10,0,0,0])}}]
const eye=(y:number)=>new Vector3(...surfacePoint(3200,sample,'colony',0,y,12))
const flush=()=>new Promise(r=>setTimeout(r,20))

test('district silhouettes retire before another chunk can exceed the residency cap',async()=>{
  const base=owner(),stream=new LowriseStream(base,[tile('a',0),tile('b',6000)],{maxBytes:36,maxResident:1,fetchData:async(t:any)=>payload(t.id==='a'?0:6000)})
  stream.update(eye(0),{now:200});await flush()
  expect(stream.diagnostics()).toMatchObject({resident:1,bytes:36,instances:1,loads:1})
  for(let t=300;t<=1000;t+=100)stream.update(eye(0),{now:t})
  const mesh=stream.group.children[0]
  expect(mesh.geometry.instanceCount).toBe(1)
  expect(mesh.geometry.getAttribute('lowOrigin').data.array[2]).toBe(-2)
  stream.update(eye(6000),{now:1300});await flush()
  expect(stream.diagnostics().loads).toBe(1)
  for(let t=1400;t<=2300;t+=100)stream.update(eye(6000),{now:t})
  await flush();expect(stream.diagnostics()).toMatchObject({resident:1,bytes:36,loads:2,evictions:1})
  stream.dispose();expect(stream.group.children.length).toBe(0);base.coverage.dispose()
})

test('a shader prepared for a disposed district never enters its former scene',async()=>{
  const base=owner();let release:any
  base.prepareVisual=()=>new Promise<void>(resolve=>release=resolve)
  const stream=new LowriseStream(base,[tile('a',0)],{fetchData:async()=>payload()})
  stream.update(eye(0),{now:200});await flush();expect(release).toBeDefined()
  stream.dispose();release();await flush()
  expect(stream.diagnostics()).toMatchObject({resident:0,pending:0,bytes:0,loads:0})
  expect(stream.group.children.length).toBe(0);base.coverage.dispose()
})
