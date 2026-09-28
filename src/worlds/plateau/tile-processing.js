import {unpackTile} from './tile-format.js'
import {refineCurvedBuilding,meshArrayBytes} from './curved-building-mesh.js'
import {surfaceAngle} from './surface-frame.js'
import {tileHeader,restoreMeshoptTile} from './tile-meshopt.js'
import {closedBuildingShells} from './closed-building-shell.js'

export async function decodeTile(buffer,decodedBytes){
  const signature=new Uint8Array(buffer,0,Math.min(2,buffer.byteLength))
  if(signature[0]===31&&signature[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if(tileHeader(buffer).header.version===2)buffer=await restoreMeshoptTile(buffer,decodedBytes)
  if(buffer.byteLength!==decodedBytes)throw Error('Truncated base tile')
  return unpackTile(buffer)
}

/** Pure render preparation. Native collision arrays are never modified. */
export function prepareTile(meshes,radius,sample){
  let extraDecodedBytes=0
  const data=meshes.map(mesh=>{
    let a=mesh.attributes
    let shellBounds
    if(mesh.name==='buildings'&&(!mesh.segments||mesh.segments.length===1)){
      const shells=closedBuildingShells(a)
      if(shells){a={...a,closedShell:shells.mask};shellBounds=shells.bounds;extraDecodedBytes+=shellBounds.byteLength}
      const beforeRefinement=a
      a=refineCurvedBuilding(a,radius)
      if(a!==beforeRefinement)extraDecodedBytes+=meshArrayBytes([{attributes:a}])
      else if(shells)extraDecodedBytes+=shells.mask.byteLength
    }
    const p=new Float32Array(a.position.length),n=a.normal?new Float32Array(a.normal.length):null
    for(let i=0;i<p.length;i+=3){
      const angle=surfaceAngle(radius,sample,'colony',a.position[i]),c=Math.cos(angle),s=Math.sin(angle),h=a.position[i+2],r=radius-h
      p[i]=r*s;p[i+1]=-r*c;p[i+2]=-(a.position[i+1]+sample.anchor.local[1])
      if(n){const nx=a.normal[i]/(1-h/radius),ny=a.normal[i+1],nz=a.normal[i+2],length=Math.hypot(nx,ny,nz)||1
        n[i]=(nx*c-nz*s)/length;n[i+1]=(nx*s+nz*c)/length;n[i+2]=-ny/length}
    }
    extraDecodedBytes+=p.byteLength+(n?.byteLength??0)
    const segments=a!==mesh.attributes&&mesh.segments?[{...mesh.segments[0],first:0,count:a.index.length}]:mesh.segments
    const tileOrdinals=new Float32Array(p.length/3)
    if(segments){
      for(const segment of segments){const [x,y]=segment.tile.split('-').map(Number),id=y*17+x
        for(let i=segment.first;i<segment.first+segment.count;i++)tileOrdinals[a.index[i]]=id}
    }
    extraDecodedBytes+=tileOrdinals.byteLength
    return{...mesh,attributes:a,segments,tileOrdinals,...(shellBounds?{shellBounds}:{}),projected:{position:p,...(n?{normal:n}:{})}}
  })
  data.extraDecodedBytes=extraDecodedBytes
  return data
}
