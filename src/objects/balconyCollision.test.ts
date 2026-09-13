import {expect,test} from 'bun:test'
import {balconySectionColliders} from './balconyCollision'
import {CityCollisionOverlay} from './cityCollisionOverlay'
import {buildCityCollisionIndex,collectCityBuildingsInWindow,getCityGroundHeight,type CityBuilding} from './cityLayout'
import type {BlockSpec} from './authoredCityBlockPlan'
const r=3200,b:CityBuilding={azimuth:Math.PI*2-.001,axial:0,width:12,depth:8,height:15,kind:'block',tone:.5,front:{axis:'axial',side:-1}}
const v={x:0,y:7.5,z:0,w:12,h:15,d:8},spec:BlockSpec={building:b,id:'contact-test',wall:'fff',roof:'fff',volumes:[v]}
const section={volume:v,row:1,first:0,last:0,pitch:3,x:0,y:6.4,z:4,width:2.8,depth:1.05}
test('balcony slabs have no tall solid envelope; four exact-margin boxes bound the open air',()=>{
 for(const style of ['rail','solid']as const){
  const boxes=balconySectionColliders(spec,section,style,r);expect(boxes).toHaveLength(4)
  expect(boxes.every(b=>b.collisionMargin===0&&b.groundMargin===0)).toBe(true)
  const index=buildCityCollisionIndex(boxes,r,1000),ax=-4-.48*1.05
  expect(getCityGroundHeight(index,r,b.azimuth,ax,6.4,.2)).toBeCloseTo(6.4)
  expect(getCityGroundHeight(index,r,b.azimuth,ax,1,.2)).toBe(0)
  expect(getCityGroundHeight(index,r,b.azimuth,ax-2,6.4,.2)).toBe(0)
 }
})
test('streaming replaces only affected buckets and is shared with the existing Rapier window',()=>{
 const base=buildCityCollisionIndex([b],r,1000),overlay=new CityCollisionOverlay(base,1000),published=overlay.index
 const boxes=balconySectionColliders(spec,section,'rail',r)
 overlay.set(boxes);expect(overlay.index).toBe(published)
 const found=new Set<CityBuilding>();collectCityBuildingsInWindow(published,-.001,0,1,found)
 expect([...found]).toContain(b);for(const box of boxes)expect([...found]).toContain(box)
 overlay.set([]);collectCityBuildingsInWindow(published,-.001,0,1,found)
 expect([...found]).toEqual([b]);expect([...base.cells]).toEqual([...published.cells])
})

test('permanent parking pads survive balcony changes and can be replaced on rebuild',()=>{
 const base=buildCityCollisionIndex([],r,1000),overlay=new CityCollisionOverlay(base,1000),boxes=balconySectionColliders(spec,section,'rail',r)
 overlay.setPermanent([b]);overlay.set(boxes);overlay.set([])
 const found=new Set<CityBuilding>();collectCityBuildingsInWindow(overlay.index,b.azimuth,0,1,found);expect([...found]).toEqual([b])
 overlay.setPermanent([]);collectCityBuildingsInWindow(overlay.index,b.azimuth,0,1,found);expect(found.size).toBe(0)
})
