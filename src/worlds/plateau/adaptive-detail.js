// Shrink optional distant layers, never the near tile/facade/contact budgets.
export function distantDetail(level){
  return [
    {terrainDistance:Infinity,range:1},
    {terrainDistance:1400,range:.75},
    {terrainDistance:650,range:.5}
  ][Math.max(0,Math.min(2,Math.round(level)))]
}

export function attachTerrainLOD(refs,data){
  if(!data.terrainLOD)return
  const rows=new Map(data.terrainLOD.map(row=>[row.tile,row]))
  for(const f of refs){
    f.fullSegments=f.segments
    f.coarseSegments=f.segments.map(s=>{
      const row=rows.get(s.tile)
      return row?{...s,...row,first:0,count:row.indices.length}:s
    })
    f.coarseSelected=f.segments.map(()=>false)
  }
}

export function selectTerrainLOD(refs,localEye,distance){
  let changed=false
  for(const f of refs){
    if(!f.fullSegments)continue
    if(distance===Infinity&&!f.coarseSelected.some(Boolean))continue
    if(f.detailDistance===distance&&f.detailEye?.distanceToSquared(localEye)<625)continue
    f.detailDistance=distance;f.detailEye=localEye.clone()
    const selected=f.fullSegments.map((s,i)=>{
      const coarse=f.coarseSegments[i]
      if(!coarse.center)return s
      const d=Math.hypot(...coarse.center.map((v,k)=>v-localEye.getComponent(k)))-coarse.radius
      // Different enter/leave distances prevent boundary flicker while walking.
      const next=d>distance*(f.coarseSelected[i] ? .9 : 1.1)
      if(next!==f.coarseSelected[i]){changed=true;f.coarseSelected[i]=next}
      return next?coarse:s
    })
    f.segments=selected
  }
  return changed
}
