const configuredRoot=import.meta.env?.VITE_METRO_DATA_ROOT??'/'

export function metroDataURL(path,root=configuredRoot,origin=globalThis.location?.origin??'http://localhost'){
  const base=new URL(root.endsWith('/')?root:root+'/',origin)
  const url=new URL(path.replace(/^\/+/,''),base)
  if(!['http:','https:'].includes(url.protocol))throw Error('Invalid metro data URL')
  return url.href
}

export async function readMetroJSON(path,{signal,sha256,fetcher=fetch}={}){
  const response=await fetcher(metroDataURL(path),{signal})
  if(!response.ok)throw Error(`Tokyo data: ${response.status} ${path}`)
  let data=await response.arrayBuffer()
  if(sha256){
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('')
    if(digest!==sha256)throw Error('Tokyo data checksum mismatch')
  }
  const signature=new Uint8Array(data,0,Math.min(2,data.byteLength))
  if(signature[0]===31&&signature[1]===139)data=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  return JSON.parse(new TextDecoder().decode(data))
}

export function objectHash(path){
  const match=/^objects\/([a-f0-9]{2})\/([a-f0-9]{64})\.(?:json|bin)\.gz$/.exec(path)
  if(!match||match[1]!==match[2].slice(0,2))throw Error('Invalid immutable metro object')
  return match[2]
}

export async function loadMetroRelease(path,options){
  const match=/(?:^|\/)releases\/([a-f0-9]{64})\.json$/.exec(path)
  if(!match)throw Error('Metro release must pin an immutable manifest')
  const release=await readMetroJSON(path,{...options,sha256:match[1]})
  if(release.schema!=='spinward-metro-release'||release.version!==1)throw Error('Unsupported metro release')
  const hash=objectHash(release.core)
  if(hash!==release.coreSha256)throw Error('Inconsistent metro core checksum')
  const core=await readMetroJSON(release.core,{...options,sha256:hash})
  if(core.version!==1||core.study.layout!==release.source.layout||core.study.radius!==release.source.radius||core.study.span!==release.source.span)throw Error('Incompatible metro core')
  return{...core,release:{id:match[1],path}}
}
