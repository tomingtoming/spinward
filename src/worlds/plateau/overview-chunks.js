import * as T from 'three'

// A four-kilometre overview used to be one culling sphere, so a sliver of
// visible land submitted the whole district in both eyes. Partition ownership
// tiles without altering a triangle, material or the shared vertex buffers.
export function overviewChunks(data,mesh,tilesPerAxis){
  if(!tilesPerAxis||!data.segments?.length)return[{mesh,segments:data.segments,indices:data.attributes.index}]
  const buckets=new Map(),source=data.attributes.index,attributes=mesh.geometry.attributes
  for(const s of data.segments){
    const [x,y]=s.tile.split('-').map(Number),key=`${Math.floor(x/tilesPerAxis)},${Math.floor(y/tilesPerAxis)}`
    if(!buckets.has(key))buckets.set(key,[])
    buckets.get(key).push(s)
  }
  if(buckets.size===1)return[{mesh,segments:data.segments,indices:source}]
  const parts=[]
  for(const rows of buckets.values()){
    const indices=new Uint32Array(rows.reduce((n,s)=>n+s.count,0)),segments=[];let offset=0
    for(const s of rows){indices.set(source.subarray(s.first,s.first+s.count),offset);segments.push({...s,first:offset});offset+=s.count}
    const geometry=new T.BufferGeometry()
    for(const [name,a] of Object.entries(attributes))geometry.setAttribute(name,a)
    geometry.setIndex(new T.BufferAttribute(indices.slice(),1))
    // Three's default bound scans every shared vertex; scan this index instead.
    const bounds=new T.Box3(),point=new T.Vector3(),position=geometry.attributes.position
    for(const i of indices)bounds.expandByPoint(point.fromBufferAttribute(position,i))
    geometry.boundingBox=bounds;geometry.boundingSphere=bounds.getBoundingSphere(new T.Sphere())
    const part=new T.Mesh(geometry,mesh.material);part.name=mesh.name;part.userData=mesh.userData
    part.castShadow=mesh.castShadow;part.receiveShadow=mesh.receiveShadow
    part.customDepthMaterial=mesh.customDepthMaterial;part.customDistanceMaterial=mesh.customDistanceMaterial
    parts.push({mesh:part,segments,indices})
  }
  return parts
}

// Split only when culling removes at least half the chunks. Fully visible
// distant districts remain one draw, avoiding a draw-call penalty on mobile.
// The union of both eye frusta prevents one-eye disappearance at screen edges.
export function overviewHierarchy(data,mesh,tilesPerAxis){
  const parts=overviewChunks(data,mesh,tilesPerAxis)
  if(parts.length===1)return{object:mesh,refs:parts}
  const whole=new T.Group(),detail=new T.Group(),lod=new T.LOD()
  whole.add(mesh);for(const p of parts)detail.add(p.mesh);lod.add(whole,detail)
  lod.name='overview-hierarchy'
  const frusta=[],matrix=new T.Matrix4(),sphere=new T.Sphere(),box=new T.Box3()
  lod.update=camera=>{
    const eyes=camera.isArrayCamera?camera.cameras:[camera]
    for(let i=0;i<eyes.length;i++){
      const eye=eyes[i];frusta[i]??=new T.Frustum()
      frusta[i].setFromProjectionMatrix(matrix.multiplyMatrices(eye.projectionMatrix,eye.matrixWorldInverse).multiply(lod.matrixWorld))
    }
    let visible=0
    for(const p of parts){
      // Indexed local boxes tightly contain the curved source geometry. Test
      // in the district's local frame, so colony rotation cannot inflate them.
      const geometry=p.mesh.geometry
      sphere.copy(geometry.boundingSphere)
      // One metre is negligible beside kilometre-scale chunks, but absorbs
      // CPU/GPU matrix rounding at an eye's screen edge.
      if(geometry.boundingBox)box.copy(geometry.boundingBox).expandByScalar(1)
      p.mesh.visible=geometry.drawRange.count>0&&eyes.some((_,i)=>geometry.boundingBox
        ?frusta[i].intersectsBox(box):frusta[i].intersectsSphere(sphere))
      if(p.mesh.visible)visible++
    }
    detail.visible=visible<=parts.length/2;whole.visible=!detail.visible
  }
  return{object:lod,refs:[{mesh,segments:data.segments,indices:data.attributes.index},...parts]}
}
