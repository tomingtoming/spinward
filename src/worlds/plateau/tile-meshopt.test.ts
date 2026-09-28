import {test,expect} from 'bun:test'
import {gzipSync} from 'node:zlib'
import {packTile,unpackTile} from './tile-format.js'
import {decodeTile} from './tile-processing.js'
import {restoreMeshoptTile,tileHeader} from './tile-meshopt.js'
import {encodeMeshoptTile} from '../../../assets/plateau/metro_meshopt.mjs'

const native=()=>packTile([{name:'terrain',texture:'kept.png',segments:[{tile:'1-2',first:0,count:6}],attributes:{
  position:new Float32Array([-0,125.125,-19300,5,6,7,8,9,10]),normal:new Float32Array([0,1,0,0,1,0,0,1,0]),
  index:new Uint32Array([2,1,0,0,1,2])}}])
test('gzip meshopt restores the entire native file and original index order',async()=>{
  const raw=native(),encoded=await encodeMeshoptTile(raw.buffer)
  expect(new Uint8Array(await restoreMeshoptTile(encoded.buffer,raw.length))).toEqual(raw)
  const zipped=gzipSync(encoded),decoded=await decodeTile(zipped.buffer.slice(zipped.byteOffset,zipped.byteOffset+zipped.byteLength),raw.length)
  expect(decoded).toEqual(unpackTile(raw.buffer))
  expect(Object.is(decoded[0].attributes.position[0],-0)).toBe(true)
  expect(await decodeTile(raw.buffer,raw.length)).toEqual(decoded)
})
test('preserves interleaved instances and empty tiles',async()=>{
  for(const meshes of [[],[{name:'night-panes',attributes:{instances:Float32Array.from({length:200},(_,i)=>i%10)}}]]){
    const raw=packTile(meshes),encoded=await encodeMeshoptTile(raw.buffer)
    expect(new Uint8Array(await restoreMeshoptTile(encoded.buffer,raw.length))).toEqual(raw)
  }
})
test('rejects mismatched resident budgets, truncated data and unsupported versions',async()=>{
  const raw=native(),encoded=await encodeMeshoptTile(raw.buffer)
  await expect(restoreMeshoptTile(encoded.buffer,raw.length+4)).rejects.toThrow('Invalid')
  await expect(restoreMeshoptTile(encoded.buffer.slice(0,-1),raw.length)).rejects.toThrow('Invalid')
  await expect(decodeTile(new ArrayBuffer(3),raw.length)).rejects.toThrow('Invalid')
})
test('rejects overlapping native attributes and untrusted allocation sizes',async()=>{
  const raw=native(),{header,start}=tileHeader(raw.buffer)
  header.meshes[0].attributes.index.offset=0
  const json=new TextEncoder().encode(JSON.stringify(header)),bad=new Uint8Array(4+Math.ceil(json.length/4)*4+raw.length-start)
  new DataView(bad.buffer).setUint32(0,json.length,true);bad.set(json,4)
  await expect(encodeMeshoptTile(bad.buffer)).rejects.toThrow('coverage')
  const encoded=await encodeMeshoptTile(raw.buffer),outer=tileHeader(encoded.buffer).header
  outer.decodedBytes=2**31
  const text=new TextEncoder().encode(JSON.stringify(outer)),payload=new Uint8Array(4+Math.ceil(text.length/4)*4)
  new DataView(payload.buffer).setUint32(0,text.length,true);payload.set(text,4)
  await expect(restoreMeshoptTile(payload.buffer,2**31)).rejects.toThrow('Invalid')
})
