import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {readFileSync} from 'node:fs'

import { getSpaceportDimensions, getSpaceportEnvelopeRadius, Spaceport, planDockingBerths, getDockingPortSize } from './spaceport'

test('docked hulls meet the berth seals without entering the port blocks at any habitat size',()=>{
 for(const [radius,length]of [[18,120],[3200,40000],[30000,2000]]){
  const port=new Spaceport({radius,length}),dims=getSpaceportDimensions(radius,length),berths=planDockingBerths(dims),size=getDockingPortSize(dims)
  try{
   const ships=port.group.getObjectByName('spaceport-docked-ships') as THREE.Mesh
   const positions=ships.geometry.getAttribute('position')
   for(const b of berths.filter(b=>b.occupied)){
    let front=Infinity,rear=-Infinity,found=0
    for(let i=0;i<positions.count;i++){
     if(Math.hypot(positions.getX(i)-b.x,positions.getZ(i)-b.z)>3)continue
     const outward=(positions.getY(i)-b.y)*b.endSign
     front=Math.min(front,outward);rear=Math.max(rear,outward);found++
     expect(positions.getY(i)).toBeLessThan(-length/2)
    }
    expect(found).toBeGreaterThan(100)
    expect(front).toBeCloseTo(2.4,2);expect(rear-front).toBeCloseTo(18.36,2)
    expect(size.width).toBeGreaterThanOrEqual(3.3)
   }
   const structure=port.group.getObjectByName('spaceport-structure')!,lights=port.group.getObjectByName('spaceport-navigation-lamps') as THREE.InstancedMesh
   port.group.updateMatrixWorld(true)
   for(let i=0;i<lights.count;i++){
    const m=new THREE.Matrix4();lights.getMatrixAt(i,m)
    const position=new THREE.Vector3().setFromMatrixPosition(m)
    const hits=new THREE.Raycaster(position,new THREE.Vector3(0,1,0),0,.25).intersectObject(structure)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].distance).toBeLessThan(.241)
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(.24,6)
   }
   const opposite=planDockingBerths({...dims,hubCenterY:-dims.hubCenterY})
   for(let i=0;i<4;i++){expect(opposite[i].y).toBe(-berths[i].y);expect(opposite[i].shipY).toBe(-berths[i].shipY)}
  }finally{port.dispose()}
 }
})

test('both Blender collar LODs preserve the mounting face and shuttle interface in native metres',()=>{
 const bytes=readFileSync(new URL('../../public/assets/docking-collar.glb',import.meta.url))
 expect(bytes.length).toBeLessThan(100000)
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString())
 expect(gltf.scenes).toHaveLength(1);expect(gltf.meshes).toHaveLength(2)
 for(const lod of [0,1]){
  const node=gltf.nodes.find((n:{name:string})=>n.name===`docking_collar_lod${lod}`),primitive=gltf.meshes[node.mesh].primitives[0]
  const pos=gltf.accessors[primitive.attributes.POSITION]
  expect(pos.min[2]).toBeCloseTo(0,6);expect(pos.max[2]).toBeCloseTo(2.4,6)
  expect(pos.max[0]-pos.min[0]).toBeCloseTo(3.3,5)
  expect(primitive.attributes.COLOR_0).toBeDefined()
  expect(gltf.accessors[primitive.indices].count/3).toBeLessThanOrEqual(lod===0?720:390)
 }
})

describe('getSpaceportDimensions', () => {
  test('rebuilding the port releases per-instance resources as well as geometry', () => {
    const port = new Spaceport({ radius: 3200, length: 40000 })
    let instances = 0, geometries = 0, materialDisposals = 0
    port.group.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh)) return
      object.addEventListener('dispose', () => instances++)
      object.geometry.addEventListener('dispose', () => geometries++)
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.addEventListener('dispose', () => materialDisposals++)
    })
    port.setDimensions({ radius: 18, length: 120 })
    expect(instances).toBe(1)
    expect(geometries).toBe(1)
    expect(materialDisposals).toBe(0)
    port.dispose()
    expect(materialDisposals).toBe(1)
  })

  test('the exterior envelope contains authored port meshes and the moving shuttle', () => {
    for (const [radius, length] of [[18, 120], [3200, 40000], [30000, 2000]]) {
      const port = new Spaceport({ radius, length })
      const envelope = getSpaceportEnvelopeRadius(radius, length)
      try {
        for (const dt of [0, 20, 30, 24, 2]) {
          port.update(dt); port.group.updateMatrixWorld(true)
          port.group.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return
            object.geometry.computeBoundingBox()
            const bounds = object.geometry.boundingBox!
            for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
              expect(object.localToWorld(new THREE.Vector3(x, y, z)).length()).toBeLessThan(envelope)
            }
          })
        }
      } finally { port.dispose() }
    }
  })

  test('small habitats get a compact hub at the mirror-hinge (-Y) end', () => {
    const dims = getSpaceportDimensions(18, 120)
    expect(dims.hubCenterY).toBeCloseTo(-60, 6)
    expect(dims.hubRadius).toBeCloseTo(2.5, 6)
    expect(dims.hubLength).toBeCloseTo(20, 6)
    expect(dims.armLength).toBeCloseTo(8, 6)
  })

  test('giant habitats clamp the structure to sane absolute sizes', () => {
    const izma = getSpaceportDimensions(3200, 40000)
    expect(izma.hubRadius).toBeCloseTo(96, 6)
    expect(izma.hubLength).toBeCloseTo(600, 6)
    expect(izma.armLength).toBeCloseTo(360, 6)
    expect(izma.approachSpan).toBeCloseTo(3000, 6)

    const elysium = getSpaceportDimensions(30000, 2000)
    expect(elysium.hubRadius).toBeCloseTo(120, 6)
    expect(elysium.hubLength).toBeCloseTo(80, 6)
    expect(elysium.armLength).toBeCloseTo(360, 6)
  })

  test('hub structure stays clear of the habitat interior except the mouth', () => {
    // The hub straddles the -Y end plane: half inside (arrival bay), half out.
    const dims = getSpaceportDimensions(3200, 40000)
    expect(dims.hubCenterY + dims.hubLength * 0.5).toBeGreaterThan(-20000)
    expect(dims.hubCenterY - dims.hubLength * 0.5).toBeLessThan(-20000)
  })
})
