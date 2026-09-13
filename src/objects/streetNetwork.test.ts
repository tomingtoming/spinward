import { expect, test } from 'bun:test'
import { StreetNetwork } from './streetNetwork'
import { legacyStreetPaths, sampleStreetPath, streetPathSamples, streetRibbon, type StreetPath } from './streetPath'
import { planCity } from './cityLayout'
import { planCurvedNeighborhood } from './curvedNeighborhood'

const r=3200
function line(id:string,a:[number,number],b:[number,number],level=0):StreetPath{
  const tangent:[number,number]=[b[0]-a[0],b[1]-a[1]]
  return{id,azimuth:0,axial:0,width:6,kind:'local',level,groundHeight:0,knots:[{point:a,tangent},{point:b,tangent}]}
}
function connectedNodes(n:StreetNetwork){
  const seen=new Set<number>(),components:number[][]=[]
  for(let i=0;i<n.nodes.length;i++)if(!seen.has(i)){
    const stack=[i],part:number[]=[];seen.add(i)
    while(stack.length){const id=stack.pop()!;part.push(id);for(const e of n.nodes[id].edges){const edge=n.edges[e],next=edge.from===id?edge.to:edge.from;if(!seen.has(next)){seen.add(next);stack.push(next)}}}
    components.push(part)
  }
  return components
}

test('skew crossings, T junctions and multiway nodes split connected road edges',()=>{
  for(const paths of [[line('a',[-30,0],[30,0]),line('b',[-20,-20],[20,20])],
    [line('a',[-30,0],[30,0]),line('b',[0,0],[20,20])],
    [line('a',[-30,0],[30,0]),line('b',[-20,-20],[20,20]),line('c',[0,0],[-20,20])]]){
    const n=new StreetNetwork(paths,r)
    expect(connectedNodes(n)).toHaveLength(1)
    expect(n.nodes.filter(p=>p.edges.length>2)).toHaveLength(1)
    expect(new Set(n.components).size).toBe(1)
    for(const edge of n.edges)expect(edge.length).toBeGreaterThan(0)
  }
})
test('an overpass, near miss and merely overlapping envelopes do not invent junctions',()=>{
  for(const b of [line('b',[-20,-20],[20,20],1),line('b',[0,1],[20,20]),line('b',[-30,1],[30,1])]){
    const n=new StreetNetwork([line('a',[-30,0],[30,0]),b],r)
    expect(connectedNodes(n)).toHaveLength(2);expect(new Set(n.components).size).toBe(2)
  }
})
test('collinear overlap and exact end connections join without closing the shared end',()=>{
  for(const start of [0,20]){
    const n=new StreetNetwork([line('a',[-20,0],[20,0]),line('b',[start,0],[40,0])],r)
    expect(connectedNodes(n)).toHaveLength(1)
    expect(n.closedEnds[0]).toEqual([true,false]);expect(n.closedEnds[1]).toEqual([false,true])
  }
  const duplicates=new StreetNetwork([line('a',[-20,0],[20,0]),line('b',[-20,0],[20,0])],r)
  expect(duplicates.closedEnds).toEqual([[true,true],[true,true]])
})
test('roads crossing the azimuth seam retain the same junction and metric length',()=>{
  const a={...line('a',[-20,0],[20,0]),azimuth:Math.PI}
  const b={...line('b',[0,-20],[0,20]),azimuth:-Math.PI}
  const n=new StreetNetwork([a,b],r)
  expect(connectedNodes(n)).toHaveLength(1)
  expect(n.nodes.filter(p=>p.edges.length===4)).toHaveLength(1)
  expect(n.edges.reduce((sum,e)=>sum+e.length,0)).toBeCloseTo(80,5)
})
test('curved sampling bounds both road edges, and ribbons use the exact metric normals',()=>{
  const p={...line('s',[0,0],[40,0]),width:20,knots:[{point:[0,0],tangent:[40,60]},{point:[40,0],tangent:[40,60]}]} as StreetPath
  const samples=streetPathSamples(p)
  expect(samples.length).toBeGreaterThan(20);expect(samples.length).toBeLessThan(300)
  for(let i=1;i<samples.length;i++)for(const offset of [-10,10]){
    const a=sampleStreetPath(p,samples[i-1].t,offset),b=sampleStreetPath(p,samples[i].t,offset)
    for(let f=0;f<=1;f+=.1){const t=samples[i-1].t+(samples[i].t-samples[i-1].t)*f,c=sampleStreetPath(p,t,offset);expect(Math.hypot(c.x-a.x-(b.x-a.x)*f,c.y-a.y-(b.y-a.y)*f)).toBeLessThan(.026)}
    const ribbon=streetRibbon(p,samples[i-1].t,samples[i].t,-10,10)
    expect(Math.hypot(ribbon[0].x-ribbon[3].x,ribbon[0].y-ribbon[3].y)).toBeCloseTo(20,8)
  }
  expect(streetPathSamples(line('long',[0,0],[0,40000]))).toHaveLength(2)
})
test('invalid identities, dimensions and coordinates fail before producing an invisible graph',()=>{
  const p=line('a',[0,0],[10,0])
  expect(()=>new StreetNetwork([p,p],r)).toThrow('identity')
  expect(()=>new StreetNetwork([{...p,width:NaN}],r)).toThrow()
  expect(()=>new StreetNetwork([line('zero',[0,0],[0,0])],r)).toThrow()
})
test('all three city strips and the curved street share native paths at each building budget',()=>{
  let signature=''
  for(const maxBuildings of [16000,18000,64000]){
    const city=planCity({radius:r,length:40000,maxBuildings}),curve=planCurvedNeighborhood(city,r)!
    const streets=[...legacyStreetPaths(city.roads),curve.street,...curve.streetLinks],n=new StreetNetwork(streets,r)
    expect(streets).toHaveLength(city.roads.length+3)
    expect(new Set(streets.map(s=>s.kind)).size).toBe(4)
    const garden=streets.findIndex(s=>s.id==='garden'),component=n.components[garden]
    for(const link of curve.streetLinks)expect(n.components[streets.indexOf(link)]).toBe(component)
    expect(streets.filter((s,i)=>n.components[i]===component&&s.kind==='arterial').length).toBeGreaterThan(1)
    const next=[n.streets.length,n.nodes.length,n.edges.length,new Set(n.components).size].join(':')
    if(signature)expect(next).toBe(signature);signature=next
    const graphParts=connectedNodes(n)
    expect(graphParts.length).toBe(new Set(n.components).size)
    expect(n.edges.every(e=>e.start>=0&&e.end<=1&&e.end>e.start&&e.length>0)).toBe(true)
  }
})
