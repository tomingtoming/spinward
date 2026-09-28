import {test,expect} from 'bun:test'
import {createSharedTileSource} from './shared-tile-source.js'
import {decodeTile,prepareTile} from './tile-processing.js'
import {packTile} from './tile-format.js'
import {surfacePoint} from './surface-frame.js'
import {TileCoverage,tileOrdinal} from './tile-coverage.js'

const native=()=>[{name:'buildings',segments:[{tile:'0-0',first:0,count:3}],attributes:{
  position:new Float32Array([-20,10,-3,20,10,-3,20,10,70]),index:new Uint32Array([0,1,2]),
}}]
const deferred=()=>{let resolve:any,reject:any;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}

test('a cancelled scenery consumer cannot abort the collision consumer of the same tile',async()=>{
  const pending=deferred();let fetches=0,transport:any
  const source=createSharedTileSource((_d:any,s:any)=>{fetches++;transport=s;return pending.promise})
  const a=new AbortController(),b=new AbortController(),tile={path:'one.bin',decodedBytes:128}
  const render=source.get(tile,a.signal),collision=source.get(tile,b.signal)
  const rejected=render.catch((e:any)=>e)
  await Promise.resolve();a.abort();expect((await rejected).name).toBe('AbortError')
  expect(transport.aborted).toBe(false);pending.resolve(native())
  const first=await collision,second=await source.get(tile)
  expect(fetches).toBe(1);expect(first[0].attributes.position).toBe(second[0].attributes.position)
  first[0].attributes={};first[0].segments[0].count=0
  expect(second[0].attributes.position.length).toBe(9);expect(second[0].segments[0].count).toBe(3)
})

test('late delivery after last cancellation is never cached or returned to a replacement consumer',async()=>{
  const requests:any[]=[],source=createSharedTileSource(()=>{const p=deferred();requests.push(p);return p.promise})
  const abort=new AbortController(),tile={path:'cancel.bin',decodedBytes:128},first=source.get(tile,abort.signal)
  const rejected=first.catch((e:any)=>e);await Promise.resolve();abort.abort();expect((await rejected).name).toBe('AbortError')
  const second=source.get(tile);await Promise.resolve();requests[0].resolve(native());requests[1].resolve(native())
  await second;expect(requests.length).toBe(2);expect(source.diagnostics().bytes).toBe(128)
})

test('shared native reuse is bounded by bytes and idle lifetime',async()=>{
  let now=0,loads=0
  const source=createSharedTileSource(async()=>{loads++;return native()},{maxBytes:200,ttl:10,now:()=>now})
  for(const path of ['a','b','c'])await source.get({path,decodedBytes:128})
  expect(source.diagnostics().bytes).toBe(128);expect(source.diagnostics().peakBytes).toBeLessThanOrEqual(200)
  now=11;expect(source.diagnostics().bytes).toBe(0)
  await source.get({path:'c',decodedBytes:128});expect(loads).toBe(4)
})

test('worker preparation preserves native geometry and projects refined render vertices on the same cylinder',async()=>{
  const source=native(),original=source[0].attributes.position.slice(),encoded=packTile(source)
  const decoded=await decodeTile(encoded.buffer,encoded.byteLength),sample={band:2,anchor:{local:[0,0]}}
  const render=prepareTile(decoded,3200,sample)
  expect(decoded[0].attributes.position).toEqual(original)
  expect(render[0].attributes.index.length).toBeGreaterThan(3)
  const p=render[0].attributes.position,q=render[0].projected.position
  for(let i=0;i<p.length;i+=3){const expected=surfacePoint(3200,sample,'colony',p[i],p[i+1],p[i+2]);for(let k=0;k<3;k++)expect(q[i+k]).toBeCloseTo(expected[k],3)}
  expect(render.extraDecodedBytes).toBeGreaterThan(q.byteLength)
  expect([...render[0].tileOrdinals].every(v=>v===0)).toBe(true)
  await expect(decodeTile(encoded.buffer,encoded.byteLength+1)).rejects.toThrow('Truncated')
})

test('complete far ownership swaps atomically while near ownership remains independent',()=>{
  const coverage=new TileCoverage()
  expect(tileOrdinal('16-199')).toBe(3399)
  coverage.nearTiles(['16-199','0-0'])
  coverage.target('16-199',true)
  expect(coverage.value('16-199')).toBe(1)
  expect(coverage.values[3399*4+1]).toBe(255)
  coverage.target('16-199',false)
  expect(coverage.value('16-199')).toBe(0)
  expect(coverage.values[3399*4+1]).toBe(255)
  coverage.nearTiles(['0-0'])
  expect(coverage.values[3399*4+1]).toBe(0)
  expect(coverage.values[1]).toBe(255)
  coverage.dispose()
})
