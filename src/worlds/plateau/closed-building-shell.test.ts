import {test,expect} from 'bun:test'
import * as T from 'three'
import {closedBuildingShells,outsideShellBounds,MAX_SHELL_TRIANGLES} from './closed-building-shell.js'
import {prepareTile} from './tile-processing.js'
import {patchBuildingShellCulling,shellFaceCulling} from './building-shell-culling.js'
import {surfacePoint} from './surface-frame.js'

const cube=()=>({position:new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0,-1,-1,2,1,-1,2,1,1,2,-1,1,2]),
  index:new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])})
test('certification rejects open, inward, inconsistent and non-manifold shells',()=>{
  const good=cube();expect([...closedBuildingShells(good)!.mask]).toEqual(Array(8).fill(1))
  expect(closedBuildingShells({...good,index:good.index.slice(3)})).toBeNull()
  const inward=good.index.slice();for(let i=0;i<inward.length;i+=3)[inward[i],inward[i+1]]=[inward[i+1],inward[i]]
  expect(closedBuildingShells({...good,index:inward})).toBeNull()
  const wrong=good.index.slice();[wrong[0],wrong[1]]=[wrong[1],wrong[0]]
  expect(closedBuildingShells({...good,index:wrong})).toBeNull()
  expect(closedBuildingShells({...good,index:new Uint32Array([...good.index,...good.index.slice(0,3)])})).toBeNull()
  expect(closedBuildingShells({...good,index:new Uint32Array((MAX_SHELL_TRIANGLES+1)*3)})).toBeNull()
})
test('an open neighbour retains all of its faces beside a certified solid',()=>{
  const c=cube(),p=new Float32Array([...c.position,10,0,0,10,1,0,10,1,2])
  const result=closedBuildingShells({position:p,index:new Uint32Array([...c.index,8,9,10])})!
  expect([...result.mask]).toEqual([...Array(8).fill(1),0,0,0])
  expect(outsideShellBounds(result.bounds,0,0,1)).toBe(false)
  expect(outsideShellBounds(result.bounds,1.04,0,1)).toBe(false)
  expect(outsideShellBounds(result.bounds,2,0,1)).toBe(true)
})
test('worker refinement preserves scalar flags without modifying the native source',()=>{
  const a=cube();for(let i=0;i<a.position.length;i+=3)a.position[i]*=40
  const original=a.position.slice(),sample={band:1,anchor:{local:[0,0]}}
  const prepared=prepareTile([{name:'buildings',attributes:a,segments:[{tile:'0-0',first:0,count:a.index.length}]}],3200,sample)
  const data=prepared[0]
  expect(a.position).toEqual(original);expect(Object.keys(a)).toEqual(['position','index'])
  expect(data.attributes.closedShell.length).toBe(data.attributes.position.length/3)
  expect([...data.attributes.closedShell].every(v=>v===1)).toBe(true)
  expect(data.attributes.index.length).toBeGreaterThan(a.index.length)
  expect(data.segments![0].count).toBe(data.attributes.index.length)
})
test('both eye positions and flat/colony placement preserve interior faces and shader hooks',()=>{
  const material=new T.MeshStandardMaterial({side:T.DoubleSide}),mesh=new T.Mesh(new T.BoxGeometry(),material)
  const sample={band:2,anchor:{local:[120,340]}},base={mode:'colony',study:{radius:3200},sample}
  const data={attributes:{closedShell:new Uint8Array(8).fill(1)},shellBounds:new Float32Array([-1,-1,0,1,1,2])}
  material.onBeforeCompile=(s:any)=>{s.uniforms.coverage={value:1};s.fragmentShader+='\n// previous hook'}
  patchBuildingShellCulling(mesh,data,base)
  const shader:any={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <clipping_planes_fragment>\n#include <normal_fragment_begin>\n#include <emissivemap_fragment>\n#include <lights_physical_fragment>'}
  material.onBeforeCompile(shader,{} as any)
  expect(shader.uniforms.coverage.value).toBe(1);expect(shader.fragmentShader).toContain('previous hook')
  // Flat shading and night texture derivatives must run before rejecting
  // helper pixels; otherwise a distance boundary can change visible normals.
  expect(shader.fragmentShader.indexOf('discard')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <emissivemap_fragment>'))
  expect(material.side).toBe(T.DoubleSide) // patch does not alter the original side
  for(const mode of ['flat','colony']){
    base.mode=mode
    for(const [x,expected] of [[2,1],[.99,0],[1.1,0],[1.5,1],[0,0]]){
      const camera=new T.PerspectiveCamera();camera.position.set(...surfacePoint(3200,sample,mode,x,0,1) as [number,number,number]);camera.updateMatrixWorld()
      mesh.onBeforeRender({} as any,{} as any,camera,mesh.geometry,material,null as any)
      expect(shader.uniforms.metroExteriorEye.value).toBe(expected)
    }
  }
})
test('fully certified meshes cull back faces per draw only from outside, then restore the side',()=>{
  const sample={band:0,anchor:{local:[0,0]}},base={mode:'flat',study:{radius:3200},sample}
  const draw=(mesh:T.Mesh,x:number)=>{
    const material=mesh.material as T.Material,camera=new T.PerspectiveCamera()
    camera.position.set(...surfacePoint(3200,sample,'flat',x,0,1) as [number,number,number]);camera.updateMatrixWorld()
    mesh.onBeforeRender({} as any,{} as any,camera,mesh.geometry,material,null as any)
    material.onBeforeRender({} as any,{} as any,camera,mesh.geometry,mesh,null as any)
    const side=material.side
    mesh.onAfterRender({} as any,{} as any,camera,mesh.geometry,material,null as any)
    return side
  }
  const make=(mask:number[])=>{
    const material=new T.MeshStandardMaterial({side:T.DoubleSide}),mesh=new T.Mesh(new T.BoxGeometry(),material)
    patchBuildingShellCulling(mesh,{attributes:{closedShell:Uint8Array.from(mask)},shellBounds:new Float32Array([-1,-1,0,1,1,2])},base)
    return mesh
  }
  const closed=make(Array(8).fill(1)),material=closed.material as T.MeshStandardMaterial
  expect(material.shadowSide).toBe(T.DoubleSide)
  expect(draw(closed,2)).toBe(T.FrontSide)
  expect(material.side).toBe(T.DoubleSide)
  expect(draw(closed,0)).toBe(T.DoubleSide) // eye inside a shell
  expect(draw(closed,1.01)).toBe(T.DoubleSide) // near plane reaches the wall
  shellFaceCulling.enabled=false
  try{expect(draw(closed,2)).toBe(T.DoubleSide)}finally{shellFaceCulling.enabled=true}
  // One uncertified component keeps the whole draw two-sided.
  expect(draw(make([1,1,1,1,1,1,1,0]),2)).toBe(T.DoubleSide)
  // A program compiled during a front-only draw still flips back-face normals.
  const shader:any={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <lights_physical_fragment>'}
  material.onBeforeCompile(shader,{} as any)
  expect(shader.fragmentShader).toContain('#ifndef DOUBLE_SIDED\n#define DOUBLE_SIDED')
})
