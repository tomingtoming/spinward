/** Share immutable native arrays, never render-owned bitmaps or refined meshes.
 * Each consumer owns its cancellation. A short, byte-bounded reuse window also
 * joins collision and scenery requests that do not quite overlap in time. */
export function createSharedTileSource(load,{maxBytes=8*1024*1024,ttl=4000,now=()=>performance.now()}={}){
  const entries=new Map(),stats={loads:0,hits:0,aborts:0,bytes:0,peakBytes:0,pending:0}
  function trim(){
    const time=now()
    for(const [key,e] of entries)if(e.data&&(time-e.used>ttl||stats.bytes>maxBytes)){
      entries.delete(key);stats.bytes-=e.bytes
    }
  }
  function get(descriptor,signal){
    if(signal?.aborted)return Promise.reject(new DOMException('Tile no longer wanted','AbortError'))
    trim()
    const key=[descriptor.path,descriptor.sha256??'',descriptor.decodedBytes].join('|')
    let e=entries.get(key)
    if(!e){
      e={controller:new AbortController(),users:0,bytes:descriptor.decodedBytes,used:now()};entries.set(key,e)
      stats.loads++;stats.pending++
      e.promise=Promise.resolve().then(()=>load(descriptor,e.controller.signal)).then(data=>{
        if(entries.get(key)===e&&!e.controller.signal.aborted){
          e.data=data;e.used=now();stats.bytes+=e.bytes;trim();stats.peakBytes=Math.max(stats.peakBytes,stats.bytes)
        }
        return data
      }).catch(error=>{if(entries.get(key)===e)entries.delete(key);throw error}).finally(()=>stats.pending--)
    }else{
      stats.hits++;e.used=now();entries.delete(key);entries.set(key,e)
    }
    const entry=e;entry.users++
    return new Promise((resolve,reject)=>{
      let done=false
      const finish=(error,data)=>{
        if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.users--
        if(!entry.users&&!entry.data&&entries.get(key)===entry){entries.delete(key);entry.controller.abort();stats.aborts++}
        if(error)reject(error)
        else resolve(data.map(m=>({...m,attributes:{...m.attributes},segments:m.segments?.map(s=>({...s}))})))
      }
      const abort=()=>finish(new DOMException('Tile no longer wanted','AbortError'))
      signal?.addEventListener('abort',abort,{once:true})
      entry.promise.then(data=>finish(null,data),error=>finish(error))
    })
  }
  return{get,diagnostics:()=>{trim();return{...stats,maxBytes,ttl}},clear(){
    for(const e of entries.values())e.controller.abort();entries.clear();stats.bytes=0
  }}
}
