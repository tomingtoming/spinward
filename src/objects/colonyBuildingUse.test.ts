import {expect,test} from 'bun:test'
import {planCity,type CityBuilding,type RoadKind} from './cityLayout'
import {colonyBuildingUse} from './colonyBuildingUse'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyGroundHeight,colonyShopBays} from './colonyBuildingFrontage'
import {colonyBuildingSpec} from './colonyBuildingPlan'

const fixture:CityBuilding={azimuth:.1,axial:20,width:24,depth:20,height:40,tone:.5,kind:'tower',urban:.9,front:{axis:'axial',side:1}}
test('land use remains mixed, with more retail and offices on main streets than back lanes',()=>{
 const counts=(streetKind:RoadKind)=>{
  const uses=Array.from({length:400},(_,i)=>colonyBuildingUse({...fixture,axial:i*17,streetKind}))
  return {retail:uses.filter(u=>u.ground==='retail').length,office:uses.filter(u=>u.primary==='office').length,residential:uses.filter(u=>u.primary==='apartments'&&u.ground==='residential').length,mixed:uses.filter(u=>u.mixed).length}
 }
 const main=counts('arterial'),back=counts('alley')
 expect(main.retail).toBeGreaterThan(back.retail*2);expect(main.office).toBeGreaterThan(back.office*2)
 expect(main.residential).toBeGreaterThan(10);expect(main.mixed).toBeGreaterThan(10)
 for(const streetKind of ['arterial','local'] as const){
  expect(colonyBuildingUse({...fixture,kind:'house',streetKind}).ground).toBe('residential')
  expect(colonyBuildingUse({...fixture,industrial:true,streetKind}).primary).toBe('industrial')
  expect(colonyBuildingUse({...fixture,height:8,streetKind}).ground).toBe('residential')
 }
})
test('generated land use follows the actual frontage road; shops leave the certified centre entrance clear',()=>{
 const plan=planCity({radius:3200,length:40000,maxBuildings:16000})
 const primary=new Set(),grounds=new Set()
 for(const b of plan.buildings){
  expect(b.streetKind).toBe(plan.roads[b.access!.roadIndex].kind)
  const d=colonyBuildingDesign(b);primary.add(d.use.primary);grounds.add(d.use.ground)
  expect(colonyBuildingUse({...b})).toEqual(d.use)
  if(d.use.primary==='apartments'){expect(d.profile.paneBottom).toBeLessThan(.06);expect(d.profile.paneHeight).toBeGreaterThanOrEqual(.7)}
  const volumes=colonyBuildingSpec(b).volumes
  if(d.use.groundHeight>0)expect(volumes.some(v=>colonyGroundHeight(v,d)>0)).toBe(true)
  for(const v of volumes){
   const ground=colonyGroundHeight(v,d)
   if(!ground)continue
   expect(v.y-v.h/2).toBeLessThan(.01);expect(ground+2).toBeLessThanOrEqual(v.h)
   for(const bay of colonyShopBays(v)){
    expect(Math.abs(bay.x-v.x)-bay.width/2).toBeGreaterThan(1.1)
    expect(Math.abs(bay.x-v.x)+bay.width/2).toBeLessThan(v.w/2)
   }
  }
 }
 expect(primary.size).toBe(5);expect(grounds.size).toBe(4)
})

test('enterable public rooms keep their actual use when the district classification differs',()=>{
 expect(colonyBuildingDesign(fixture,'cafe').use.ground).toBe('retail')
 expect(colonyBuildingDesign(fixture,'passage').use.ground).toBe('lobby')
 expect(colonyBuildingDesign(fixture,'apartment').use.primary).toBe('apartments')
 expect(colonyBuildingDesign(fixture,'apartment').use.ground).toBe('residential')
})
