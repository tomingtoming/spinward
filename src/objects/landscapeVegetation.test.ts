import {test,expect} from 'bun:test'
import {planCity} from './cityLayout'
import {selectLandscapeTrees,createLandscapeCrown} from './landscapeVegetation'
import {createHash} from 'node:crypto'
test('tree budget reaches all three land strips without moving established lots',()=>{
 const p=planCity({radius:3200,length:40000,maxBuildings:64000})
 expect(p.trees).toHaveLength(1500)
 for(let strip=0;strip<3;strip++)expect(p.trees.filter(t=>Math.round(t.azimuth/(Math.PI*2/3))===strip).length).toBeGreaterThan(350)
 // Snapshot taken before the vegetation pass: changes to the planner's random
 // stream must not silently move doors, roads or the authored cafe/lobby lots.
 // Road-use metadata is derived after certification; keep comparing the original lot geometry.
 // Transcendental math can differ in its last bits between JS runtimes/CPUs.
 // Nine decimal places retain sub-millimetre positions (including azimuth
 // at this radius), without treating those rounding differences as moved lots.
 const snapshot=JSON.stringify([p.buildings.map(({streetKind,...lot})=>lot),p.roads,p.patches],
  (_,value)=>typeof value==='number'?Number(value.toFixed(9)):value)
 expect(createHash('sha256').update(snapshot).digest('hex')).toBe('c1cd8b870a7d7e6bc98958441702734bd71d259eb546bbc9338aac789dd1123b')
})
test('position-ranked vegetation sampling is independent of traversal order',()=>{
 const trees=Array.from({length:100},(_,i)=>({azimuth:i*.1,axial:i*30,height:6,tone:i/100}))
 const before=JSON.stringify(trees)
 expect(selectLandscapeTrees(trees,12)).toEqual(selectLandscapeTrees([...trees].reverse(),12))
 expect(JSON.stringify(trees)).toBe(before)
})
test('new crown stays within the existing footprint and bounded triangle budget',()=>{
 const g=createLandscapeCrown();g.computeBoundingBox()
 expect((g.index?.count??g.getAttribute('position').count)/3).toBeLessThanOrEqual(120)
 expect(g.boundingBox!.max.y).toBeLessThanOrEqual(1.23)
 expect(g.boundingBox!.min.y).toBeGreaterThan(.2)
 expect(Math.max(Math.abs(g.boundingBox!.min.x),g.boundingBox!.max.x)).toBeLessThan(.55)
 g.dispose()
})
