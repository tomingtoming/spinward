// Offline encoder; never imported by browser code.
import {MeshoptEncoder} from 'meshoptimizer/meshopt_encoder.module.js'
import {tileHeader,nativeStreams} from '../../src/worlds/plateau/tile-meshopt.js'

export async function encodeMeshoptTile(buffer){
  await MeshoptEncoder.ready
  const {header,start}=tileHeader(buffer),streams=nativeStreams(header,start,buffer.byteLength),parts=[]
  for(const a of streams){
    const source=new Uint8Array(buffer,start+a.offset,a.count*4)
    const bytes=a.mode==='INDICES'?MeshoptEncoder.encodeIndexSequence(source,a.count,a.stride):MeshoptEncoder.encodeVertexBuffer(source,a.count*4/a.stride,a.stride)
    a.bytes=bytes.length;parts.push(bytes)
  }
  const json=new TextEncoder().encode(JSON.stringify({version:2,encoding:'meshopt',decodedBytes:buffer.byteLength,headerBytes:start,streams}))
  let offset=4+Math.ceil(json.length/4)*4
  const output=new Uint8Array(offset+start+parts.reduce((n,p)=>n+p.length,0))
  new DataView(output.buffer).setUint32(0,json.length,true);output.set(json,4)
  output.set(new Uint8Array(buffer,0,start),offset);offset+=start
  for(const bytes of parts){output.set(bytes,offset);offset+=bytes.length}
  return output
}
