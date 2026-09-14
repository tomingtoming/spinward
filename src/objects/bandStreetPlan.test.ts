import { expect, test } from 'bun:test'
import { bandGraph, clearBandSegment, insideBandReserve, nodeBandRoads, planBandStreets, type BandSite } from './bandStreetPlan'
import { proposedBandLand } from './bandLand'
import { StreetNetwork } from './streetNetwork'
import {refineBandRoads} from './bandStreetGeometry'

const small=():BandSite=>({id:'test',width:1000,length:1600,seed:42,localDemand:20,detourRatio:1.7,
  centres:[
    {id:'west-south',point:[-350,-600],reach:300,demand:1,use:'centre'},
    {id:'west-north',point:[-270,480],reach:300,demand:1,use:'housing'},
    {id:'east-south',point:[330,-500],reach:300,demand:1,use:'housing'},
    {id:'east-north',point:[290,580],reach:300,demand:1,use:'centre'}
  ],reserves:[{id:'water',kind:'water',polygon:[[-60,-810],[60,-810],[60,810],[-60,810]]}],
  crossings:[{id:'bridge',reserve:'water',from:[-60,170],to:[60,170]}]})

test('retained entrance frontages survive changed district routes and junction refinement',()=>{
  for(const shift of [-90,120]){
    const site=small();site.reserves=[];site.crossings=[];site.centres[0].point=[shift,-500]
    site.frontages=[{from:[-24,0],to:[24,0],kind:'arterial',frontage:'door',reason:'entrance'}]
    site.accesses=[{id:'door',point:[-24,0],serves:['west-south']}]
    const before=JSON.stringify(site),p=planBandStreets(site),final=refineBandRoads(p.roads,site)
    for(const roads of [p.roads,final.roads]){
      expect(bandGraph(roads).components).toBe(1)
      const retained=roads.filter(r=>r.frontage==='door')
      expect(retained.reduce((n,r)=>n+Math.hypot(r.to[0]-r.from[0],r.to[1]-r.from[1]),0)).toBeCloseTo(48,5)
      expect(retained.every(r=>Math.abs(r.from[1])+Math.abs(r.to[1])<1e-6&&r.kind==='arterial')).toBe(true)
    }
    expect(p.accessLinks[0].length).toBeGreaterThan(0);expect(JSON.stringify(site)).toBe(before)
  }
  const invalid=small();invalid.frontages=[{from:[-24,0],to:[24,0],kind:'arterial',frontage:'bad',reason:'through water'}]
  expect(()=>planBandStreets(invalid)).toThrow('Invalid retained frontage')
  const fixed={from:[-24,0],to:[24,0],kind:'collector',frontage:'fixed',reason:'entry'} as const
  const shared={...fixed,kind:'arterial',frontage:undefined} as const
  for(const roads of [[fixed,shared],[shared,fixed]]){
    const merged=nodeBandRoads(structuredClone(roads) as any)
    expect(merged).toHaveLength(1);expect(merged[0].kind).toBe('collector');expect(merged[0].frontage).toBe('fixed')
  }
})

test('concave reservations block every interior interval, including corner entry',()=>{
  const r={id:'bend',kind:'water' as const,polygon:[[-50,-400],[50,-400],[50,0],[250,0],[250,400],[150,400],[150,100],[-50,100]] as [number,number][]}
  expect(insideBandReserve([0,-200],r.polygon)).toBe(true)
  expect(insideBandReserve([100,-200],r.polygon)).toBe(false)
  expect(clearBandSegment([-100,-450],[300,450],[r])).toBe(false)
  expect(clearBandSegment([-100,-400],[-50,-400],[r])).toBe(true)
  expect(clearBandSegment([-50,-400],[25,-300],[r])).toBe(false)
  expect(clearBandSegment([60,-400],[60,-50],[r])).toBe(true)
})

test('shared and crossing road pieces are noded without manufacturing cycles',()=>{
  const roads=nodeBandRoads([
    {from:[0,0],to:[100,0],kind:'arterial',reason:'a'},
    {from:[25,0],to:[75,0],kind:'collector',reason:'shared'},
    {from:[50,-40],to:[50,40],kind:'collector',reason:'cross'},
    {from:[100,0],to:[100,50],kind:'collector',reason:'end'}
  ])
  const g=bandGraph(roads)
  expect(g.components).toBe(1);expect(g.cycles).toBe(0)
  expect(g.degree.filter(n=>n===4)).toHaveLength(1)
  expect(roads.filter(r=>r.from[1]===0&&r.to[1]===0).every(r=>r.kind==='arterial')).toBe(true)
})

test('bridge closure separates the banks instead of inventing a water crossing',()=>{
  const site=small(),open=planBandStreets(site),closed=planBandStreets({...site,crossings:[]})
  expect(open.unconnected).toEqual([]);expect(bandGraph(open.roads).components).toBe(1)
  expect(new Set(open.roads.filter(r=>r.bridge).map(r=>r.bridge))).toEqual(new Set(['bridge']))
  expect(closed.unconnected).toContain('east-north');expect(bandGraph(closed.roads).components).toBe(2)
  expect(closed.roads.every(r=>clearBandSegment(r.from,r.to,site.reserves))).toBe(true)
})

test('relocating a crossing reroutes access and changes the connecting tree',()=>{
  const site=small(),a=planBandStreets({...site,localDemand:0})
  const b=planBandStreets({...site,localDemand:0,crossings:[{id:'bridge',reserve:'water',from:[-60,-550],to:[60,-550]}]})
  expect(a.roads).not.toEqual(b.roads)
  expect(new Set(a.roads.map(r=>r.reason))).not.toEqual(new Set(b.roads.map(r=>r.reason)))
  for(const p of [a,b])expect(bandGraph(p.roads).components).toBe(1)
})

test('new land use changes demand distribution; generation is deterministic and does not mutate inputs',()=>{
  const site=small(),saved=structuredClone(site),a=planBandStreets(site),b=planBandStreets(site)
  expect(a).toEqual(b);expect(site).toEqual(saved)
  site.centres[0].demand=40
  const concentrated=planBandStreets(site)
  expect(concentrated.demand.filter(d=>d.centre==='west-south').length).toBeGreaterThan(a.demand.filter(d=>d.centre==='west-south').length)
  expect(concentrated.roads).not.toEqual(a.roads)
})

test('full physical land band connects every centre and uses only named bridge sites',()=>{
  const site=proposedBandLand(),plan=planBandStreets(site),graph=bandGraph(plan.roads)
  expect(site.length).toBeGreaterThan(39000);expect(site.width).toBeGreaterThan(3000)
  expect(plan.unconnected).toEqual([]);expect(plan.demand).toHaveLength(site.localDemand)
  expect(plan.unallocatedDemand).toBe(0)
  expect(graph.components).toBe(1);expect(graph.cycles).toBeGreaterThan(10)
  for(const c of site.centres)expect(graph.points.some(p=>Math.hypot(p[0]-c.point[0],p[1]-c.point[1])<.01)).toBe(true)
  for(const r of plan.roads){
    for(const p of [r.from,r.to]){expect(Math.abs(p[0])).toBeLessThanOrEqual(site.width/2+.01);expect(Math.abs(p[1])).toBeLessThanOrEqual(site.length/2+.01)}
    if(!r.bridge)expect(clearBandSegment(r.from,r.to,site.reserves)).toBe(true)
    else {
      const crossing=site.crossings.find(c=>c.id===r.bridge)!
      expect(crossing).toBeDefined()
      expect(r.from[1]).toBeCloseTo(crossing.from[1],5);expect(r.to[1]).toBeCloseTo(crossing.to[1],5)
      expect(r.from[0]).toBeGreaterThanOrEqual(crossing.from[0]-.01);expect(r.to[0]).toBeLessThanOrEqual(crossing.to[0]+.01)
    }
  }
  expect(plan.localLinks.length).toBeLessThanOrEqual(Math.ceil(site.localDemand*.12))
  for(const l of plan.localLinks)expect(l.before).toBeGreaterThan(l.after*2.1)
  const total=plan.roads.reduce((s,r)=>s+Math.hypot(r.to[0]-r.from[0],r.to[1]-r.from[1]),0)
  expect(total).toBeGreaterThan(site.length)
  expect(graph.degree.filter(n=>n===3).length).toBeGreaterThan(graph.degree.filter(n=>n===4).length)
  // Independent, existing application graph also sees the same meetings and
  // components. This is a centreline check, not validation of drivable bends.
  const physical=new StreetNetwork(plan.roads.map((r,i)=>{
    const tangent:[number,number]=[r.to[0]-r.from[0],r.to[1]-r.from[1]]
    return {id:`plan-${i}`,azimuth:0,axial:0,kind:r.kind,width:r.kind==='arterial'?19.5:12,level:0,groundHeight:0,
      knots:[{point:r.from,tangent},{point:r.to,tangent}]}
  }),3200)
  expect(new Set(physical.components).size).toBe(1)
  expect(physical.edges.length-physical.nodes.length+1).toBe(graph.cycles)
})

test('invalid or non-water crossing inputs fail explicitly',()=>{
  expect(()=>planBandStreets({...small(),localDemand:1001})).toThrow()
  expect(()=>planBandStreets({...small(),width:Infinity})).toThrow()
  expect(()=>planBandStreets({...small(),crossings:[{id:'bad',reserve:'water',from:[-80,0],to:[-65,10]}]})).toThrow('must cross')
  expect(()=>planBandStreets({...small(),crossings:[{id:'bad',reserve:'water',from:[0,0],to:[70,10]}]})).toThrow('inside')
})

test('demand that cannot fit in the available land remains explicit',()=>{
  const site=small();site.centres=site.centres.map(c=>({...c,reach:1}))
  const p=planBandStreets(site)
  expect(p.demand).toEqual([]);expect(p.unallocatedDemand).toBe(site.localDemand)
})
