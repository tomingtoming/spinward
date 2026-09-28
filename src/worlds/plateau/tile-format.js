// A small self-describing binary container. Offsets are relative to its payload.
// Float32 attributes retain the source coordinates; gzip is transport compression only.
export function unpackTile(buffer){
  const length=new DataView(buffer).getUint32(0,true),start=4+Math.ceil(length/4)*4
  if(start>buffer.byteLength)throw Error('Invalid tile header')
  const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)))
  if(header.version!==1)throw Error('Unsupported base tile')
  return header.meshes.map(m=>({...m,attributes:Object.fromEntries(Object.entries(m.attributes).map(([key,a])=>{
    const Type=a.type==='u32'?Uint32Array:Float32Array
    if(a.offset<0||start+a.offset+a.count*4>buffer.byteLength)throw Error('Invalid tile attribute')
    return[key,new Type(buffer,start+a.offset,a.count)]
  }))}))
}
export function packTile(meshes){
  const arrays=[];let offset=0
  const header={version:1,meshes:meshes.map(m=>({...m,attributes:Object.fromEntries(Object.entries(m.attributes).map(([key,a])=>{
    const descriptor={type:a instanceof Uint32Array?'u32':'f32',offset,count:a.length};arrays.push(a);offset+=a.byteLength;return[key,descriptor]
  }))}))}
  const json=new TextEncoder().encode(JSON.stringify(header)),start=4+Math.ceil(json.length/4)*4,out=new Uint8Array(start+offset)
  new DataView(out.buffer).setUint32(0,json.length,true);out.set(json,4);offset=start
  for(const a of arrays){out.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),offset);offset+=a.byteLength}
  return out
}
