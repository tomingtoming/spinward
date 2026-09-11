import {test,expect} from 'bun:test'
import {colonyBalconies,BALCONY_SECTION_LIMIT} from './colonyBalconies'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBuildingSpec,colonyWindowGrid} from './colonyBuildingPlan'
import {colonyGroundHeight} from './colonyBuildingFrontage'
import {planCity,type CityBuilding} from './cityLayout'
import type {BlockSpec} from './authoredCityBlockPlan'

const b:CityBuilding={azimuth:.1,axial:20,width:24,depth:20,height:40,tone:.5,kind:'block',front:{axis:'axial',side:1},streetKind:'local'}
test('balconies reject non-residential/public facades and retain exposed bays around wings',()=>{
 const design=colonyBuildingDesign(b);design.use.primary='apartments';design.use.groundHeight=0
 design.profile={bay:3,storey:3.2,paneWidth:.64,paneHeight:.74,paneBottom:.04}
 const wall={x:0,y:6.4,z:0,w:18,h:12.8,d:4},wing={x:-6,y:6.4,z:5,w:6,h:12.8,d:6}
 const spec:BlockSpec={building:b,id:'test',wall:'ffffff',roof:'777777',volumes:[wall,wing]}
 const p=colonyBalconies(spec,design),rear=p.sections.filter(s=>s.volume===wall)
 expect(rear.length).toBeGreaterThan(0)
 for(const s of rear){expect(s.x-s.width/2).toBeGreaterThanOrEqual(-3);expect(s.y).toBeGreaterThanOrEqual(3.4)}
 expect(colonyBalconies({...spec,id:'public-apartment'},design).sections).toHaveLength(0)
 for(const primary of ['office','commercial','house','industrial'] as const)
  expect(colonyBalconies(spec,{...design,use:{...design.use,primary}}).sections).toHaveLength(0)
 // At an upper setback's base, a balcony must not be sunk into the podium roof.
 const podium={x:0,y:4,z:0,w:24,h:8,d:20},upper={x:0,y:14.4,z:0,w:18,h:12.8,d:12}
 for(const s of colonyBalconies({...spec,volumes:[podium,upper]},design).sections.filter(s=>s.volume===upper))expect(s.y-.12).toBeGreaterThan(8)
})

test('generated balconies align with upper windows, avoid masses and retain bounded deterministic styles',()=>{
 const styles=new Set<string>();let sections=0,mixed=0
 for(const radius of [250,3200]){
  const city=planCity({radius,length:radius===3200?40000:2000,maxBuildings:16000})
  for(const building of city.buildings){
   const design=colonyBuildingDesign(building)
   if(design.use.primary!=='apartments')continue
   const spec=colonyBuildingSpec(building),plan=colonyBalconies(spec,design)
   expect(plan.sections.length).toBeLessThanOrEqual(BALCONY_SECTION_LIMIT)
   expect(plan.dividers.length).toBeLessThanOrEqual(BALCONY_SECTION_LIMIT)
   if(!plan.sections.length)continue
   styles.add(plan.style);if(design.use.mixed)mixed++
   for(const s of plan.sections){
    sections++
    const v=s.volume,ground=colonyGroundHeight(v,design),grid=colonyWindowGrid({...v,h:v.h-ground},design.profile)
    expect(s.y).toBeCloseTo(v.y-v.h/2+ground+s.row*(v.h-ground)/grid.floors,8)
    expect(s.x).toBeCloseTo(v.x+((s.first+s.last+1)/2)*v.w/grid.columnsX-v.w/2,8)
    expect(s.width).toBeCloseTo((s.last-s.first+1)*v.w/grid.columnsX-.16,8)
    expect(s.z).toBeCloseTo(v.z+v.d/2-.04,8)
    expect(s.y).toBeGreaterThanOrEqual(3.4)
    expect(s.y+1.08).toBeLessThan(v.y+v.h/2)
    expect(s.width).toBeGreaterThan(1)
    expect(spec.volumes.some(o=>o!==v&&s.x+s.width/2>o.x-o.w/2+.001&&s.x-s.width/2<o.x+o.w/2-.001&&s.z+s.depth>o.z-o.d/2+.001&&s.z<o.z+o.d/2-.001&&s.y+1.08>o.y-o.h/2+.001&&s.y-.12<o.y+o.h/2-.001)).toBe(false)
   }
   for(const divider of plan.dividers){
    const owner=plan.sections.find(s=>Math.abs(divider.y-s.y-.65)<1e-8&&Math.abs(divider.z-s.z-s.depth*.48)<1e-8&&Math.abs(divider.x-s.x)<s.width/2)
    expect(owner).toBeDefined()
    const cell=(divider.x-owner!.volume.x+owner!.volume.w/2)/owner!.pitch
    expect(cell).toBeCloseTo(Math.round(cell),8)
   }
   if(sections<1000)expect(colonyBalconies(spec,design)).toEqual(plan)
  }
 }
 expect(styles.size).toBe(2);expect(sections).toBeGreaterThan(1000);expect(mixed).toBeGreaterThan(10)
})
