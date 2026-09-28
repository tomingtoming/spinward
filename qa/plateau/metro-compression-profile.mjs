// Read-only format experiment. Does not rewrite a release or enable a codec in the app.
// node qa/plateau/metro-compression-profile.mjs <package-directory> <report.json>
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {gzipSync,gunzipSync,brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib'
import {MeshoptEncoder as encoder,MeshoptDecoder as decoder} from 'meshoptimizer'

const [root,output]=process.argv.slice(2)
if(!root||!output)throw Error('Explicit package directory and report path required')
const inventory=JSON.parse(await fs.readFile(path.join(root,'inventory.json')))
await Promise.all([encoder.ready,decoder.ready])
const types={},groups=new Map(),sources=new Map()
for(const [key,metadata] of Object.entries(inventory.objects)){
  const type=key.match(/\.(bin\.gz|json\.gz|png|geojson|json)$/)?.[1]??'other'
  const row=types[type]??={count:0,bytes:0};row.count++;row.bytes+=metadata.bytes
}
function category(source){
  if(/^(east|central|west)\//.test(source))return source.includes('overview-')?'overview':source.includes('-far.')?'base-far':'base-near'
  return source.split('/')[0]
}
for(const [source,key] of Object.entries(inventory.sourceObjects)){
  if(!sources.has(key))sources.set(key,source)
  if(!/\.(bin|json)\.gz$/.test(key))continue
  const group=category(source),rows=groups.get(group)??new Set();rows.add(key);groups.set(group,rows)
}
// Equal-sized strata are diagnostic samples, not a statistically weighted total estimate.
const selection=new Map()
for(const [group,keys] of groups){
  const sorted=[...keys].sort((a,b)=>inventory.objects[a].bytes-inventory.objects[b].bytes||a.localeCompare(b))
  for(const quantile of [.1,.5,.9]){
    const key=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*quantile))]
    selection.set(key,{group,quantile,source:sources.get(key)})
  }
}
const manifest=JSON.parse(await fs.readFile(path.join(root,'public',inventory.release)))
selection.set(manifest.core,{group:'core',source:'release core'})
const core=JSON.parse(gunzipSync(await fs.readFile(path.join(root,'public',manifest.core))))
for(const [band,key] of Object.entries(core.details))selection.set(key,{group:'detail-index',source:band})

function compressed(data,format){return format==='gzip'?gzipSync(data,{level:5}):brotliCompressSync(data,{params:{[constants.BROTLI_PARAM_QUALITY]:9}})}
function measureDecode(fn){fn();const times=[];for(let i=0;i<5;i++){const start=performance.now();fn();times.push(performance.now()-start)}return times.sort((a,b)=>a-b)[2]}
function meshoptTile(raw){
  const headerLength=raw.readUInt32LE(0),start=4+Math.ceil(headerLength/4)*4
  const header=JSON.parse(raw.subarray(4,4+headerLength)),encodedHeader=structuredClone(header),parts=[],streams=[]
  let offset=0,decodedBytes=0
  for(let m=0;m<header.meshes.length;m++)for(const [name,a] of Object.entries(header.meshes[m].attributes)){
    assert.ok(a.type==='f32'||a.type==='u32')
    const source=raw.subarray(start+a.offset,start+a.offset+a.count*4)
    assert.equal(source.length,a.count*4)
    // Sequence coding preserves every index in order, including segment boundaries.
    // Triangle coding/reordering can change the provoking vertex or ownership ranges.
    const instanceStrides={'night-panes':40,'lamp-anchors':28,lowrise:36}
    const index=name==='index',stride=name==='instances'?(instanceStrides[header.meshes[m].name]??4):!index&&['position','normal','color'].includes(name)?12:4,count=source.length/stride
    assert.ok(Number.isInteger(count))
    const data=index?encoder.encodeIndexSequence(source,count,stride):encoder.encodeVertexBuffer(source,count,stride)
    const mode=index?'sequence':'vertex',decoded=Buffer.alloc(source.length)
    const decode=(target,bytes)=>index?decoder.decodeIndexSequence(target,count,stride,bytes):decoder.decodeVertexBuffer(target,count,stride,bytes)
    decode(decoded,data);assert.ok(decoded.equals(source),'Every attribute must round-trip bit for bit')
    streams.push({offset,bytes:data.length,count,stride,mode,decodedBytes:source.length})
    encodedHeader.meshes[m].attributes[name]={...a,offset,compressedBytes:data.length,stride,mode}
    parts.push(data);offset+=data.length;decodedBytes+=source.length
  }
  const json=Buffer.from(JSON.stringify({...encodedHeader,version:2,encoding:'meshopt'})),prefix=Buffer.alloc(4+Math.ceil(json.length/4)*4)
  prefix.writeUInt32LE(json.length,0);json.copy(prefix,4)
  const payload=Buffer.concat([prefix,...parts])
  const decode=data=>{
    const length=data.readUInt32LE(0),base=4+Math.ceil(length/4)*4,h=JSON.parse(data.subarray(4,4+length))
    for(const mesh of h.meshes)for(const a of Object.values(mesh.attributes)){
      const result=Buffer.allocUnsafe(a.count*4),source=data.subarray(base+a.offset,base+a.offset+a.compressedBytes)
      if(a.mode==='sequence')decoder.decodeIndexSequence(result,a.count*4/a.stride,a.stride,source)
      else decoder.decodeVertexBuffer(result,a.count*4/a.stride,a.stride,source)
    }
  }
  return{payload,decode,streams:streams.length,decodedBytes}
}
const results=[]
for(const [key,selected] of selection){
  const stored=await fs.readFile(path.join(root,'public',key)),raw=gunzipSync(stored)
  const row={...selected,key,storedBytes:stored.length,decodedBytes:raw.length,lossless:true}
  const br=compressed(raw,'br');assert.ok(brotliDecompressSync(br).equals(raw))
  row.brotli9Bytes=br.length
  row.gzipDecodeMs=measureDecode(()=>gunzipSync(stored));row.brotliDecodeMs=measureDecode(()=>brotliDecompressSync(br))
  if(key.endsWith('.bin.gz')){
    const coded=meshoptTile(raw),gz=compressed(coded.payload,'gzip'),mb=compressed(coded.payload,'br')
    row.meshoptGzipBytes=gz.length;row.meshoptBrotli9Bytes=mb.length
    row.meshoptGzipDecodeMs=measureDecode(()=>coded.decode(gunzipSync(gz)))
    row.meshoptBrotliDecodeMs=measureDecode(()=>coded.decode(brotliDecompressSync(mb)))
    row.streams=coded.streams
  }
  results.push(row)
}
const aggregates={}
for(const row of results){
  const aggregate=aggregates[row.group]??={count:0,storedBytes:0,brotli9Bytes:0}
  aggregate.count++
  for(const key of ['storedBytes','brotli9Bytes','meshoptGzipBytes','meshoptBrotli9Bytes'])if(row[key]!==undefined)aggregate[key]=(aggregate[key]??0)+row[key]
}
const report={created:new Date().toISOString(),node:process.version,meshoptimizer:'0.22.0 (installed lockfile)',release:inventory.release,
  scope:'Size-quantile samples; lossless Float32/Uint32 streams and index order; no geometry simplification or quantization. Node/WASM CPU decode, not browser/HMD latency.',
  types,aggregates,results}
await fs.writeFile(output,JSON.stringify(report,null,2))
console.log(JSON.stringify({types,aggregates,report:output},null,2))
