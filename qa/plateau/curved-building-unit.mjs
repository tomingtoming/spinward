import assert from 'node:assert/strict'
import * as T from 'three'
import {refineCurvedBuilding} from '../../src/worlds/plateau/curved-building-mesh.js'
import {BaseTiles} from '../../src/worlds/plateau/base-tiles.js'
import {FarStream} from '../../src/worlds/plateau/far-stream.js'
import {fetchMetroTile} from '../../src/worlds/plateau/metro-tiles.js'
import {packTile} from '../../src/worlds/plateau/tile-format.js'

const radius=3200,warp=([x,y,z])=>new T.Vector3((radius-z)*Math.sin(x/radius),-(radius-z)*Math.cos(x/radius),-y)
// Tall diagonal facade, far from the native origin: the old 40 m X-span
// restriction missed the large height/X interpolation term on these triangles.
const source={position:new Float32Array([-1180,19300,20,-1140,19320,20,-1140,19320,240,-1180,19300,240]),
  color:new Float32Array([1,0,0,0,1,0,0,1,1,1,0,1]),index:new Uint32Array([0,1,2,0,2,3])}
const refined=refineCurvedBuilding(source,radius)
const error=attributes=>{
  const p=attributes.position,idx=attributes.index;let max=0
  for(let i=0;i<idx.length;i+=3){
    const face=Array.from(idx.slice(i,i+3),j=>Array.from(p.slice(j*3,j*3+3))),curved=face.map(warp)
    const normal=new T.Vector3().subVectors(new T.Vector3(...face[1]),new T.Vector3(...face[0])).cross(new T.Vector3().subVectors(new T.Vector3(...face[2]),new T.Vector3(...face[0])))
    assert.ok(normal.dot(new T.Vector3(20,-40,0))>0,'source winding preserved')
    for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++){
      const weights=[a/10,b/10,1-(a+b)/10],native=[0,0,0],linear=new T.Vector3()
      for(let j=0;j<3;j++){for(let k=0;k<3;k++)native[k]+=face[j][k]*weights[j];linear.addScaledVector(curved[j],weights[j])}
      max=Math.max(max,linear.distanceTo(warp(native)))
    }
  }
  return max
}
const before=error(source),after=error(refined)
assert.ok(before>.6,'fixture must expose tall-wall warping')
assert.ok(after<.012,'refined wall must remain within 12 mm of its analytic surface')
assert.ok(refined.index.length>source.index.length)
assert.deepEqual(Array.from(source.index),[0,1,2,0,2,3],'source index unchanged')
for(let i=0;i<refined.position.length;i+=3){
  const [x,y,z]=refined.position.slice(i,i+3)
  assert.ok(Math.abs(y-(19300+(x+1180)/2))<.003,'source wall plane preserved')
  assert.ok(Math.abs(refined.color[i+1]-(x+1180)/40)<.0001,'attribute interpolation')
  assert.ok(Math.abs(refined.color[i+2]-(z-20)/220)<.0001,'attribute interpolation')
}
const axial={position:new Float32Array([0,0,0,0,100,0,0,100,220]),index:new Uint32Array([0,1,2])}
assert.equal(refineCurvedBuilding(axial,radius),axial,'no extra work for an exactly planar axial wall')
assert.throws(()=>refineCurvedBuilding(source,0))

// The streamed single-tile far mesh must use the new complete draw range;
// the multi-tile overview must preserve its segment/index correspondence.
const originalFetch=globalThis.fetch
try{
  for(const segments of [undefined,[{tile:'0',first:0,count:6}],[{tile:'0',first:0,count:3},{tile:'1',first:3,count:3}]]){
    const bytes=packTile([{name:'buildings',attributes:source,segments}])
    globalThis.fetch=async()=>new Response(bytes)
    const result=await fetchMetroTile({path:'fixture',decodedBytes:bytes.byteLength}),mesh=result[0]
    if(segments?.length===2){assert.equal(mesh.attributes.index.length,6);assert.equal(result.extraDecodedBytes,0);assert.deepEqual(mesh.segments,segments)}
    else{
      assert.equal(mesh.attributes.index.length,refined.index.length)
      assert.ok(result.extraDecodedBytes>=Object.values(refined).reduce((n,a)=>n+a.byteLength,0),'retained input buffer is not subtracted')
      if(segments)assert.equal(mesh.segments[0].count,refined.index.length)
    }
  }
}finally{globalThis.fetch=originalFetch}

// Unknown refinement expansion cannot overrun either resident byte cap.
const study={radius},sample={anchor:[0,0],bandIndex:0},tile={id:'0',bounds:[0,0,10,10],heightRange:[0,10],decodedBytes:100}
const manifest={tiles:[tile],overview:{decodedBytes:0}},flush=()=>new Promise(r=>setImmediate(r))
const expanded=()=>Object.assign([],{extraDecodedBytes:100})
const base=new BaseTiles(study,sample,manifest,[],{fetchNear:async()=>expanded(),maxBytes:150})
base.entries.get('0').wanted=true;base.pump();await flush()
assert.equal(base.diagnostics().nearDecodedBytes,0);assert.equal(base.entries.get('0').decodedBytes,200)
assert.equal(base.entries.get('0').wanted,false);base.dispose()
const owner={manifest:{farTiles:[{...tile,tiles:['0']}]},refreshFar(){},onError(){}}
const far=new FarStream(owner,async()=>expanded(),{maxBytes:150})
far.entries.get('0').wanted=true;far.pump();await flush()
assert.equal(far.diagnostics().decodedBytes,0);assert.equal(far.entries.get('0').decodedBytes,200)
assert.equal(far.entries.get('0').wanted,false);far.dispose()
console.log(JSON.stringify({beforeErrorM:before,afterErrorM:after,beforeTriangles:2,afterTriangles:refined.index.length/3,byteCaps:'near/far passed'}))
