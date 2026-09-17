import {beforeAll,expect,test} from 'bun:test'
import {bandReservePieces,planBandParcels} from './bandParcels'
import {proposedBandLand,bandRiverCentre} from './bandLand'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
import {bandLivingPlaces} from './bandLivingPlaces'
import {bandPublicPlaces} from './bandPublicPlaces'
import {planBandEntranceWalks} from './bandEntranceWalks'
import {getCityGroundHeight,type CityBuilding} from './cityLayout'
import {proposedBandExpressway} from './bandExpresswayLand'
import {planBandTransport} from './bandExpressway'
import {bandGraph,type BandPoint} from './bandStreetPlan'
import {landContains} from './streetParcels'
import {polygonArea,intersectStreetPolygons,containsStreetPolygon,positivePolygon,type StreetPolygon} from './streetPolygon'
import {buildStreetSurfaceGeometry} from './streetSurfaceGeometry'

const polygon=(p:BandPoint[])=>positivePolygon(p.map(([x,y])=>({x,y,u:0,v:0})))
const box=(p:StreetPolygon)=>({x0:Math.min(...p.map(v=>v.x)),x1:Math.max(...p.map(v=>v.x)),y0:Math.min(...p.map(v=>v.y)),y1:Math.max(...p.map(v=>v.y))})
const overlaps=(a:ReturnType<typeof box>,b:ReturnType<typeof box>)=>a.x0<b.x1&&a.x1>b.x0&&a.y0<b.y1&&a.y1>b.y0
const overlap=(a:StreetPolygon,b:StreetPolygon)=>polygonArea(intersectStreetPolygons(a,b))
let transport:ReturnType<typeof planBandTransport>,land:ReturnType<typeof planBandParcels>
beforeAll(()=>{transport=planBandTransport(proposedBandLand(),proposedBandExpressway());land=planBandParcels(transport.surface)},60000)

test('a concave reservation keeps its open bay and area in either winding',()=>{
  const polygon:BandPoint[]=[[0,0],[80,0],[80,20],[20,20],[20,80],[0,80]]
  for(const points of [polygon,[...polygon].reverse()]){
    const pieces=bandReservePieces({id:'concave',kind:'green',polygon:points})
    expect(pieces.reduce((n,p)=>n+polygonArea(p),0)).toBeCloseTo(2800,8)
    expect(pieces.some(p=>containsStreetPolygon(p,40,40))).toBe(false)
    expect(pieces.some(p=>containsStreetPolygon(p,10,60))).toBe(true)
  }
})

test('one band retains all three authored living parcels and connects their fixed gates',()=>{
  const graph=bandGraph(land.geometry.roads),surfaces=[...land.geometry.carriageways,...land.geometry.sidewalks].map(s=>s.polygon)
  expect(graph.components).toBe(1)
  expect(land.geometry.remaining).toEqual({sharp:[],short:[]})
  for(const place of bandLivingPlaces()){
    expect(graph.points.some(p=>Math.hypot(p[0]-place.access.point[0],p[1]-place.access.point[1])<1e-5)).toBe(true)
    expect(transport.surface.accessLinks.some(a=>a.access===place.access.id&&a.centre==='arrival'&&Number.isFinite(a.length))).toBe(true)
    for(const boundary of [place.footprint,place.parcel]){
      const p=polygon(boundary)
      for(const s of surfaces)if(overlaps(box(p),box(s)))expect(overlap(p,s)).toBeLessThan(1e-5)
      for(const r of transport.surface.site.reserves.filter(r=>r.id!==place.reserve.id))
        for(const s of bandReservePieces(r))if(overlaps(box(p),box(s)))expect(overlap(p,s)).toBeLessThan(1e-5)
    }
    expect(containsStreetPolygon(polygon(place.reserve.polygon),...place.entrance)).toBe(true)
  }
  // The retained crossing remains fixed while the proposal bends away from homes.
  expect(bandRiverCentre(1445.8064516129052)).toBeCloseTo(564.244684642744,8)
})

test('every whole-band block excludes concave reservations and the actual road and sidewalk surfaces',()=>{
  const obstacles=[...land.reserves,...land.geometry.carriageways.map(s=>s.polygon),...land.geometry.sidewalks.map(s=>s.polygon)]
    .map(p=>({p,b:box(p)}))
  for(const block of land.blocks)for(const p of block.pieces){
    const b=box(p)
    expect(b.x0).toBeGreaterThanOrEqual(-transport.surface.site.width/2-1e-6)
    expect(b.x1).toBeLessThanOrEqual(transport.surface.site.width/2+1e-6)
    expect(b.y0).toBeGreaterThanOrEqual(-transport.surface.site.length/2-1e-6)
    expect(b.y1).toBeLessThanOrEqual(transport.surface.site.length/2+1e-6)
    for(const other of obstacles)if(overlaps(b,other.b))expect(overlap(p,other.p)).toBeLessThan(1e-5)
  }
  expect(land.parcels.length).toBeGreaterThan(5000)
  expect(land.landArea).toBeLessThan(land.totalArea)
  expect(land.parcelArea+land.unallocatedArea).toBeCloseTo(land.landArea,4)
  expect(land.unallocatedArea).toBeGreaterThan(land.landArea*.5)
},30000)

test('every candidate fits its connected road-facing cell, and cells never own the same land twice',()=>{
  const pieces:{p:StreetPolygon;b:ReturnType<typeof box>;id:string}[]=[]
  const blocks=new Map(land.blocks.map(b=>[b.id,b])),streets=new Set(land.geometry.paths.map(p=>p.id))
  for(const p of land.parcels){
    expect(streets.has(p.front.streetId)).toBe(true)
    expect(p.pieces.some(s=>containsStreetPolygon(s,p.front.point.x,p.front.point.y))).toBe(true)
    for(const piece of p.pieces)for(const v of piece)
      expect(Math.abs((v.x-p.front.point.x)*Math.cos(p.front.heading)+(v.y-p.front.point.y)*Math.sin(p.front.heading))).toBeLessThanOrEqual(20.000001)
    const b=p.building,c=Math.cos(b.yaw),s=Math.sin(b.yaw)
    const foot=polygon(([-1,1] as const).flatMap(x=>([-1,1] as const).map(y=>[x,y] as BandPoint)).sort((a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]))
      .map(([x,y])=>[b.x+c*x*b.width/2-s*y*b.depth/2,b.y+s*x*b.width/2+c*y*b.depth/2] as BandPoint))
    expect(landContains(p.pieces,foot)).toBe(true)
    for(const piece of p.pieces){expect(landContains(blocks.get(p.blockId)!.pieces,piece)).toBe(true);pieces.push({p:piece,b:box(piece),id:p.id})}
  }
  pieces.sort((a,b)=>a.b.x0-b.b.x0)
  for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length&&pieces[j].b.x0<pieces[i].b.x1;j++){
    const a=pieces[i],b=pieces[j]
    if(a.id!==b.id&&overlaps(a.b,b.b))expect(overlap(a.p,b.p)).toBeLessThan(1e-5)
  }
},30000)

test('all three preserved doors join a near-side footway with continuous supported walking in both directions',()=>{
  for(const result of planBandEntranceWalks(land)){
    expect(result.rejected).toBeUndefined();const w=result.walk!,normal=result.place.normal
    const a={...w.source,groundHeight:.12},b={azimuth:w.landing.x/3200,axial:w.landing.y,groundHeight:w.landingHeight}
    const plan={roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null,entranceWalks:[w]}
    for(const [start,goal]of [[a,b],[b,a]])expect(planNeighborhoodRoute(plan,3200,start,goal,false)).not.toBeNull()
    expect(w.width).toBe(2);expect(w.maximumGrade).toBeLessThanOrEqual(.06)
    const near=land.geometry.sidewalks.filter(s=>overlaps(box(s.polygon),{x0:w.landing.x-4,x1:w.landing.x+4,y0:w.landing.y-4,y1:w.landing.y+4}))
    // Use the actual rendered sidewalk triangles. An unsplit polygon fan can
    // add 9 cm of cylinder chord height that the renderer's subdivision avoids.
    const paving:CityBuilding[]=near.map(s=>{
      const geometry=buildStreetSurfaceGeometry([s],3200,10)!,p=geometry.getAttribute('position'),indices=geometry.index!,mesh:number[]=[]
      for(let i=0;i<indices.count;i++){
        const v=indices.getX(i),x=p.getX(v),z=p.getZ(v)
        mesh.push(Math.atan2(z,x)*3200-w.entrance.x,p.getY(v)-w.entrance.y,3200-Math.hypot(x,z))
      }
      geometry.dispose()
      return{...w.collider,surfaceMesh:mesh}
    })
    for(const side of [-.65,0,.65])for(const reverse of [false,true]){
      let height=reverse?w.landingHeight:.12
      const length=Math.hypot(w.landing.x-w.entrance.x,w.landing.y-w.entrance.y),count=Math.ceil(length/.1)
      for(let i=0;i<=count;i++){
        const t=reverse?1-i/count:i/count,x=w.entrance.x+normal[0]*length*t+normal[1]*side,y=w.entrance.y+normal[1]*length*t-normal[0]*side
        const next=getCityGroundHeight([w.collider,...paving],3200,x/3200,y,height,.04)
        expect(next).toBeGreaterThanOrEqual(.119999)
        expect(Math.abs(next-height)).toBeLessThan(.04)
        expect(land.geometry.carriageways.some(s=>containsStreetPolygon(s.polygon,x,y))).toBe(false)
        height=next
      }
    }
  }
})

test('public destinations keep their actual land and connected gates before the band streets are generated',()=>{
  const graph=bandGraph(land.geometry.roads)
  for(const place of bandPublicPlaces()){
    const p=polygon(place.footprint)
    if(place.sharedReserve){
      const water=land.site.reserves.find(r=>r.id===place.sharedReserve)!
      expect(landContains(bandReservePieces(water),p)).toBe(true)
      expect(land.site.reserves.some(r=>r.id===place.reserve.id)).toBe(false)
      continue
    }
    expect(land.site.reserves.find(r=>r.id===place.reserve.id)).toEqual(place.reserve)
    for(const s of [...land.geometry.carriageways,...land.geometry.sidewalks])expect(overlap(p,s.polygon)).toBeLessThan(1e-5)
    for(const reserve of land.site.reserves.filter(r=>r.id!==place.reserve.id))
      for(const q of bandReservePieces(reserve))expect(overlap(p,q)).toBeLessThan(1e-5)
    for(const gate of place.accesses){
      expect(graph.points.some(q=>Math.hypot(q[0]-gate.point[0],q[1]-gate.point[1])<1e-5)).toBe(true)
      expect(transport.surface.accessLinks.some(l=>l.access===gate.id&&l.centre==='arrival'&&Number.isFinite(l.length))).toBe(true)
    }
  }
})
