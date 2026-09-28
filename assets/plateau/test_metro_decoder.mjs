import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {gzipSync} from 'node:zlib'
import {decode,parseGlb,propertyReader} from './decode_metro_tiles.mjs'

test('metadata uses byte offsets for UTF-8 and preserves declared noData',()=>{
  const text=Buffer.from('住居事務所'),offsets=Buffer.alloc(12);[0,6,15].forEach((n,i)=>offsets.writeUInt32LE(n,i*4))
  const heights=Buffer.alloc(16);heights.writeDoubleLE(12,0);heights.writeDoubleLE(-999,8)
  const bin=Buffer.concat([text,offsets,heights]);const table={class:'building',count:2,properties:{usage:{values:0,stringOffsets:1},height:{values:2}}}
  const g={bufferViews:[{buffer:0,byteLength:text.length},{buffer:0,byteOffset:text.length,byteLength:12},{buffer:0,byteOffset:text.length+12,byteLength:16}],
    extensions:{EXT_structural_metadata:{schema:{classes:{building:{properties:{usage:{type:'STRING'},height:{type:'SCALAR',componentType:'FLOAT64',noData:-999}}}}}}}}
  const read=propertyReader(g,bin,table)
  assert.equal(read('usage',0),'住居');assert.equal(read('usage',1),'事務所')
  assert.equal(read('height',0),12);assert.equal(read('height',1),null)
  assert.throws(()=>read('usage',2))
})

test('truncated GLB cannot silently succeed',()=>{
  const b=Buffer.alloc(28);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(28,8);b.writeUInt32LE(200,12)
  assert.throws(()=>parseGlb(b),/Truncated/)
})

const sample=process.env.SPINWARD_METRO_GLB
// The downloaded real fixture is external, identified by a SHA receipt in the evidence root.
test('real PLATEAU GLB survives gzip with IDs, geometry and metre-scale ECEF origin', {skip:!sample},async()=>{
  const data=fs.readFileSync(sample);const decoded=await decode(data)
  assert.deepEqual(await decode(gzipSync(data)),decoded)
  assert.equal(decoded.features.length,25)
  assert.equal(new Set(decoded.features.map(f=>f.id)).size,25)
  assert(decoded.features.every(f=>f.sourceLod===1&&f.bounds[0]>139&&f.bounds[1]>35))
  assert(Math.hypot(...decoded.rtc)>6_300_000)
  assert(decoded.indices.length>0&&decoded.positions.every(Number.isFinite))
})

test('real GLB unsupported transform is rejected', {skip:!sample},async()=>{
  const data=fs.readFileSync(sample),{json,bin}=parseGlb(data);json.nodes[0].scale=[2,2,2]
  const raw=Buffer.from(JSON.stringify(json));const padded=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(padded)
  const out=Buffer.alloc(28+padded.length+bin.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8)
  out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20)
  out.writeUInt32LE(bin.length,20+padded.length);out.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(out,28+padded.length)
  await assert.rejects(()=>decode(out))
})
