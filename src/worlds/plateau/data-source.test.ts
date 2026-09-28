import {expect,test} from 'bun:test'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {metroDataURL,readMetroJSON,loadMetroRelease,objectHash} from './data-source.js'

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
function fixture(){
  const core=gzipSync(JSON.stringify({version:1,study:{layout:'inland-b',radius:3200,span:40000}}))
  const coreHash=hash(core),corePath=`objects/${coreHash.slice(0,2)}/${coreHash}.json.gz`
  const manifest=Buffer.from(JSON.stringify({schema:'spinward-metro-release',version:1,core:corePath,coreSha256:coreHash,source:{layout:'inland-b',radius:3200,span:40000}}))
  const path=`releases/${hash(manifest)}.json`
  const objects=new Map([[path,manifest],[corePath,core]])
  const requests:string[]=[]
  const fetcher=async(url:string)=>{const p=new URL(url).pathname.slice(1);requests.push(p);return new Response(objects.get(p),{status:objects.has(p)?200:404})}
  return{path,objects,requests,fetcher,corePath}
}

test('dataset URLs retain the selected CDN namespace and legacy root still works',()=>{
  expect(metroDataURL('/objects/a.bin.gz','https://data.example.test/spinward/')).toBe('https://data.example.test/spinward/objects/a.bin.gz')
  expect(metroDataURL('west/base.json','/','https://app.example.test')).toBe('https://app.example.test/west/base.json')
  expect(()=>metroDataURL('javascript:alert(1)')).toThrow('Invalid metro data URL')
})

test('one immutable release selects one checksum-verified compressed core',async()=>{
  const f=fixture(),world=await loadMetroRelease(f.path,{fetcher:f.fetcher})
  expect(world.study.layout).toBe('inland-b')
  expect(world.release.path).toBe(f.path)
  expect(f.requests).toEqual([f.path,f.corePath])
})

test('a stale CDN core cannot silently mix with another release',async()=>{
  const f=fixture();f.objects.set(f.corePath,gzipSync(JSON.stringify({version:1,study:{layout:'wrong'}})))
  await expect(loadMetroRelease(f.path,{fetcher:f.fetcher})).rejects.toThrow('checksum mismatch')
})

test('a mutable release pointer or malformed object path fails before use',async()=>{
  const f=fixture()
  await expect(loadMetroRelease('releases/latest.json',{fetcher:f.fetcher})).rejects.toThrow('pin an immutable')
  expect(f.requests).toEqual([])
  expect(()=>objectHash('objects/aa/'+'b'.repeat(64)+'.json.gz')).toThrow('Invalid immutable')
})

test('JSON loading accepts plain or browser-decoded responses and rejects HTTP failures',async()=>{
  expect(await readMetroJSON('plain.json',{fetcher:async()=>new Response('{"ready":true}')})).toEqual({ready:true})
  await expect(readMetroJSON('missing.json',{fetcher:async()=>new Response('',{status:404})})).rejects.toThrow('404')
})
