import { expect, test } from 'bun:test'
import { appendSettlementCorridor, planSettlementCore, settlementSite, settlementCharacter } from './settlementCorridor'
import type { CityPlan, CityRoad } from './cityLayout'
import { sampleStreetPath, streetPathSamples } from './streetPath'
import { StreetNetwork } from './streetNetwork'
import { StreetMarkingPlan } from './streetMarkings'

test('land centres determine the arterial, with a commercial circuit and residential branches',()=>{
  const site=settlementSite(),snapshot=JSON.stringify(site),plan=planSettlementCore(site,0,19.5),n=new StreetNetwork(plan.streets,3200)
  expect(plan.unconnected).toEqual([]);expect(plan.deferredLinks).toEqual([])
  expect(new Set(n.components).size).toBe(1)
  expect(new StreetMarkingPlan(n).junctions.every(j=>j.arms.length===3)).toBe(true)
  expect(plan.links).toHaveLength(1);expect(plan.links[0].id).toBe('market-connection');expect(plan.links[0].added).toBe(true)
  expect(plan.links[0].before).toBeGreaterThan(plan.links[0].after*1.5)
  expect(n.edges.length-n.nodes.length+1).toBe(1)
  const spine=plan.streets[0]
  for(const [i,c] of site.centres.entries()){
    const p=sampleStreetPath(spine,(i+1)/(spine.knots.length-1))
    expect(Math.hypot(p.x-c.point[0],p.y-c.point[1])).toBeLessThan(1e-6)
  }
  const samples=streetPathSamples(spine)
  expect(samples.every((p,i)=>!i||p.y>samples[i-1].y)).toBe(true)
  expect(planSettlementCore(site,0,19.5)).toEqual(plan);expect(JSON.stringify(site)).toBe(snapshot)
})

test('moving centres relocates the core, while shifting old minor streets only changes boundary approaches',()=>{
  const site=settlementSite(),changed={...site,centres:site.centres.map((c,i)=>({...c,point:[i?60:-80,i?420:-640] as [number,number]}))}
  expect(planSettlementCore(changed,0,19.5).streets[0].knots).not.toEqual(planSettlementCore(site,0,19.5).streets[0].knots)
  const migrate=(phase:number)=>{
    const main:CityRoad={id:'main',azimuth:0,axial:0,tangentWidth:19.5,axialLength:40000,kind:'arterial'}
    const roads=[main,...[-1,1].map(side=>({id:`outside-${side}`,azimuth:0,axial:site.axial+side*700+phase,tangentWidth:3100,axialLength:12,kind:'collector' as const}))]
    const city={roads,buildings:[],patches:[],trees:[],intersections:[]} as unknown as CityPlan
    return appendSettlementCorridor(city,roads,[],3200)!.district
  }
  const a=migrate(0),b=migrate(95),core=(d:typeof a)=>d.streets.filter(s=>!s.id.includes(':approach-'))
  expect(a.axial).toBe(site.axial);expect(a.width).toBe(site.width);expect(a.centres).toEqual(b.centres)
  expect(core(a)).toEqual(core(b));expect(a.streets).not.toEqual(b.streets)
})

test('district character follows the centres, and invalid through ordering is explicit',()=>{
  const site=settlementSite()
  expect(settlementCharacter(site,-210,-590)).toBe('centre');expect(settlementCharacter(site,235,570)).toBe('residential')
  const swapped={...site,centres:site.centres.map(c=>({...c,character:c.character==='centre'?'residential' as const:'centre' as const}))}
  expect(settlementCharacter(swapped,-210,-590)).toBe('residential')
  expect(()=>planSettlementCore({...site,centres:site.centres.map(c=>({...c,point:[c.point[0],0]}))},0,19.5)).toThrow('separated through stations')
})
