import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {buildingDesign,composeBuildingFacades,facadeFamily,facadeWallRoles} from './facade-design.js'
import {FacadeInstances,nativePartVertex} from './facade-instances.js'
import {Vector3} from 'three'

function row(usage='共同住宅',id='source-building-1'){
  return {id,usage,seed:123,style:1,walls:[
    {a:[0,0],b:[18,0],length:18,normal:[0,-1],base:0,top:24,ground:[0,0,0],roadDistance:2,floors:8},
    {a:[18,0],b:[18,12],length:12,normal:[1,0],base:0,top:24,ground:[0,0,0],roadDistance:10,floors:8},
    {a:[18,12],b:[0,12],length:18,normal:[0,1],base:0,top:24,ground:[0,0,0],roadDistance:14,floors:8},
  ]}
}
function withStyle(usage:string,style:string){
  for(let i=0;i<100;i++){const r=row(usage,'source-'+i);if(buildingDesign(r).style===style)return r}
  throw Error('Missing style '+style)
}

test('source usage distinguishes apartments, offices, shops and unsupported uses',()=>{
  expect(facadeFamily('共同住宅')).toBe('apartments')
  expect(facadeFamily('業務施設')).toBe('office')
  expect(facadeFamily('文教厚生施設')).toBe('civic')
  expect(facadeFamily('工場')).toBe('utility')
  expect(buildingDesign(row('店舗等併用共同住宅')).shop).toBe(true)
  for(let i=0;i<30;i++)expect(buildingDesign(row('共同住宅','tall-'+i)).shop).toBe(false)
  expect(composeBuildingFacades([row('不明')]).parts).toHaveLength(0)
})

test('street and side elevations differ; shopfronts never wrap blindly around the building',()=>{
  const r=row('店舗等併用共同住宅'),roles=facadeWallRoles(r.walls)
  expect(roles).toEqual(['entrance','side','rear'])
  const {parts}=composeBuildingFacades([r])
  expect(parts.filter(p=>p.purpose==='storefront').every(p=>p.wall===0&&p.floor===0)).toBe(true)
  const front=parts.filter(p=>p.wall===0&&p.purpose==='room'),side=parts.filter(p=>p.wall===1&&p.purpose==='service')
  expect(front.length).toBeGreaterThan(0);expect(side.length).toBeGreaterThan(0)
  expect(Math.max(...side.map(p=>p.width))).toBeLessThan(Math.min(...front.map(p=>p.width)))
})

test('two room windows share a household colour and repeat as storeys, not random noise',()=>{
  const r=withStyle('共同住宅','paired-flats'),a=composeBuildingFacades([r]),b=composeBuildingFacades([r])
  expect(a).toEqual(b)
  const pair=a.parts.filter(p=>p.wall===0&&p.floor===2&&p.bay===0)
  expect(pair).toHaveLength(2);expect(pair[0].colour).toBe(pair[1].colour)
  expect(pair[0].origin[2]).toBe(pair[1].origin[2])
  const side=a.parts.filter(p=>p.wall===1&&p.purpose==='service')
  expect(new Set(side.map(p=>p.bay)).size).toBe(1)
})

test('office styles produce distinct glazing proportions and architectural bands',()=>{
  const designs=['ribbon','piers','glazed'].map(style=>composeBuildingFacades([withStyle('業務施設',style)]))
  const rooms=designs.map(d=>d.parts.filter(p=>p.wall===0&&p.purpose==='room'))
  expect(rooms[2][0].height).toBeGreaterThan(rooms[0][0].height)
  expect(rooms[0][0].width).toBeGreaterThan(rooms[1][0].width)
  expect(designs[0].parts.some(p=>p.purpose==='course')).toBe(true)
  expect(designs[1].parts.some(p=>p.purpose==='pier')).toBe(true)
  expect(designs.every(d=>!d.parts.some(p=>p.kind==='guard'))).toBe(true)
})

test('guards only protect upper residential French windows; entrances stay at surveyed ground',()=>{
  const r=withStyle('共同住宅','french-guards');r.walls[0].ground=[1,1,1];(r.walls[0] as any).entryGround=1.2
  const {parts}=composeBuildingFacades([r]),guards=parts.filter(p=>p.kind==='guard')
  expect(guards.length).toBeGreaterThan(0)
  for(const p of guards){expect(p.floor).toBeGreaterThan(0);expect(p.wall).toBe(0);expect(p.origin[1]).toBeCloseTo(-.11)}
  expect(parts.find(p=>p.purpose==='entrance')!.origin[2]).toBe(1.2)
  for(const p of parts.filter(p=>['window','glazing'].includes(p.kind))){
    expect(p.origin[2]).toBeGreaterThanOrEqual(Math.max(...r.walls[p.wall].ground)+.2)
    expect(p.origin[2]+p.height).toBeLessThanOrEqual(r.walls[p.wall].top)
  }
})

test('stable identities survive tile regrouping and source attributes are not mutated',()=>{
  const a=row(),b=row('業務施設','office'),before=JSON.stringify([a,b])
  const together=composeBuildingFacades([a,b]),separate=[composeBuildingFacades([a]),composeBuildingFacades([b])]
  expect(together.parts).toEqual(separate.flatMap(d=>d.parts))
  expect(JSON.stringify([a,b])).toBe(before)
})

test('a small source/terrain datum difference raises storefront sills instead of deleting a shop floor',()=>{
  const r=row('店舗等併用共同住宅');r.walls[0].ground=[.4,.42,.45]
  const storefronts=composeBuildingFacades([r]).parts.filter(p=>p.purpose==='storefront')
  expect(storefronts.length).toBeGreaterThan(0)
  for(const p of storefronts){expect(p.origin[2]).toBeGreaterThanOrEqual(.67);expect(p.height).toBeGreaterThan(1.5)}
})

test('long horizontal courses follow the cylinder instead of cutting through the building',()=>{
  const r=withStyle('業務施設','ribbon');r.walls[0].b=[160,0];r.walls[0].length=160
  const strips=composeBuildingFacades([r]).parts.filter(p=>p.kind==='strip'&&p.wall===0)
  expect(strips.length).toBeGreaterThan(20)
  for(const p of strips)expect(p.width).toBeLessThanOrEqual(8)
})

// Real Blender-exported kit supplied by the build/QA command; unit tests remain
// runnable in a clean checkout without the external regional data volume.
if(process.env.SPINWARD_FACADE_KIT)test('Blender parts resize without negative sections and both LODs retain every opening',()=>{
  const kit=JSON.parse(readFileSync(process.env.SPINWARD_FACADE_KIT!,'utf8'))
  expect(kit.version).toBeGreaterThanOrEqual(2)
  const rows=[withStyle('共同住宅','french-guards'),withStyle('業務施設','glazed'),row('住宅','house')]
  const f=new FacadeInstances(kit,[],{radius:3200},{band:0,anchor:{local:[0,0]}})
  f.addSite('test',rows)
  for(const mesh of f.group.children)expect(Object.keys((mesh as any).geometry.attributes).length+5).toBeLessThanOrEqual(16)
  for(const p of f.design.parts){
    const proto=kit.parts[p.kind]
    for(let i=0;i<proto.positions.length;i++)expect(nativePartVertex(p,proto.positions[i],proto.stretch[i]).every(Number.isFinite)).toBe(true)
  }
  for(const lod of ['near','mid']){
    f.updateLOD(new Vector3(),lod)
    expect(f.group.children.filter(m=>m.visible).reduce((n,m)=>n+(m as any).count,0)).toBe(f.design.parts.filter(p=>lod==='near'||!p.nearOnly).length)
  }
  f.removeSite('test');expect(f.group.children.length).toBe(0);expect(f.design.parts.length).toBe(0);f.dispose()
})

if(process.env.SPINWARD_FACADE_KIT)test('source geometry controls visibility independently of facade style',()=>{
  const kit=JSON.parse(readFileSync(process.env.SPINWARD_FACADE_KIT!,'utf8'))
  const states=[]
  for(const style of ['ribbon','piers','glazed']){
    const r=withStyle('業務施設',style)
    const f=new FacadeInstances(kit,[{id:'view',buildings:[r]}],{radius:3200},{band:0,anchor:{local:[0,0]}})
    f.midRange=180;f.updateLOD(new Vector3(220,2,0))
    states.push(f.chunks.map(c=>({centre:c.centre.toArray(),radius:c.radius,reach:c.detailReach,level:c.level})))
    f.dispose()
  }
  expect(states[0]).toEqual(states[1]);expect(states[1]).toEqual(states[2]);expect(states[0][0].level).toBe('mid')
})
