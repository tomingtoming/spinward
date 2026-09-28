import {expect,test} from 'bun:test'
import {Vector3} from 'three'
import {prepareTile} from './tile-processing.js'
import {prepareTerrainLOD} from './terrain-lod.js'
import {MetroTiles} from './metro-tiles.js'
import {selectTerrainLOD,distantDetail} from './adaptive-detail.js'

function grid(){
  const positions=[],indices=[],n=40
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)positions.push(x*5,y*5,Math.sin(x/7)*.1)
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,d,a,d,c)}
  return {name:'terrain',colour:'#fff',roughness:1,segments:[{tile:'0-0',first:0,count:indices.length}],attributes:{position:new Float32Array(positions),index:new Uint32Array(indices)}}
}
const sample={band:0,anchor:{local:[0,0]},bounds:[0,0,200,200],tiles:[{id:'0-0',bounds:[0,0,200,200],heightRange:[0,1],decodedBytes:100}],overview:[],reliefM:[0,1]}
const edges=(index:Uint32Array)=>{const counts=new Map<string,number>();for(let i=0;i<index.length;i+=3)for(let k=0;k<3;k++){const a=index[i+k],b=index[i+(k+1)%3],s=a<b?`${a}:${b}`:`${b}:${a}`;counts.set(s,(counts.get(s)??0)+1)}return [...counts].filter(([,n])=>n===1).map(([s])=>s).sort()}

test('terrain LOD removes interior triangles, preserving every boundary edge and source array',async()=>{
  const source=grid(),before=source.attributes.index.slice(),data=prepareTile([source],3200,sample)
  await prepareTerrainLOD(data)
  const row=data[0].terrainLOD[0]
  expect(row.indices.length).toBeLessThan(before.length/3)
  expect(row.error).toBeLessThanOrEqual(.351)
  expect(edges(row.indices)).toEqual(edges(before))
  expect(source.attributes.index).toEqual(before)
  expect(data[0].attributes).toBe(source.attributes)
})
test('far selection reduces submitted index ranges and restores exact geometry and tile ownership',async()=>{
  const data=await prepareTerrainLOD(prepareTile([grid()],3200,sample)),base=new MetroTiles({radius:3200},sample,{tiles:sample.tiles},[],{ownershipMask:true,overviewTilesPerChunk:10})
  try{
    base.addOverview(data[0]);base.refreshFar()
    const ref=base.far[0],original=ref.mesh.geometry.drawRange.count
    const far=new Vector3(0,0,0)
    expect(selectTerrainLOD(base.far,far,650)).toBe(true);base.refreshFar()
    expect(ref.mesh.geometry.drawRange.count).toBeLessThan(original/3)
    // Loading native geometry suppresses the same tile at either quality.
    base.entries.get('0-0').status='resident';base.refreshFar();expect(ref.mesh.visible).toBe(false)
    base.entries.get('0-0').status='unloaded';base.refreshFar();expect(ref.mesh.visible).toBe(true)
    expect(selectTerrainLOD(base.far,far,Infinity)).toBe(true);base.refreshFar()
    expect(ref.mesh.geometry.drawRange.count).toBe(original)
    expect(ref.mesh.geometry.index.array).toEqual(data[0].attributes.index)
    selectTerrainLOD(base.far,new Vector3(100,-3200,-100),650);base.refreshFar()
    expect(ref.mesh.geometry.drawRange.count).toBe(original)
    expect(distantDetail(0).range).toBe(1)
  }finally{base.dispose()}
})
