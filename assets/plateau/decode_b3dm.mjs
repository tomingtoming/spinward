/** Decode this import's explicit FME b3dm/Draco contract. Unsupported layouts fail. */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'

const project = fileURLToPath(new URL('../../', import.meta.url))
const dracoPath = path.join(project, 'node_modules/three/examples/jsm/libs/draco/gltf')
const scope = { module: { exports: {} }, exports: {}, require: createRequire(import.meta.url),
  __dirname: dracoPath, console, process, Buffer, WebAssembly, TextDecoder, TextEncoder, setTimeout, clearTimeout }
vm.runInNewContext(fs.readFileSync(path.join(dracoPath, 'draco_wasm_wrapper.js'), 'utf8'), scope)
const draco = await scope.module.exports({ wasmBinary: fs.readFileSync(path.join(dracoPath, 'draco_decoder.wasm')) })

export function decode(data) {
  if(data[0]===31&&data[1]===139)data=gunzipSync(data)
  assert.equal(data.toString('ascii',0,4), 'b3dm'); assert.equal(data.readUInt32LE(4),1)
  assert.equal(data.readUInt32LE(8),data.length)
  const sizes=[12,16,20,24].map(i=>data.readUInt32LE(i))
  let cursor=28
  const ft=JSON.parse(data.toString('utf8',cursor,cursor+sizes[0])); cursor+=sizes[0]+sizes[1]
  const bt=JSON.parse(data.toString('utf8',cursor,cursor+sizes[2])); cursor+=sizes[2]
  const bin=data.subarray(cursor,cursor+sizes[3]);cursor+=sizes[3]
  const glb=data.subarray(cursor)
  assert.equal(glb.toString('ascii',0,4),'glTF');assert.equal(glb.readUInt32LE(4),2)
  const jsonSize=glb.readUInt32LE(12)
  const g=JSON.parse(glb.toString('utf8',20,20+jsonSize))
  const geometry=glb.subarray(28+jsonSize)
  assert.equal(g.meshes.length,1);assert.equal(g.nodes.length,1)
  assert(!g.nodes[0].matrix&&!g.nodes[0].translation&&!g.nodes[0].rotation&&!g.nodes[0].scale)
  assert.equal(g.meshes[0].primitives.length,1)
  const p=g.meshes[0].primitives[0];assert.equal(p.mode,4)
  const ext=p.extensions.KHR_draco_mesh_compression
  const view=g.bufferViews[ext.bufferView]
  const input=geometry.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)
  const decoder=new draco.Decoder(),buffer=new draco.DecoderBuffer(),mesh=new draco.Mesh()
  buffer.Init(new Int8Array(input),input.length)
  const status=decoder.DecodeBufferToMesh(buffer,mesh);assert(status.ok(),status.error_msg())
  function attribute(name) {
    const a=decoder.GetAttributeByUniqueId(mesh,ext.attributes[name])
    const values=new draco.DracoFloat32Array()
    decoder.GetAttributeFloatForAllPoints(mesh,a,values)
    const out=Array.from({length:values.size()},(_,i)=>values.GetValue(i));draco.destroy(values)
    return out
  }
  const positions=attribute('POSITION'),batches=attribute('_BATCHID'),indices=[]
  const face=new draco.DracoInt32Array()
  for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,face);indices.push(face.GetValue(0),face.GetValue(1),face.GetValue(2))}
  const read=(key,i)=>{
    const v=bt[key];if(Array.isArray(v))return v[i]
    assert.equal(v.componentType,'DOUBLE');assert.equal(v.type,'SCALAR')
    return bin.readDoubleLE(v.byteOffset+i*8)
  }
  const features=Array.from({length:ft.BATCH_LENGTH},(_,i)=>({id:bt.gml_id[i],
    bounds:['_xmin','_ymin','_xmax','_ymax','_zmin','_zmax'].map(k=>read(k,i)),
    usage:bt['bldg:usage']?.[i]??null, sourceLod:bt._lod?.[i]??1}))
  for(const obj of [face,status,mesh,buffer,decoder])draco.destroy(obj)
  return {rtc:g.extensions.CESIUM_RTC.center,positions,batches,indices,features}
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const result=decode(fs.readFileSync(process.argv[2]))
  fs.writeFileSync(process.argv[3],JSON.stringify(result))
  console.log(JSON.stringify({features:result.features.length,vertices:result.positions.length/3,triangles:result.indices.length/3}))
}
