import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {compressRelease} from './compress_metro_release.mjs'
import {packTile} from '../../src/worlds/plateau/tile-format.js'
import {decodeTile} from '../../src/worlds/plateau/tile-processing.js'

test('new release preserves attributes and budgets, pins rewritten catalogs, and is deterministic',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spinward-codec-test-')),source=path.join(root,'source'),objects:Record<string,any>={}
  await fs.mkdir(source)
  const store=async(data:Buffer,ext:string)=>{
    const sha=createHash('sha256').update(data).digest('hex'),key=ext==='release'?`releases/${sha}.json`:`objects/${sha.slice(0,2)}/${sha}.${ext}`
    await fs.mkdir(path.dirname(path.join(source,'public',key)),{recursive:true});await fs.writeFile(path.join(source,'public',key),data)
    objects[key]={bytes:data.length,sha256:sha,contentType:'application/octet-stream',cacheControl:'public, max-age=31536000, immutable'};return key
  }
  try{
    const values=Float32Array.from({length:9000},(_,i)=>Math.sin(i/10)),native=packTile([{name:'terrain',attributes:{position:values}}])
    const tile=await store(gzipSync(native),'bin.gz'),duplicate=await store(gzipSync(native,{level:1}),'bin.gz')
    expect(duplicate).not.toBe(tile)
    const core=await store(gzipSync(JSON.stringify({version:1,tiles:[tile,duplicate].map(path=>({path,decodedBytes:native.length,bounds:[0,0,200,200]}))})),'json.gz')
    const release=await store(Buffer.from(JSON.stringify({schema:'spinward-metro-release',version:1,core,coreSha256:objects[core].sha256})),'release')
    await fs.writeFile(path.join(source,'inventory.json'),JSON.stringify({version:1,release,objects,sourceObjects:{'test/tile.bin.gz':tile},bytes:Object.values(objects).reduce((n,o)=>n+o.bytes,0)}))
    const a=await compressRelease(source,path.join(root,'a')),b=await compressRelease(source,path.join(root,'b'))
    expect(a.release).toBe(b.release);expect(a.checkedTiles).toBe(2);expect(a.compressedTiles).toBe(2)
    const manifest=JSON.parse(await fs.readFile(path.join(root,'a/public',a.release),'utf8')),newCoreBytes=await fs.readFile(path.join(root,'a/public',manifest.core))
    expect(createHash('sha256').update(newCoreBytes).digest('hex')).toBe(manifest.coreSha256)
    const descriptors=JSON.parse(gunzipSync(newCoreBytes).toString()).tiles
    expect(descriptors[0].path).toBe(descriptors[1].path)
    expect(a.objects).toBe(3)
    const descriptor=descriptors[0]
    expect(descriptor.decodedBytes).toBe(native.length);expect(descriptor.bounds).toEqual([0,0,200,200])
    const packed=await fs.readFile(path.join(root,'a/public',descriptor.path))
    const decoded=await decodeTile(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),descriptor.decodedBytes)
    expect(decoded[0].attributes.position).toEqual(values)
    expect(await fs.readFile(path.join(source,'public',tile))).toEqual(gzipSync(native))
    await expect(compressRelease(source,path.join(root,'a'))).rejects.toThrow()
    await expect(compressRelease(source,path.join(source,'nested'))).rejects.toThrow('separate')
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
