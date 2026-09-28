import {prepareTerrainLOD} from './terrain-lod.js'
import {decodeTile,prepareTile} from './tile-processing.js'

self.onmessage=async({data:{id,kind,payload}})=>{
  try{
    const result=kind==='decode'?await decodeTile(payload.buffer,payload.decodedBytes):prepareTile(payload.meshes,payload.radius,payload.sample)
    if(payload.terrainLOD)await prepareTerrainLOD(result)
    const buffers=new Set()
    for(const mesh of result){
      for(const a of [...Object.values(mesh.attributes),...Object.values(mesh.projected??{})])buffers.add(a.buffer)
      for(const row of mesh.terrainLOD??[])buffers.add(row.indices.buffer)
      if(mesh.tileOrdinals)buffers.add(mesh.tileOrdinals.buffer)
      if(mesh.shellBounds)buffers.add(mesh.shellBounds.buffer)
    }
    self.postMessage({id,result},[...buffers])
  }catch(error){self.postMessage({id,error:String(error)})}
}
