/** PLATEAU 3D Tiles 1.0 B3DM and 1.1 GLB, normalized to local Y-up + ECEF RTC.
 * Supported GLB contract is checked rather than silently dropping transforms.
 * Metadata: CesiumGS/glTF EXT_structural_metadata, EXT_mesh_features.
 */
import fs from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { decode as decodeLegacy } from './decode_b3dm.mjs'

let dracoPromise
function getDraco() {
  if (!dracoPromise) {
    const folder=fileURLToPath(new URL('../../node_modules/three/examples/jsm/libs/draco/gltf/',import.meta.url))
    const scope={module:{exports:{}},exports:{},require:createRequire(import.meta.url),__dirname:folder,
      console,process,Buffer,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout}
    vm.runInNewContext(fs.readFileSync(path.join(folder,'draco_wasm_wrapper.js'),'utf8'),scope)
    dracoPromise=scope.module.exports({wasmBinary:fs.readFileSync(path.join(folder,'draco_decoder.wasm'))})
  }
  return dracoPromise
}

export function parseGlb(data) {
  assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(4),2)
  assert.equal(data.readUInt32LE(8),data.length)
  let json,bin
  for(let offset=12;offset<data.length;) {
    const size=data.readUInt32LE(offset),type=data.readUInt32LE(offset+4)
    assert(offset+8+size<=data.length,'Truncated GLB chunk')
    const chunk=data.subarray(offset+8,offset+8+size)
    if(type===0x4e4f534a){assert(!json);json=JSON.parse(chunk.toString('utf8'))}
    else if(type===0x004e4942){assert(!bin);bin=chunk}
    else assert.fail('Unsupported GLB chunk '+type)
    offset+=8+size
  }
  assert(json&&bin);assert.equal(json.buffers.length,1);assert(!json.buffers[0].uri)
  assert(bin.length>=json.buffers[0].byteLength&&bin.length-json.buffers[0].byteLength<4)
  return {json,bin}
}

export function propertyReader(g,bin,table) {
  const schema=g.extensions.EXT_structural_metadata.schema.classes[table.class].properties
  const view=(index)=>{
    const v=g.bufferViews[index];assert(v);assert.equal(v.buffer,0)
    const start=v.byteOffset??0;assert(start+v.byteLength<=bin.length)
    return bin.subarray(start,start+v.byteLength)
  }
  const types={FLOAT64:['readDoubleLE',8],FLOAT32:['readFloatLE',4],INT8:['readInt8',1],UINT8:['readUInt8',1],
    INT16:['readInt16LE',2],UINT16:['readUInt16LE',2],INT32:['readInt32LE',4],UINT32:['readUInt32LE',4]}
  return (key,index)=>{
    assert(Number.isInteger(index)&&index>=0&&index<table.count)
    const property=table.properties[key],definition=schema[key]
    if(!property)return definition?.default??null
    assert(definition&&!definition.array&&!definition.normalized,'Unsupported metadata layout '+key)
    assert(!('offset' in property)&&!('scale' in property)&&!('offset' in definition)&&!('scale' in definition))
    const values=view(property.values);let value
    if(definition.type==='STRING') {
      const offsets=view(property.stringOffsets),type=property.stringOffsetType??'UINT32'
      assert.equal(type,'UINT32');const lo=offsets.readUInt32LE(index*4),hi=offsets.readUInt32LE((index+1)*4)
      assert(lo<=hi&&hi<=values.length);value=values.toString('utf8',lo,hi)
    } else {
      assert.equal(definition.type,'SCALAR');const type=types[definition.componentType];assert(type)
      value=values[type[0]](index*type[1])
    }
    return value===definition.noData?(definition.default??null):value
  }
}

export async function decode(data) {
  if(data[0]===31&&data[1]===139)data=gunzipSync(data)
  if(data.toString('ascii',0,4)==='b3dm')return decodeLegacy(data)
  const {json:g,bin}=parseGlb(data)
  assert((g.extensionsRequired??[]).every(name=>name==='KHR_draco_mesh_compression'))
  assert.equal(g.nodes.length,1);assert.equal(g.meshes.length,1)
  const node=g.nodes[0];assert.equal(node.mesh,0)
  assert(!node.matrix&&!node.rotation&&!node.scale&&!node.children)
  assert.equal(g.scenes.length,1);assert.deepEqual(g.scenes[0].nodes,[0])
  assert.equal(g.meshes[0].primitives.length,1)
  const p=g.meshes[0].primitives[0];assert.equal(p.mode??4,4)
  const ids=p.extensions.EXT_mesh_features.featureIds;assert.equal(ids.length,1)
  assert.equal(ids[0].attribute,0);assert(ids[0].nullFeatureId===undefined)
  const table=g.extensions.EXT_structural_metadata.propertyTables[ids[0].propertyTable]
  assert.equal(ids[0].featureCount,table.count)
  const read=propertyReader(g,bin,table)
  const features=Array.from({length:table.count},(_,i)=>({id:read('gml_id',i),
    bounds:['_xmin','_ymin','_xmax','_ymax','_zmin','_zmax'].map(k=>read(k,i)),
    usage:read('bldg:usage',i),sourceLod:read('_lod',i)}))
  for(const f of features){assert(typeof f.id==='string'&&f.id);assert(f.bounds.every(Number.isFinite));assert.equal(f.sourceLod,1)}
  const ext=p.extensions.KHR_draco_mesh_compression,view=g.bufferViews[ext.bufferView]
  assert.equal(view.buffer,0);const start=view.byteOffset??0;assert(start+view.byteLength<=bin.length)
  const input=bin.subarray(start,start+view.byteLength),draco=await getDraco(),owned=[]
  const keep=obj=>(owned.push(obj),obj)
  try {
    const decoder=keep(new draco.Decoder()),buffer=keep(new draco.DecoderBuffer()),mesh=keep(new draco.Mesh())
    buffer.Init(new Int8Array(input),input.length)
    const status=keep(decoder.DecodeBufferToMesh(buffer,mesh));assert(status.ok(),status.error_msg())
    function attribute(name) {
      assert(Number.isInteger(ext.attributes[name]));const a=decoder.GetAttributeByUniqueId(mesh,ext.attributes[name])
      const values=new draco.DracoFloat32Array()
      try{assert(decoder.GetAttributeFloatForAllPoints(mesh,a,values));return Array.from({length:values.size()},(_,i)=>values.GetValue(i))}
      finally{draco.destroy(values)}
    }
    const positions=attribute('POSITION'),batches=attribute('_FEATURE_ID_0'),indices=[]
    assert.equal(positions.length,mesh.num_points()*3);assert.equal(batches.length,mesh.num_points())
    assert(batches.every(v=>Number.isInteger(v)&&v>=0&&v<features.length))
    const face=keep(new draco.DracoInt32Array())
    for(let i=0;i<mesh.num_faces();i++) {
      decoder.GetFaceFromMesh(mesh,i,face);const a=face.GetValue(0),b=face.GetValue(1),c=face.GetValue(2)
      assert.equal(batches[a],batches[b]);assert.equal(batches[a],batches[c]);indices.push(a,b,c)
    }
    const t=node.translation??[0,0,0];assert(t.length===3&&t.every(Number.isFinite))
    return {rtc:[t[0],-t[2],t[1]],positions,batches,indices,features}
  } finally {for(const object of owned.reverse())draco.destroy(object)}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--stdio') {
    for await(const line of readline.createInterface({input:process.stdin})) {
      try {const request=JSON.parse(line);const result=await decode(fs.readFileSync(request.path));process.stdout.write(JSON.stringify({result})+'\n')}
      catch(error){process.stdout.write(JSON.stringify({error:String(error.stack??error)})+'\n')}
    }
  } else {
    const result=await decode(fs.readFileSync(process.argv[2]))
    fs.writeFileSync(process.argv[3],JSON.stringify(result))
    console.log(JSON.stringify({features:result.features.length,vertices:result.positions.length/3,triangles:result.indices.length/3}))
  }
}
