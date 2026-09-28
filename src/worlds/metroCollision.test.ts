import {test,expect} from 'bun:test'
import {Vector3} from 'three'
import {metroCollisionParts,MetroCollision,type NativeMesh} from './metroCollision'
import {getCityGroundHeight} from '../objects/cityLayout'
import {citySurfaceVertices} from '../objects/citySurfaceMesh'
import {metroPlacementMatrix} from './metroPlacement'

const mesh:NativeMesh={name:'terrain',attributes:{position:Float32Array.from([-10,-10,-5,10,-10,-5,10,10,-5,-10,10,-5]),index:Uint32Array.from([0,1,2,0,2,3])}}
test('native triangles remain the same physical surface after changing cylinder axis',()=>{
  const parts=metroCollisionParts([mesh],2,3200)
  expect(parts.reduce((n,b)=>n+b.surfaceMesh!.length,0)).toBe(18)
  for(const b of parts){
    const native=b.surfaceMesh!,p=citySurfaceVertices(native,3200)
    for(let i=0;i<p.length;i+=3){
      const point=new Vector3(p[i]+3200,p[i+1],p[i+2]).applyAxisAngle(new Vector3(0,1,0),-b.azimuth);point.y+=b.axial
      const a=b.azimuth+native[i]/3200,r=3200-native[i+2]
      expect(point.distanceTo(new Vector3(r*Math.cos(a),b.axial+native[i+1],r*Math.sin(a)))).toBeLessThan(.001)
    }
  }
})
const tile={id:'south/0',path:'test',decodedBytes:128,bounds:[-10,-10,10,10],band:0}
const tick=()=>new Promise(r=>setTimeout(r,10))
test('a bridge stays collidable across terrain eviction and is removed on world disposal',async()=>{
  const bridge={...mesh,name:'bridge-decks',attributes:{...mesh.attributes,position:Float32Array.from(Array.from(mesh.attributes.position,(v,i)=>i%3===2?4:v))}}
  const stream=new MetroCollision([tile],3200,40000,async()=>[mesh])
  stream.setStructures(metroCollisionParts([bridge],0,3200))
  stream.request([{azimuth:0,axial:0,distance:20}]);await tick()
  expect(getCityGroundHeight(stream.index,3200,0,0,4)).toBeGreaterThan(3.97)
  stream.request([])
  expect(getCityGroundHeight(stream.index,3200,0,0,4)).toBeGreaterThan(3.97)
  stream.dispose();expect(stream.index.all.length).toBe(0)
})
test('stream freezes before data, preserves negative terrain and releases collision on exit',async()=>{
  const stream=new MetroCollision([tile],3200,40000,async()=>[mesh])
  const focus=[{azimuth:0,axial:0,distance:20}]
  expect(stream.request(focus)).toBe(false);await tick();expect(stream.request(focus)).toBe(true)
  const index=stream.index,h=getCityGroundHeight(index,3200,0,0,0)
  expect(h).toBeLessThan(-4.97);expect(h).toBeGreaterThan(-5.01)
  stream.request([{azimuth:Math.PI,axial:0,distance:20}]);expect(stream.index).toBe(index);expect(index.all.length).toBe(0);expect(stream.stats.bytes).toBe(0)
  stream.dispose()
})
test('failed collision stays unavailable and explicit retry recovers',async()=>{
  let fail=true;const stream=new MetroCollision([tile],3200,40000,async()=>{if(fail)throw Error('injected');return[mesh]})
  const focus=[{azimuth:0,axial:0,distance:20}];stream.request(focus);await tick()
  expect(stream.request(focus)).toBe(false);expect(stream.stats.failed.length).toBe(1);expect(stream.index.all.length).toBe(0)
  fail=false;stream.retry();await tick();expect(stream.request(focus)).toBe(true);stream.dispose()
})
test('late data cannot restore an evicted source tile',async()=>{
  let deliver!:(meshes:NativeMesh[])=>void
  const stream=new MetroCollision([tile],3200,40000,()=>new Promise(r=>deliver=r))
  stream.request([{azimuth:0,axial:0,distance:20}]);stream.request([]);deliver([mesh]);await tick()
  expect(stream.index.all.length).toBe(0);expect(stream.stats.entries).toBe(0);stream.dispose()
})

test('asymmetric source tiles load at their rotated location and retain the drawn triangle positions',async()=>{
  const source:NativeMesh={name:'terrain',attributes:{position:Float32Array.from([300,8690,21,327,8690,21,327,8710,21,300,8710,21]),index:Uint32Array.from([0,1,2,0,2,3])}}
  for(const band of [0,1,2]){
    const entry={id:'rotated',path:'test',decodedBytes:128,bounds:[300,8690,327,8710],band}
    let loads=0
    const stream=new MetroCollision([entry],3200,40000,async()=>{loads++;return[source]})
    stream.request([{azimuth:band*Math.PI*2/3+313.5/3200,axial:8700,distance:40}])
    await tick();expect(loads).toBe(0)
    const focus=[{azimuth:-(band*Math.PI*2/3+313.5/3200),axial:-8700,distance:40}]
    expect(stream.request(focus)).toBe(false);await tick();expect(stream.request(focus)).toBe(true);expect(loads).toBe(1)
    const expected=Array.from(source.attributes.index,id=>{
      const p=source.attributes.position,a=band*Math.PI*2/3+p[id*3]/3200,r=3200-p[id*3+2]
      return new Vector3(r*Math.sin(a),-r*Math.cos(a),-p[id*3+1]).applyMatrix4(metroPlacementMatrix())
    })
    let vertices=0
    for(const part of stream.index.all){
      const positions=citySurfaceVertices(part.surfaceMesh!,3200)
      for(let i=0;i<positions.length;i+=3){
        const p=new Vector3(positions[i]+3200,positions[i+1],positions[i+2]).applyAxisAngle(new Vector3(0,1,0),-part.azimuth);p.y+=part.axial
        expect(Math.min(...expected.map(e=>e.distanceTo(p)))).toBeLessThan(.001);vertices++
      }
    }
    expect(vertices).toBe(expected.length)
    expect(getCityGroundHeight(stream.index,3200,focus[0].azimuth,-8700,22)).toBeGreaterThan(20.99)
    stream.dispose()
  }
})
