import {MeshoptSimplifier} from 'meshoptimizer'

// Only overview terrain is simplified. Source collision, near surfaces,
// buildings and ownership borders remain exact. Do this in the tile worker,
// once per download; quality changes only choose precomputed index ranges.
export async function prepareTerrainLOD(meshes){
  await MeshoptSimplifier.ready
  for(const mesh of meshes){
    if(mesh.name!=='terrain'||!mesh.segments?.length||!mesh.projected)continue
    const position=mesh.projected.position,source=mesh.attributes.index
    mesh.terrainLOD=[]
    for(const s of mesh.segments){
      const globals=[],local=new Map(),indices=new Uint32Array(s.count)
      for(let i=0;i<s.count;i++){
        const id=source[s.first+i]
        if(!local.has(id)){local.set(id,globals.length);globals.push(id)}
        indices[i]=local.get(id)
      }
      const points=new Float32Array(globals.length*3),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
      for(let i=0;i<globals.length;i++)for(let axis=0;axis<3;axis++){
        const value=position[globals[i]*3+axis];points[i*3+axis]=value;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value)
      }
      const [reduced,error]=MeshoptSimplifier.simplify(indices,points,3,Math.max(3,Math.floor(s.count/24)*3),.35,['LockBorder','ErrorAbsolute'])
      const center=min.map((v,i)=>(v+max[i])/2),radius=Math.hypot(...max.map((v,i)=>(v-min[i])/2))
      mesh.terrainLOD.push({tile:s.tile,indices:reduced.map(i=>globals[i]),center,radius,error})
    }
  }
  return meshes
}
