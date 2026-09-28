import {decodeTile,prepareTile} from './tile-processing.js'

// Two workers bound concurrent refinement and its transient memory. A worker
// owns only its current job; immutable native arrays remain with the caller.
let pool=[],serial=0
const queue=[]
function pump(){
  for(const slot of pool){
    if(slot.job||!queue.length)continue
    const job=queue.shift();slot.job=job
    slot.worker.postMessage({id:job.id,kind:job.kind,payload:job.payload},job.transfer)
  }
}
function run(kind,payload,transfer=[]){
  if(typeof window==='undefined'||typeof Worker==='undefined'){
    if(kind==='decode')return decodeTile(payload.buffer,payload.decodedBytes)
    const result=prepareTile(payload.meshes,payload.radius,payload.sample)
    return payload.terrainLOD?import('./terrain-lod.js').then(m=>m.prepareTerrainLOD(result)):Promise.resolve(result)
  }
  if(!pool.length)pool=Array.from({length:2},()=>{
    const slot={worker:new Worker(new URL('./tile-worker.js',import.meta.url),{type:'module'}),job:null}
    slot.worker.onmessage=({data})=>{
      const job=slot.job;slot.job=null
      if(data.error)job.reject(Error(data.error));else job.resolve(data.result)
      pump()
    }
    slot.worker.onerror=error=>{
      slot.job?.reject(Error(error.message));slot.job=null
      // A failed worker cannot strand the other active/queued requests.
      for(const job of queue.splice(0))job.reject(Error(error.message))
      slot.worker.terminate();pool=pool.filter(p=>p!==slot)
    }
    return slot
  })
  return new Promise((resolve,reject)=>{queue.push({id:++serial,kind,payload,transfer,resolve,reject});pump()})
}
export const decodeTileAsync=(buffer,decodedBytes)=>run('decode',{buffer,decodedBytes},[buffer])
export const prepareTileAsync=(meshes,radius,sample,terrainLOD=false)=>run('prepare',{meshes,radius,sample,terrainLOD})

// Macrotask boundaries prevent several completed downloads from becoming one
// long promise chain. Also used between mesh commits, where GPU objects belong.
export const yieldScene=()=>new Promise(resolve=>setTimeout(resolve,0))
