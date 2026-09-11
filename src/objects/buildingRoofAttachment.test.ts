import {test,expect} from 'bun:test'
import * as THREE from 'three'
import {buildingRoofAttachment} from './buildingRoofAttachment'
import {CITY_BLOCK_PLACEMENTS} from './authoredCityBlockPlan'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {planCity} from './cityLayout'

test('beacon bases sit on an actual top roof across all four front directions',()=>{
 const plan=planCity({radius:3200,length:40000,maxBuildings:16000})
 const specs=[...CITY_BLOCK_PLACEMENTS,...plan.buildings.map(b=>colonyBuildingSpec(b))]
 for(const spec of specs){
  const inset=CITY_BLOCK_PLACEMENTS.includes(spec)?.32:0,p=buildingRoofAttachment(spec,3200,inset),b=spec.building,a=b.azimuth,side=b.front!.side,tangent=b.front!.axis==='tangent'
  const x=tangent?new THREE.Vector3(0,side,0):new THREE.Vector3(side*Math.sin(a),0,-side*Math.cos(a)),z=tangent?new THREE.Vector3(-side*Math.sin(a),0,side*Math.cos(a)):new THREE.Vector3(0,side,0)
  const frame=new THREE.Matrix4().makeBasis(x,new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)),z).setPosition(Math.cos(a)*3200,b.axial,Math.sin(a)*3200)
  const local=new THREE.Vector3(p.x,p.y,p.z).applyMatrix4(frame.invert())
  expect(spec.volumes.some(v=>Math.abs(local.x-v.x)<v.w/2&&Math.abs(local.z-v.z)<v.d/2&&Math.abs(local.y-(v.y+v.h/2-inset))<1e-6)).toBe(true)
 }
 const reduced=CITY_BLOCK_PLACEMENTS.find(s=>s.building.height>60)!
 expect(buildingRoofAttachment(reduced,3200,.32).height).toBeLessThan(reduced.building.height-10)
})
test('adjacent buildings vary in paint and window grammar without varying per frame',()=>{
 const blocks=planCity({radius:3200,length:40000,maxBuildings:64000}).buildings.filter(b=>Math.abs(b.azimuth-.05)*3200<900&&Math.abs(b.axial)<900)
 const paints=new Set(),grids=new Set()
 for(const b of blocks){const d=colonyBuildingDesign(b);expect(colonyBuildingDesign({...b})).toEqual(d);paints.add(d.wall);grids.add(JSON.stringify(d.profile));expect(d.profile.paneBottom+d.profile.paneHeight).toBeLessThan(1);expect(d.profile.bay).toBeGreaterThan(1)}
 expect(paints.size).toBeGreaterThanOrEqual(6);expect(grids.size).toBeGreaterThan(30)
})
