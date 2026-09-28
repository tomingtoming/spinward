// Version 2 wraps the exact version 1 header and lossless attribute streams.
// The resident representation and its decodedBytes budget remain unchanged.
// Bundle the small decoder with the worker to avoid a serial network round trip.
import {MeshoptDecoder} from 'meshoptimizer/meshopt_decoder.module.js'
export const MAX_TILE_BYTES=64*1024*1024
const integer=(n,min=0,max=MAX_TILE_BYTES)=>Number.isSafeInteger(n)&&n>=min&&n<=max

export function tileHeader(buffer){
  if(buffer.byteLength<4)throw Error('Invalid tile header')
  const length=new DataView(buffer).getUint32(0,true),start=4+Math.ceil(length/4)*4
  if(length>8*1024*1024||start>buffer.byteLength)throw Error('Invalid tile header')
  const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)))
  return{header,start}
}

// Validate the native layout before allocating a decoded tile or entering WASM.
export function nativeStreams(header,prefixBytes,decodedBytes){
  if(header.version!==1||!Array.isArray(header.meshes)||!integer(decodedBytes,4)||!integer(prefixBytes,4,decodedBytes))throw Error('Invalid native tile')
  const streams=[]
  for(const mesh of header.meshes){
    if(!mesh.attributes||typeof mesh.attributes!=='object')throw Error('Invalid native attributes')
    for(const [name,a] of Object.entries(mesh.attributes)){
      if(!['f32','u32'].includes(a.type)||!integer(a.count)||!integer(a.offset)||a.offset%4||a.offset+a.count*4>decodedBytes-prefixBytes)throw Error('Invalid native attribute')
      const instanceStride={'night-panes':40,'lamp-anchors':28,lowrise:36}[mesh.name]??4
      const stride=name==='index'?4:name==='instances'?instanceStride:['position','normal','color'].includes(name)?12:4
      if(a.count*4%stride)throw Error('Invalid native attribute stride')
      streams.push({offset:a.offset,count:a.count,stride,mode:name==='index'?'INDICES':'ATTRIBUTES'})
    }
  }
  // Producers pack tightly. Refuse gaps/overlap instead of silently replacing bytes.
  let end=0
  for(const stream of [...streams].sort((a,b)=>a.offset-b.offset)){
    if(stream.offset!==end)throw Error('Invalid native attribute coverage')
    end+=stream.count*4
  }
  if(prefixBytes+end!==decodedBytes)throw Error('Invalid native tile length')
  return streams
}

export async function restoreMeshoptTile(buffer,decodedBytes){
  const {header:h,start}=tileHeader(buffer)
  if(h.version!==2||h.encoding!=='meshopt'||h.decodedBytes!==decodedBytes||!integer(decodedBytes,4)||!integer(h.headerBytes,4,decodedBytes)||!Array.isArray(h.streams))throw Error('Invalid meshopt tile')
  if(start+h.headerBytes>buffer.byteLength)throw Error('Truncated meshopt header')
  const prefix=buffer.slice(start,start+h.headerBytes),native=tileHeader(prefix)
  if(native.start!==h.headerBytes)throw Error('Invalid meshopt native header')
  const expected=nativeStreams(native.header,h.headerBytes,decodedBytes)
  if(expected.length!==h.streams.length)throw Error('Invalid meshopt stream count')
  let end=start+h.headerBytes
  for(let i=0;i<expected.length;i++){
    const a=h.streams[i],b=expected[i]
    if(!a||a.offset!==b.offset||a.count!==b.count||a.stride!==b.stride||a.mode!==b.mode||!integer(a.bytes)||end+a.bytes>buffer.byteLength)throw Error('Invalid meshopt stream')
    end+=a.bytes
  }
  if(end!==buffer.byteLength)throw Error('Invalid meshopt payload length')
  await MeshoptDecoder.ready
  const decoder=MeshoptDecoder,out=new Uint8Array(decodedBytes)
  out.set(new Uint8Array(prefix));let offset=start+h.headerBytes
  for(const a of h.streams){
    const target=out.subarray(h.headerBytes+a.offset,h.headerBytes+a.offset+a.count*4),source=new Uint8Array(buffer,offset,a.bytes)
    if(a.mode==='INDICES')decoder.decodeIndexSequence(target,a.count,a.stride,source)
    else decoder.decodeVertexBuffer(target,a.count*4/a.stride,a.stride,source)
    offset+=a.bytes
  }
  return out.buffer
}
