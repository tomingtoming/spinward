import {test,expect} from 'bun:test'
import {composeBuildingFacades,buildingDesign} from './facade-design.js'
import {FacadeInstances} from './facade-instances.js'

function station(kind='hall',clearance=1.12){return {id:'omiya',usage:'運輸倉庫施設',seed:3,
  station:{source:'N02 + PLATEAU transport footprint',name:'大宮',kind,signIndex:12},
  walls:[{a:[0,0],b:[180,0],normal:[0,-1],length:180,base:12,top:48,ground:[12,12,12],roadDistance:3,projectionClearance:clearance}]}}

test('transport use alone never means station; unrelated office keeps its family',()=>{
  const row=station();expect(buildingDesign(row).family).toBe('station')
  expect(buildingDesign({...row,station:null}).family).toBe('utility')
  expect(buildingDesign({...row,usage:'業務施設'}).family).toBe('office')
})
test('large stations have hall glazing and clerestories, never dwelling detail',()=>{
  const row=station(),{parts}=composeBuildingFacades([row],{life:true})
  expect(parts.some(p=>p.purpose==='station-hall-glazing')).toBe(true)
  expect(parts.some(p=>p.purpose==='station-clerestory')).toBe(true)
  expect(parts.some(p=>p.purpose==='station-name'&&p.surface===-13)).toBe(true)
  expect(parts.some(p=>['balcony','entry','window'].includes(p.kind))).toBe(false)
  for(const p of parts){
    expect(p.origin[0]-p.width/2).toBeGreaterThanOrEqual(0)
    expect(p.origin[0]+p.width/2).toBeLessThanOrEqual(180)
    expect(p.width).toBeLessThanOrEqual(8)
    expect(p.kind==='strip'?p.origin[2]+p.height/2:p.origin[2]+p.height).toBeLessThanOrEqual(48)
  }
  expect(parts.length).toBeLessThan(220)
})
test('platform has an upper light band; road-adjacent facade cannot grow a canopy',()=>{
  const row=station('platform',0),{parts}=composeBuildingFacades([row],{life:true})
  expect(parts.some(p=>p.purpose==='station-clerestory')).toBe(true)
  expect(parts.some(p=>p.purpose==='station-hall-glazing')).toBe(false)
  expect(parts.some(p=>p.purpose==='station-canopy')).toBe(false)
  expect(composeBuildingFacades([station()]).parts.some(p=>p.purpose==='station-canopy')).toBe(true)
})
test('three colony bands share one station atlas with independent disposal',()=>{
  const kit={version:3,parts:{},stationSigns:['大宮','さいたま新都心']},study={radius:3200},sample={band:0,anchor:{local:[0,0]}}
  const a=new FacadeInstances(kit,[],study,sample),b=new FacadeInstances(kit,[],study,sample)
  expect(a.signs).toBe(b.signs)
  let disposed=0;a.signs.addEventListener('dispose',()=>disposed++)
  a.dispose();expect(disposed).toBe(0)
  b.dispose();expect(disposed).toBe(1)
  b.disposeMaterials();expect(disposed).toBe(1)
  const c=new FacadeInstances(kit,[],study,sample);expect(c.signs).not.toBe(a.signs);c.dispose()
})
