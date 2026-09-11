import {expect,test} from 'bun:test'
import * as THREE from 'three'
import type {CityBuilding} from './cityLayout'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {prepareColonyGeometry,writeColonyFacade,dirtyColonyFacade} from './colonyBuildingModules'
import {StableInstanceBatch} from './stableInstanceBatch'

const fixture:CityBuilding={azimuth:.1,axial:20,width:24,depth:20,height:40,tone:.5,kind:'tower',urban:.9,front:{axis:'axial',side:1},streetKind:'arterial'}
test('window appearances follow actual uses and remain stable across plan reconstruction',()=>{
 const groups=new Map<string,Set<string>>()
 for(let i=0;i<400;i++){
  const b={...fixture,axial:i*17},d=colonyBuildingDesign(b),w=d.windows
  expect(colonyBuildingDesign({...b}).windows).toEqual(w)
  expect(w.occupied).toBeGreaterThan(0);expect(w.occupied).toBeLessThan(1)
  const appearances=groups.get(d.use.primary)??new Set();appearances.add(JSON.stringify(w));groups.set(d.use.primary,appearances)
 }
 for(const use of ['apartments','office','commercial'])expect(groups.get(use)!.size).toBeGreaterThan(10)
 expect(colonyBuildingDesign(fixture,'apartment').windows.kind).toBe(0)
})
test('instance removal keeps glazing, occupancy and upper-floor phase attached to the surviving building',()=>{
 const source=new THREE.BoxGeometry(),geometry=prepareColonyGeometry(source,3)
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),3),batch=new StableInstanceBatch(mesh)
 const slots=Array.from({length:3},()=>({index:-1})),designs=slots.map((_,i)=>colonyBuildingDesign({...fixture,axial:i*17}))
 for(let i=0;i<3;i++)batch.add(slots[i],index=>{mesh.setMatrixAt(index,new THREE.Matrix4());writeColonyFacade(mesh,index,designs[i],4.2,i*20,[i,i+2,i+1,i+5])})
 const windows=geometry.getAttribute('aColonyWindows') as THREE.InstancedBufferAttribute
 const surviving=Array.from(windows.array.slice(8,12))
 const balconies=geometry.getAttribute('aColonyBalcony') as THREE.InstancedBufferAttribute
 const survivingBalcony=Array.from(balconies.array.slice(8,12))
 expect(surviving[3]).toBeGreaterThan(windows.getW(0))
 batch.remove(slots[0]);batch.flush()
 expect(slots[2].index).toBe(0);expect(Array.from(windows.array.slice(0,4))).toEqual(surviving)
 expect(Array.from(balconies.array.slice(0,4))).toEqual(survivingBalcony)
 const version=windows.version;dirtyColonyFacade(mesh);expect(windows.version).toBe(version+1)
 mesh.dispose();geometry.dispose();source.dispose();(mesh.material as THREE.Material).dispose()
})
test('offices include waist-height and full-height glazing while residential buildings default to waist windows',()=>{
 const office=new Set<string>();let apartments=0
 for(let i=0;i<400;i++){
  const d=colonyBuildingDesign({...fixture,axial:i*17}),p=d.profile
  if(d.use.primary==='office')office.add(p.paneBottom<.1?'full':'waist')
  if(d.use.primary==='apartments'){apartments++;expect(p.paneBottom).toBeGreaterThanOrEqual(.3);expect(p.paneHeight).toBeLessThan(.5)}
 }
 expect(office).toEqual(new Set(['waist','full']));expect(apartments).toBeGreaterThan(20)
 for(let i=0;i<30;i++){const d=colonyBuildingDesign({...fixture,kind:'house',height:6,urban:0,axial:i*17});expect(d.use.primary).toBe('house');expect(d.profile.paneBottom).toBeGreaterThanOrEqual(.3);expect(d.profile.paneHeight).toBeLessThan(.5)}
})
