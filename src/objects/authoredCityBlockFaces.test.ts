import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CITY_BLOCK } from './authoredCityBlockPlan'

type Point = number[]
const contains = (triangle: Point[], point: Point) => {
  const cross=triangle.map((v,i)=>{const w=triangle[(i+1)%3];return (w[0]-v[0])*(point[1]-v[1])-(w[1]-v[1])*(point[0]-v[0])})
  return cross.every(n=>n>1e-7)||cross.every(n=>n< -1e-7)
}

for (const spec of CITY_BLOCK.blocks) test(`${spec.id}: overlapping masses have one outer facade and no duplicate glazing at every LOD`, () => {
  const bytes=readFileSync(new URL(`../../public/assets/buildings/city-block-${spec.id}.glb`,import.meta.url))
  const jsonLength=bytes.readUInt32LE(12),g=JSON.parse(bytes.toString('utf8',20,20+jsonLength)),base=28+jsonLength
  const read=(index:number,i:number):number|Point=>{
    const a=g.accessors[index],v=g.bufferViews[a.bufferView],stride=v.byteStride??(a.type==='VEC3'?12:a.componentType===5125?4:2)
    const at=base+(v.byteOffset??0)+(a.byteOffset??0)+i*stride
    return a.type==='VEC3'?[bytes.readFloatLE(at),bytes.readFloatLE(at+4),bytes.readFloatLE(at+8)]:a.componentType===5125?bytes.readUInt32LE(at):bytes.readUInt16LE(at)
  }
  for (const lod of [0,1,2,3]) {
    const mesh=g.meshes[g.nodes.find(n=>n.name===`${spec.id}_lod${lod}`).mesh],triangles:Point[][]=[]
    for(const p of mesh.primitives)for(let i=0;i<g.accessors[p.indices].count;i+=3)triangles.push([0,1,2].map(k=>read(p.attributes.POSITION,read(p.indices,i+k) as number) as Point))
    let checked=0
    for(let i=0;i<spec.volumes.length;i++)for(let j=i+1;j<spec.volumes.length;j++)for(const axis of [0,2])for(const sign of [-1,1]) {
      const a=spec.volumes[i],b=spec.volumes[j],coord=axis===0?'x':'z',size=axis===0?'w':'d',across=axis===0?'z':'x',acrossSize=axis===0?'d':'w',horizontal=axis===0?2:0
      const plane=a[coord]+sign*a[size]/2
      if(Math.abs(plane-b[coord]-sign*b[size]/2)>1e-6)continue
      const low=Math.max(a[across]-a[acrossSize]/2,b[across]-b[acrossSize]/2),high=Math.min(a[across]+a[acrossSize]/2,b[across]+b[acrossSize]/2)
      const bottom=Math.max(a.y-a.h/2,b.y-b.h/2),top=Math.min(a.y+a.h/2,b.y+b.h/2)
      if(high-low<.01||top-bottom<.01)continue
      for(const offset of lod<2?[0,.015]:[0]) {
        const face=triangles.filter(t=>t.every(v=>Math.abs(v[axis]-plane-sign*offset)<1e-4)).map(t=>t.map(v=>[v[horizontal],v[1]]))
        for(const x of [.13,.37,.61,.89])for(const y of [.11,.31,.59,.83]) {
          const point=[low+(high-low)*x,bottom+(top-bottom)*y],count=face.filter(t=>contains(t,point)).length
          expect(count,`LOD${lod} axis${axis} sign${sign} offset${offset} point${point}`).toBeLessThanOrEqual(1)
          if(offset===0&&spec.id==='residential')expect(count).toBe(1)
          checked++
        }
      }
    }
    if(spec.id==='residential')expect(checked).toBeGreaterThan(0)
  }
})
