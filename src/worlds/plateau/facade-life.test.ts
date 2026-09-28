import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {buildingDesign,composeBuildingFacades,facadeRoomLight} from './facade-design.js'
import {facadeContactBoxes,FacadeContacts} from './facade-contacts.js'
import {buildCityCollisionIndex,getCityGroundHeight} from '../../objects/cityLayout'
import {metroSurfaceLocation} from '../metroPlacement'

function apartment(clearance=1.12){
  let id=''
  for(let i=0;i<100;i++)if(buildingDesign({id:'life-'+i,usage:'共同住宅',seed:1}).style==='french-guards'){id='life-'+i;break}
  return {id,usage:'共同住宅',seed:1,walls:[{a:[0,0],b:[18,0],length:18,normal:[0,-1],base:0,top:24,ground:[0,0,0],floors:8,roadDistance:3,projectionClearance:clearance}]}
}

test('deep balconies need certified clearance and leave the ground storey open',()=>{
  const row=apartment(),on=composeBuildingFacades([row],{life:true}),off=composeBuildingFacades([apartment(0)],{life:true})
  const balconies=on.parts.filter(p=>p.kind==='balcony')
  expect(balconies.length).toBeGreaterThan(0);expect(off.parts.some(p=>p.kind==='balcony')).toBe(false)
  for(const p of balconies){expect(p.floor).toBeGreaterThan(0);expect(p.origin[2]).toBeGreaterThan(2.7);expect(p.width).toBeLessThanOrEqual(3.8)}
  expect(off.parts.some(p=>p.kind==='guard')).toBe(true)
  expect(composeBuildingFacades([row]).parts.some(p=>p.kind==='balcony')).toBe(false)
})

test('room lights are stable households; office glass has one daylight colour',()=>{
  const home=Array.from({length:30},(_,i)=>facadeRoomLight('a',2,i,'apartments'))
  expect(new Set(home.map(l=>l.colour)).size).toBe(3)
  expect(home.some(l=>l.strength===0)).toBe(true);expect(home.some(l=>l.strength>0)).toBe(true)
  for(let i=0;i<30;i++)expect(home[i]).toEqual(facadeRoomLight('a',2,i,'apartments'))
  const offices=Array.from({length:8},(_,f)=>Array.from({length:5},(_,b)=>facadeRoomLight('office',f,b,'office')))
  expect(new Set(offices.flat().map(l=>l.colour))).toEqual(new Set(['#dceaff']))
  for(const floor of offices)expect(floor.every(l=>JSON.stringify(l)===JSON.stringify(floor[0]))).toBe(true)
})

test('ground storefront signs and canopies require shop use and free space',()=>{
  const home=composeBuildingFacades([apartment()],{life:true})
  expect(home.parts.some(p=>p.purpose==='shop-sign')).toBe(false)
  const row=apartment();row.usage='店舗等併用共同住宅'
  const shop=composeBuildingFacades([row],{life:true})
  expect(shop.parts.some(p=>p.purpose==='shop-sign')).toBe(true)
  expect(shop.parts.some(p=>p.purpose==='shop-awning')).toBe(true)
  row.walls[0].projectionClearance=0
  expect(composeBuildingFacades([row],{life:true}).parts.some(p=>p.purpose==='shop-awning')).toBe(false)
})

test('shared entries retain narrow surrounds and a source-certified level apron',()=>{
  const row:any=apartment();row.walls[0].entryAccess={start:[9,-.055],end:[9,-3],ground:0}
  const parts=composeBuildingFacades([row],{life:true}).parts
  expect(parts.filter(p=>p.purpose==='entrance-surround').length).toBe(2)
  expect(parts.some(p=>p.purpose==='intercom')).toBe(true)
  const apron=parts.find(p=>p.purpose==='entry-apron')!
  expect(apron.origin.slice(0,2)).toEqual([9,-.055]);expect(apron.depth).toBeCloseTo(2.945)
  expect(apron.nearOnly).toBe(true);expect(parts.find(p=>p.purpose==='entrance')!.origin[2]).toBeCloseTo(.065)
  expect(apron.origin[2]+apron.height/2).toBeGreaterThan(.016) // source surface finish
  expect(apron.origin[2]-apron.height/2).toBeLessThan(-.04) // embed in lowest permitted terrain
  delete row.walls[0].entryAccess
  expect(composeBuildingFacades([row],{life:true}).parts.some(p=>p.purpose==='entry-apron')).toBe(false)
})

if(process.env.SPINWARD_FACADE_KIT)test('Blender balcony contact boxes support feet, leave an open cavity, and unload',()=>{
  const kit=JSON.parse(readFileSync(process.env.SPINWARD_FACADE_KIT!,'utf8'));if(kit.version<3)return
  const design=composeBuildingFacades([apartment()],{life:true}),balcony=design.parts.find(p=>p.kind==='balcony')!
  const contacts=facadeContactBoxes([balcony],kit,2,3200)
  expect(contacts.length).toBe(4)
  const index=buildCityCollisionIndex(contacts as any,3200,40000)
  const inside=metroSurfaceLocation(2,balcony.origin[0],-.45,3200),outside=metroSurfaceLocation(2,balcony.origin[0],-1.3,3200)
  expect(getCityGroundHeight(index,3200,inside.azimuth,inside.axial,balcony.origin[2],.25)).toBeCloseTo(balcony.origin[2],5)
  expect(getCityGroundHeight(index,3200,outside.azimuth,outside.axial,balcony.origin[2],.25)).toBe(0)
  // Native street orientation and all three cylindrical bands must preserve
  // the same floor surface, rather than rotating the contacts independently.
  for(const band of [0,1,2])for(const yaw of [.0,.8,1.6]){
    const rotated={...balcony,origin:[500,120,balcony.origin[2]],u:[Math.cos(yaw),Math.sin(yaw)]}
    const boxes=facadeContactBoxes([rotated],kit,band,3200)
    const rotatedIndex=buildCityCollisionIndex(boxes as any,3200,40000)
    const point=metroSurfaceLocation(band,500+.45*Math.sin(yaw),120-.45*Math.cos(yaw),3200)
    expect(getCityGroundHeight(rotatedIndex,3200,point.azimuth,point.axial,balcony.origin[2],.25)).toBeCloseTo(balcony.origin[2],5)
  }
  const f:any={revision:1,sample:{band:2},kit,sites:new Map([['s',design]])},layer:any={facade:f,stream:{entries:new Map([['s',{site:{id:'s'},status:'resident'}]])}}
  const selected=new FacadeContacts(3200),focus={...inside,altitude:balcony.origin[2]}
  expect(selected.update([layer],focus)).toBe(true);const stable=selected.parts
  expect(selected.stats.active).toBeLessThanOrEqual(512);expect(selected.stats.truncated).toBe(0)
  expect(selected.update([layer],focus)).toBe(false);expect(selected.parts).toBe(stable)
  layer.stream.entries.get('s').status='unloaded';f.revision++
  expect(selected.update([layer],focus)).toBe(true);expect(selected.parts.length).toBe(0)
})
