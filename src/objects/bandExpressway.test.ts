import { expect, test } from 'bun:test'
import { proposedBandLand } from './bandLand'
import { proposedBandExpressway } from './bandExpresswayLand'
import { expressJourney, planBandTransport, reserveBandExpressway } from './bandExpressway'
import { bandGraph, clearBandSegment, insideBandReserve, planBandStreets } from './bandStreetPlan'

const site=proposedBandLand(),design=proposedBandExpressway(),planned=planBandTransport(site,design),fast=planned.expressway
const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1])

test('all seven IC gates have directed journeys both ways, including terminal and port access',()=>{
  expect(fast.interchanges).toHaveLength(7)
  for(const a of fast.interchanges)for(const b of fast.interchanges)if(a!==b) {
    const path=expressJourney(fast,a.node,b.node)!
    expect(path).not.toBeNull();expect(path.length).toBeGreaterThan(distance(a.gate,b.gate))
    let current=a.node
    for(const id of path.edges){const e=fast.edges.find(e=>e.id===id)!;expect(e.from).toBe(current);current=e.to}
    expect(current).toBe(b.node)
    expect(path.edges.every(id=>{const e=fast.edges.find(e=>e.id===id)!;return !e.kind.startsWith('ic-')||e.owner===a.id||e.owner===b.id})).toBe(true)
  }
  // Neither direction of the physical carriageways is left as a dead stub.
  for(const n of fast.nodes) {
    expect(fast.edges.some(e=>e.to===n.id)).toBe(true)
    expect(fast.edges.some(e=>e.from===n.id)).toBe(true)
  }
})

test('closing the JCT removes four branch movements, while through traffic and general roads remain',()=>{
  const closed=[fast.junction.id],port='gate:port-terminal'
  expect(fast.edges.filter(e=>e.owner===fast.junction.id)).toHaveLength(4)
  for(const gate of ['gate:south-terminal','gate:north-terminal']) {
    expect(expressJourney(fast,port,gate,closed)).toBeNull()
    expect(expressJourney(fast,gate,port,closed)).toBeNull()
  }
  for(const [a,b] of [['gate:south-terminal','gate:north-terminal'],['gate:north-terminal','gate:south-terminal']])expect(expressJourney(fast,a,b,closed)).not.toBeNull()
  expect(bandGraph(planned.surface.roads).components).toBe(1)
})

test('IC closure prevents transfer without interrupting the mainline',()=>{
  expect(expressJourney(fast,'gate:port-terminal','gate:arrival-ic',['arrival-ic'])).toBeNull()
  expect(expressJourney(fast,'gate:arrival-ic','gate:port-terminal',['arrival-ic'])).toBeNull()
  expect(expressJourney(fast,'gate:south-terminal','gate:north-terminal',['arrival-ic'])).not.toBeNull()
})

test('ramps meet their declared nodes and never implicitly connect crossing carriageways',()=>{
  expect(new Set(fast.nodes.map(n=>n.id)).size).toBe(fast.nodes.length)
  expect(new Set(fast.edges.map(e=>e.id)).size).toBe(fast.edges.length)
  for(const edge of fast.edges) {
    expect(distance(edge.points[0],fast.nodes.find(n=>n.id===edge.from)!.point)).toBeLessThan(.001)
    expect(distance(edge.points.at(-1)!,fast.nodes.find(n=>n.id===edge.to)!.point)).toBeLessThan(.001)
    expect(edge.length).toBeGreaterThan(0)
  }
  expect(planned.crossings.some(c=>!c.transfer)).toBe(true)
  for(const c of planned.crossings)if(!c.transfer) {
    expect(planned.surface.roads[c.road].underpass).toBeDefined()
    expect(fast.nodes.some(n=>distance(n.point,c.point)<.01)).toBe(false)
  }
})

test('reservations precede surface roads and demand, and IC frontage reaches each named district',()=>{
  const p=planned.surface
  expect(p.unconnected).toEqual([]);expect(p.unallocatedDemand).toBe(0)
  expect(bandGraph(p.roads).components).toBe(1)
  expect(p.accessLinks).toHaveLength(design.interchanges.reduce((s,i)=>s+i.serves.length,0)+(site.accesses??[]).reduce((s,a)=>s+a.serves.length,0))
  expect(p.accessLinks.find(l=>l.access==='south-terminal')!.length).toBeLessThan(4000)
  for(const d of p.demand)expect(fast.reserves.some(r=>insideBandReserve(d.point,r.polygon))).toBe(false)
  for(const r of p.roads) {
    const crossing=p.site.crossings.find(c=>c.id===(r.underpass??r.bridge))
    expect(clearBandSegment(r.from,r.to,p.site.reserves.filter(reserve=>reserve.id!==crossing?.reserve))).toBe(true)
  }
  for(const ic of fast.interchanges)expect(p.roads.some(r=>distance(r.from,ic.gate)<.01||distance(r.to,ic.gate)<.01)).toBe(true)
  const before=planBandStreets(site)
  expect(p.roads).not.toEqual(before.roads);expect(p.demand).not.toEqual(before.demand)
})

test('plan generation is deterministic and keeps the original land inputs untouched',()=>{
  const input=structuredClone(site),proposal=structuredClone(design)
  expect(reserveBandExpressway(input,proposal)).toEqual(fast)
  expect(input).toEqual(site);expect(proposal).toEqual(design)
})

test('IC redesign preserves each gate and served district while reserving its complete new road footprint',()=>{
  const old=structuredClone(design);old.interchanges.forEach(ic=>{ic.layout='direct'})
  const baseline=reserveBandExpressway(site,old)
  for(const ic of fast.interchanges){
    const before=baseline.interchanges.find(i=>i.id===ic.id)!
    expect(ic.gate).toEqual(before.gate);expect(ic.serves).toEqual(before.serves)
    const reserve=fast.reserves.find(r=>r.id==='ic:'+ic.id)!
    for(const e of fast.edges.filter(e=>e.owner===ic.id))for(const p of e.points)expect(insideBandReserve(p,reserve.polygon)||distance(p,ic.gate)<1e-6).toBe(true)
    for(let i=0;i<reserve.polygon.length;i++)expect(distance(reserve.polygon[i],reserve.polygon[(i+1)%reserve.polygon.length])).toBeGreaterThanOrEqual(1e-6)
  }
  const terminal=structuredClone(design);terminal.interchanges[0].layout='diamond'
  expect(()=>reserveBandExpressway(site,terminal)).toThrow('both approaches')
  const middle=structuredClone(design);middle.interchanges[1].layout='paired'
  expect(()=>reserveBandExpressway(site,middle)).toThrow('route end')
})

test('serving another already connected district reuses the IC approach instead of duplicating it',()=>{
  const land={...site,localDemand:0},extra=structuredClone(design)
  extra.interchanges.find(i=>i.id==='arrival-ic')!.serves.push('campus')
  const a=planBandTransport(land,design).surface,b=planBandTransport(land,extra).surface
  expect(b.roads).toEqual(a.roads)
  expect(b.accessLinks).toHaveLength(a.accessLinks.length+1)
  expect(b.accessLinks.find(l=>l.access==='arrival-ic'&&l.centre==='campus')!.length).toBeGreaterThan(0)
})

test('invalid bridge, IC overlap, protected land and out-of-band footprints fail explicitly',()=>{
  const bridge=structuredClone(design);bridge.routes[1].waterBridges=[]
  expect(()=>reserveBandExpressway(site,bridge)).toThrow('protected land')
  const overlap=structuredClone(design);overlap.interchanges[2].station=overlap.interchanges[1].station+200
  expect(()=>reserveBandExpressway(site,overlap)).toThrow('Overlapping')
  const out=structuredClone(design);out.routes[0].reservationWidth=1000
  expect(()=>reserveBandExpressway(site,out)).toThrow('outside land band')
  const displaced=structuredClone(site);displaced.centres[0].point=[1390,-15000]
  expect(()=>reserveBandExpressway(displaced,design)).toThrow('displaces')
  const bogus=structuredClone(design);bogus.interchanges[0].serves=['missing-centre']
  expect(()=>reserveBandExpressway(site,bogus)).toThrow('Invalid interchange')
})

test('underpasses do not permit arbitrary ground-level crossings of transport reserves',()=>{
  const blocked={...fast.surfaceSite,crossings:fast.surfaceSite.crossings.filter(c=>c.mode!=='underpass'),localDemand:0}
  const ground=planBandStreets(blocked)
  expect(ground.roads.every(r=>clearBandSegment(r.from,r.to,fast.reserves))).toBe(true)
  expect(ground.roads.every(r=>!r.underpass)).toBe(true)
})
