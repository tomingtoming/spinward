import * as T from 'three'
import {BaseTiles,fetchTile} from './base-tiles.js'
import {WalkStream} from './walk-stream.js'
import {refineCurvedBuilding,meshArrayBytes} from './curved-building-mesh.js'
import {prepareTileAsync} from './tile-worker-client.js'
import {TileCoverage} from './tile-coverage.js'
import {metroDataURL} from './data-source.js'
import {attachTerrainLOD} from './adaptive-detail.js'
import {overviewHierarchy} from './overview-chunks.js'
import {patchBuildingShellCulling} from './building-shell-culling.js'

export async function tileTexture(blob,scale=1){
  const original=await createImageBitmap(blob,{imageOrientation:'flipY'})
  if(scale>=1)return original
  try{return await createImageBitmap(original,{resizeWidth:Math.max(1,Math.round(original.width*scale)),resizeHeight:Math.max(1,Math.round(original.height*scale)),resizeQuality:'high',imageOrientation:'none'})}
  finally{original.close()}
}

export async function fetchMetroTile(descriptor,signal,finish={},radius=3200,sample,{textureScale=1,terrainLOD=false}={}){
  if(descriptor.source){
    const base=await fetchMetroTile(descriptor.source,signal,finish,radius,sample,{textureScale,terrainLOD})
    try{
      for(const extra of descriptor.details){
        const native=await fetchTile(extra,signal),data=sample?await prepareTileAsync(native,radius,sample):native
        base.push(...data);base.extraDecodedBytes=(base.extraDecodedBytes??0)+(data.extraDecodedBytes??0)
      }
      if(signal?.aborted)throw new DOMException('Tile no longer wanted','AbortError')
      return base
    }catch(error){for(const mesh of base)mesh.bitmap?.close();throw error}
  }
  const native=await fetchTile(descriptor,signal),data=sample?await prepareTileAsync(native,radius,sample,terrainLOD):native,loaded=[]
  try{
    data.extraDecodedBytes??=0
    // Local bodies must follow the same curved wall as their facade instances.
    // The multi-tile overview has no facade kit and retains its cheap geometry.
    for(const mesh of data)if(!sample&&mesh.name==='buildings'&&(!mesh.segments||mesh.segments.length===1)){
      const original=mesh.attributes
      mesh.attributes=refineCurvedBuilding(original,radius)
      // Terrain views can retain the original shared download ArrayBuffer.
      // Count all new arrays rather than subtracting its old building slice.
      if(mesh.attributes!==original)data.extraDecodedBytes+=meshArrayBytes([mesh])
      if(mesh.segments)mesh.segments=[{...mesh.segments[0],first:0,count:mesh.attributes.index.length}]
    }
    // Sequential within a tile bounds transient bitmap memory and cleanup.
    for(const mesh of data)if(mesh.texture){
      const response=await fetch(metroDataURL(descriptor.textures?.[mesh.texture]??finish.textures?.[mesh.texture]??mesh.texture),{signal})
      if(!response.ok)throw Error(`${response.status} ${mesh.texture}`)
      mesh.bitmap=await tileTexture(await response.blob(),textureScale)
      loaded.push(mesh.bitmap)
    }
    if(signal?.aborted)throw new DOMException('Tile no longer wanted','AbortError')
    return data
  }catch(error){for(const bitmap of loaded)bitmap.close();throw error}
}

export async function fetchCompressedJSON(descriptor,signal){
  const response=await fetch(metroDataURL(descriptor.path),{signal})
  if(!response.ok)throw Error(`${response.status} ${descriptor.path}`)
  let data=await response.arrayBuffer();const bytes=new Uint8Array(data)
  if(bytes[0]===31&&bytes[1]===139)data=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if(descriptor.decodedBytes!==undefined&&data.byteLength!==descriptor.decodedBytes)throw Error('Truncated JSON tile')
  return JSON.parse(new TextDecoder().decode(data))
}

export class MetroTiles extends BaseTiles{
  constructor(study,sample,manifest,overview,options={}){
    const {finish={},ownershipMask=false,night=null,overviewTilesPerChunk=0,...settings}=options
    const details=new Map((finish.surfaces?.[sample.id]?.tiles??[]).map(t=>[t.id,[t]]))
    for(const t of finish.landmarks??[])if(t.band===sample.id)details.set(t.id,[...(details.get(t.id)??[]),t])
    const ready=new Map(manifest.tiles.map(tile=>{
      const extra=details.get(tile.id)
      return[tile.id,extra?{...tile,source:tile,details:extra,decodedBytes:tile.decodedBytes+extra.reduce((n,d)=>n+d.decodedBytes,0)}:tile]
    }))
    const all=sample.tiles.map(tile=>ready.get(tile.id)??{...tile,heightRange:sample.reliefM,decodedBytes:Infinity})
    super(study,sample,{...manifest,tiles:all,overview:{decodedBytes:sample.overview.reduce((n,t)=>n+t.decodedBytes,0)}},overview,
      {fetchNear:(d,s)=>fetchMetroTile(d,s,finish,study.radius,sample),initialMode:'colony',maxBytes:24*1024*1024,...settings})
    this.night=night
    this.overviewTilesPerChunk=overviewTilesPerChunk
    this.coverage=ownershipMask?new TileCoverage():null
    // Existing callers may supply an eager overview; progressive callers append
    // it later. Both paths get identical ownership masks.
    overview.forEach((data,i)=>{if(data.tileOrdinals)this.coverage?.patch(this.far[i].mesh,data,'overview')})
  }
  addOverview(data,mesh=this.mesh(data,'overview')){
    const {object,refs}=overviewHierarchy(data,mesh,this.overviewTilesPerChunk)
    attachTerrainLOD(refs,data)
    this.far.push(...refs);this.group.add(object)
  }
  dispose(){super.dispose();this.coverage?.dispose()}
  mesh(data,level){
    const mesh=super.mesh(data,level)
    if(data.tileOrdinals)this.coverage?.patch(mesh,data,level)
    if(data.bitmap){
      const texture=new T.Texture(data.bitmap);texture.flipY=false;texture.colorSpace=T.SRGBColorSpace
      texture.anisotropy=4;texture.needsUpdate=true
      const [x0,y0,x1,y1]=data.textureBounds,p=data.attributes.position,uv=new Float32Array(p.length/3*2)
      for(let i=0;i<p.length/3;i++){uv[i*2]=(p[i*3]-x0)/(x1-x0);uv[i*2+1]=(p[i*3+1]-y0)/(y1-y0)}
      mesh.geometry.setAttribute('uv',new T.BufferAttribute(uv,2));mesh.material.map=texture;mesh.material.needsUpdate=true
      mesh.material.addEventListener('dispose',()=>{texture.dispose();data.bitmap.close()},{once:true})
    }
    this.night?.patch(mesh,data,level)
    patchBuildingShellCulling(mesh,data,this)
    return mesh
  }
}

export class MetroWalkStream extends WalkStream{
  // This first surface pass paints roads onto the actual DEM mesh. Do not
  // inherit the older sample world's synthetic 9 cm raised road support.
  // Elevated source bridge supports are a separate, still pending layer.
  ground(x,y){return this.terrain(x,y)}
  entry(x,y){
    const d=this.data,[ox,oy]=d.gridOrigin
    const i=Math.max(0,Math.min(d.gridShape[0]-1,Math.floor((x-ox)/d.tileSize)))
    const j=Math.max(0,Math.min(d.gridShape[1]-1,Math.floor((y-oy)/d.tileSize)))
    return this.entries.get(`${i}-${j}`)
  }
}
