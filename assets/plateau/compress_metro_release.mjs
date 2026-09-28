// Build an immutable mixed-format release from an already audited package.
// Every selected tile is restored by the production decoder and byte-compared.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {encodeMeshoptTile} from './metro_meshopt.mjs'
import {restoreMeshoptTile} from '../../src/worlds/plateau/tile-meshopt.js'

const digest=data=>createHash('sha256').update(data).digest('hex')
const keyPattern=/^(?:objects\/([a-f0-9]{2})\/([a-f0-9]{64})\.(bin\.gz|json\.gz|png|geojson)|releases\/([a-f0-9]{64})\.json)$/
const refs=/"((?:objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:bin\.gz|json\.gz|png|geojson)|releases\/[a-f0-9]{64}\.json))"/g
const arrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)

export async function compressRelease(source,destination,{onProgress=()=>{}}={}){
  source=await fs.realpath(source);destination=path.resolve(destination)
  const parent=await fs.realpath(path.dirname(destination));destination=path.join(parent,path.basename(destination))
  if(destination===source||destination.startsWith(source+path.sep))throw Error('Output must be separate from the source package')
  const inventory=JSON.parse(await fs.readFile(path.join(source,'inventory.json')))
  if(inventory.version!==1||!inventory.objects[inventory.release])throw Error('Invalid source inventory')
  await fs.mkdir(destination) // New release only: never merge or overwrite another run.
  const publicRoot=path.join(destination,'public');await fs.mkdir(publicRoot)
  const mapped=new Map(),writes=new Map(),objects={},statistics={checkedTiles:0,compressedTiles:0,retainedTiles:0,beforeBinaryBytes:0,afterBinaryBytes:0},groups={}
  const sourceNames=new Map(Object.entries(inventory.sourceObjects??{}).map(([name,key])=>[key,name]))
  async function read(key){
    const match=keyPattern.exec(key),entry=inventory.objects[key]
    if(!match||!entry||(match[1]&&match[1]!==match[2].slice(0,2)))throw Error('Invalid source object key')
    const hash=match[2]??match[4],file=await fs.realpath(path.join(source,'public',key))
    if(!file.startsWith(path.join(source,'public')+path.sep))throw Error('Source escaped its package')
    const bytes=await fs.readFile(file)
    if(bytes.length!==entry.bytes||entry.sha256!==hash||digest(bytes)!==hash)throw Error('Source object checksum mismatch: '+key)
    return bytes
  }
  async function store(data,original){
    const sha=digest(data),extension=original.match(keyPattern)[3],key=extension?`objects/${sha.slice(0,2)}/${sha}.${extension}`:`releases/${sha}.json`
    const file=path.join(publicRoot,key),pending=writes.get(key)
    // Two differently gzipped source objects can produce identical output.
    // Wait for the complete write: EEXIST alone does not mean bytes are ready.
    if(pending)await pending
    else{
      const write=(async()=>{
        await fs.mkdir(path.dirname(file),{recursive:true})
        await fs.writeFile(file,data,{flag:'wx'}).catch(async error=>{
          if(error.code!=='EEXIST')throw error
          const existing=await fs.readFile(file)
          if(!existing.equals(data))throw Error('Conflicting immutable output')
        })
      })()
      writes.set(key,write)
      try{await write}finally{writes.delete(key)}
    }
    objects[key]={...inventory.objects[original],bytes:data.length,sha256:sha};mapped.set(original,key)
    return key
  }
  const binaryKeys=Object.keys(inventory.objects).filter(k=>k.endsWith('.bin.gz'))
  let next=0
  async function worker(){
    while(next<binaryKeys.length){
      const key=binaryKeys[next++],stored=await read(key),native=gunzipSync(stored)
      const encoded=await encodeMeshoptTile(arrayBuffer(native)),candidate=gzipSync(encoded,{level:5,mtime:0})
      // Check the actual compressed payload, not just an intermediate buffer.
      const restored=await restoreMeshoptTile(arrayBuffer(gunzipSync(candidate)),native.length)
      if(!Buffer.from(restored).equals(native))throw Error('Non-lossless meshopt conversion: '+key)
      const useful=candidate.length+128<stored.length&&candidate.length<stored.length*.99,chosen=useful?candidate:stored
      await store(chosen,key)
      statistics.checkedTiles++;statistics[useful?'compressedTiles':'retainedTiles']++
      statistics.beforeBinaryBytes+=stored.length;statistics.afterBinaryBytes+=chosen.length
      const group=(sourceNames.get(key)??'unknown').split('/')[0],row=groups[group]??={count:0,before:0,after:0}
      row.count++;row.before+=stored.length;row.after+=chosen.length
      if(statistics.checkedTiles%1000===0)onProgress({...statistics,total:binaryKeys.length})
    }
  }
  // Bound IO and transient allocations; do not hold the city in RAM.
  await Promise.all(Array.from({length:4},worker))
  async function rewrite(key,parents=new Set()){
    if(mapped.has(key))return mapped.get(key)
    if(parents.has(key))throw Error('Cyclic source catalog')
    const bytes=await read(key)
    if(!key.endsWith('.json')&&!key.endsWith('.json.gz'))return store(bytes,key)
    const compressed=key.endsWith('.gz'),raw=compressed?gunzipSync(bytes):bytes,text=raw.toString('utf8')
    JSON.parse(text)
    const references=[...new Set([...text.matchAll(refs)].map(m=>m[1]))],ancestors=new Set([...parents,key])
    for(const reference of references)await rewrite(reference,ancestors)
    let updated=text.replace(refs,(_,reference)=>JSON.stringify(mapped.get(reference)))
    if(key===inventory.release){
      const release=JSON.parse(text),coreKey=mapped.get(release.core)
      if(!coreKey||release.schema!=='spinward-metro-release')throw Error('Invalid release root')
      updated=updated.replace(/("coreSha256"\s*:\s*")[a-f0-9]{64}("\s*[,}])/,(_,a,b)=>a+objects[coreKey].sha256+b)
      if(JSON.parse(updated).coreSha256!==objects[coreKey].sha256)throw Error('Invalid rewritten core checksum')
    }
    // Text replacement leaves all coordinates, descriptors and recipe numbers exact.
    return store(updated===text?bytes:compressed?gzipSync(Buffer.from(updated),{level:6,mtime:0}):Buffer.from(updated),key)
  }
  const release=await rewrite(inventory.release)
  // Reuse only the reference closure; stale objects cannot leak into publication.
  const reachable=new Set(),queue=[release]
  const reverse=new Map([...mapped].map(([a,b])=>[b,a]))
  while(queue.length){
    const key=queue.pop();if(reachable.has(key))continue
    reachable.add(key)
    const original=reverse.get(key)
    if(original.endsWith('.json')||original.endsWith('.json.gz')){
      const bytes=await read(original),text=(original.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8')
      for(const match of text.matchAll(refs))queue.push(mapped.get(match[1]))
    }
  }
  const finalObjects=Object.fromEntries(Object.entries(objects).filter(([key])=>reachable.has(key)).sort(([a],[b])=>a.localeCompare(b)))
  const sourceObjects=Object.fromEntries(Object.entries(inventory.sourceObjects??{}).map(([name,key])=>[name,mapped.get(key)]).filter(([,key])=>reachable.has(key)))
  const result={version:1,release,objects:finalObjects,sourceObjects,bytes:Object.values(finalObjects).reduce((n,o)=>n+o.bytes,0)}
  const report={origin:'ai',created:new Date().toISOString(),encoder:'meshoptimizer 0.22.0 / lossless sequence + vertex / gzip5',sourceRelease:inventory.release,
    release,sourceBytes:inventory.bytes,bytes:result.bytes,objects:Object.keys(finalObjects).length,...statistics,groups}
  await fs.writeFile(path.join(destination,'conversion-report.json'),JSON.stringify(report,null,2))
  await fs.writeFile(path.join(destination,'inventory.json'),JSON.stringify(result))
  return report
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [source,destination]=process.argv.slice(2)
  if(!source||!destination)throw Error('Provide source package and NEW destination directory')
  console.log(JSON.stringify(await compressRelease(source,destination,{onProgress:row=>console.log(JSON.stringify(row))}),null,2))
}
