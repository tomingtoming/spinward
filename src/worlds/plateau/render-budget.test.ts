import {test,expect} from 'bun:test'
import {BoxGeometry,Vector3,PerspectiveCamera,ArrayCamera} from 'three'
import {metroRenderBudget} from './render-budget.js'
import {BaseTiles} from './base-tiles.js'
import {FacadeInstances} from './facade-instances.js'
import {TileCoverage} from './tile-coverage.js'
import {MetroTiles,tileTexture} from './metro-tiles.js'

const sample={band:0,anchor:{local:[0,0]},bounds:[-1700,-20000,1700,20000]}
const tile=(id:string,x:number)=>({id,path:id,bounds:[x-1,-1,x+1,1],heightRange:[0,2],decodedBytes:48,tiles:[id]})
const payload=(id:string)=>[{name:'terrain',colour:'#fff',roughness:1,segments:[{tile:id,first:0,count:3}],attributes:{position:new Float32Array([0,0,0,1,0,0,0,1,0]),index:new Uint32Array([0,1,2])}}]

test('Quest near selection retains contact tiles and hysteresis, with independent far distance limits',async()=>{
  const budget=metroRenderBudget('quest'),close=tile('0-0',0),mid=tile('1-0',120),far=tile('2-0',1600)
  const base=new BaseTiles({radius:3200},sample,{tiles:[close,mid,far],overview:{decodedBytes:0}},[],{
    ...budget.near,farOptions:budget.far,fetchNear:async(t:any)=>payload(t.id)})
  base.coverage=new TileCoverage();base.setFarCatalog([close,far])
  const settle=async()=>{for(let i=0;i<100&&(base.running||base.farStream.running);i++)await Bun.sleep(5)}
  try{
    base.update(new Vector3(),{force:true});await settle()
    expect(base.diagnostics().resident).toEqual(['0-0'])
    expect(base.farStream.diagnostics().resident).toEqual(['0-0'])
    base.update(new Vector3(45,0,0),{force:true});await settle()
    expect(base.diagnostics().resident.sort()).toEqual(['0-0','1-0'])
    base.update(new Vector3(),{force:true});await settle()
    expect(base.diagnostics().resident).toContain('1-0')
    base.update(new Vector3(-100,0,0),{force:true});await settle()
    expect(base.diagnostics().resident).not.toContain('1-0')
    // Evicting detailed chunks leaves their overview ownership available.
    base.update(new Vector3(4000,0,0),{force:true});await settle()
    expect(base.coverage.value('0-0')).toBe(0)
    expect(base.diagnostics().nearDecodedBytes).toBe(0)
  }finally{base.dispose();base.coverage.dispose()}
})

test('default streaming still admits distant source chunks outside the Quest range',async()=>{
  const far=tile('0-0',4000),base=new BaseTiles({radius:3200},sample,{tiles:[far],farTiles:[far],overview:{decodedBytes:0}},[],{fetchNear:async()=>payload(far.id)})
  try{
    base.update(new Vector3(),{force:true})
    for(let i=0;i<100&&base.farStream.running;i++)await Bun.sleep(5)
    expect(base.farStream.diagnostics().resident).toEqual(['0-0'])
    expect(metroRenderBudget('desktop').flatOpenings).toBe(false)
    expect(metroRenderBudget('phone').flatOpenings).toBe(false)
  }finally{base.dispose()}
})

test('flat openings preserve authored instances and lighting while keeping entrances solid',()=>{
  const box=new BoxGeometry(1,1,1),prototype={positions:Array.from({length:box.attributes.position.count},(_,i)=>Array.from(box.attributes.position.array.slice(i*3,i*3+3))),normals:Array.from({length:box.attributes.normal.count},(_,i)=>Array.from(box.attributes.normal.array.slice(i*3,i*3+3))),
    stretch:Array(box.attributes.position.count*2).fill(0),roles:Array(box.attributes.position.count).fill(0),indices:Array.from(box.index!.array)}
  const kit={version:3,parts:Object.fromEntries(['window','glazing','entry','balcony','guard','trim','vent'].map(k=>[k,prototype]))}
  const rows=[{id:'office-budget',usage:'業務施設',seed:1,walls:[{a:[0,0],b:[18,0],length:18,normal:[0,-1],base:0,top:24,ground:[0,0,0],floors:8,roadDistance:3,projectionClearance:1.2}]}]
  const original=new FacadeInstances(kit,[{id:'0-0',buildings:rows}],{radius:3200},sample)
  const reduced=new FacadeInstances(kit,[{id:'0-0',buildings:rows}],{radius:3200},sample,{flatOpenings:true})
  try{
    expect(reduced.design).toEqual(original.design)
    let checked=0
    for(const chunk of reduced.chunks){
      const before=original.chunks.find((c:any)=>c.key===chunk.key)
      for(const m of chunk.near.filter((m:any)=>/-glazing-faces$|-window-faces$/.test(m.name))){
        const source=before.near.find((x:any)=>x.name===m.name.replace(/-faces$/,''))
        expect(source).toBeDefined();expect(m.count).toBe(source.count)
        expect(m.geometry.index.count).toBe(6);expect(source.geometry.index.count).toBe(36)
        expect(m.instanceMatrix.array).toEqual(source.instanceMatrix.array)
        expect(m.geometry.attributes.instanceLight.array).toEqual(source.geometry.attributes.instanceLight.array)
        expect(m.geometry.attributes.instanceDetail.array).toEqual(source.geometry.attributes.instanceDetail.array)
        const middle=chunk.mid.find((x:any)=>x.name===m.name.replace(/-faces$/,'-panel'))
        expect(middle.count).toBe(m.count);expect(middle.geometry.index.count).toBe(6);checked++
      }
      for(const m of chunk.near.filter((m:any)=>m.name.endsWith('-entry')))expect(m.geometry.index.count).toBe(36)
    }
    expect(checked).toBeGreaterThan(0)
    reduced.updateLOD(new Vector3());reduced.removeSite('0-0')
    expect(reduced.group.children).toHaveLength(0)
  }finally{original.dispose();reduced.dispose();box.dispose()}
})

test('overview chunks preserve every source triangle and share buffers, material and texture ownership',()=>{
  const a=payload('0-0')[0],b=payload('12-0')[0]
  const data={...a,segments:[a.segments[0],{...b.segments[0],first:3}],attributes:{
    position:new Float32Array([...a.attributes.position,...b.attributes.position.map((v,i)=>i%3===0?v+2400:v)]),index:new Uint32Array([0,1,2,3,4,5])}}
  const s={...sample,tiles:[tile('0-0',0),tile('12-0',2400)],overview:[],reliefM:[0,2]}
  const base=new MetroTiles({radius:3200},s,{tiles:s.tiles},[],{overviewTilesPerChunk:10})
  try{
    base.addOverview(data)
    expect(base.far).toHaveLength(3)
    const [whole,left,right]=base.far.map((f:any)=>f.mesh)
    expect(left.material).toBe(right.material)
    expect(left.geometry.attributes.position).toBe(right.geometry.attributes.position)
    expect([...base.far[1].indices,...base.far[2].indices]).toEqual([...data.attributes.index])
    expect(left.geometry.boundingSphere.radius).toBeLessThan(2)
    expect(left.geometry.boundingSphere.center.distanceTo(right.geometry.boundingSphere.center)).toBeGreaterThan(2000)
    const lod=base.group.children[0]
    base.group.updateMatrixWorld(true)
    const eye=(target:Vector3)=>{const c=new PerspectiveCamera(40,1,.1,10000);c.position.copy(target).add(new Vector3(0,0,10));c.lookAt(target);c.updateMatrixWorld();return c}
    const leftEye=eye(left.geometry.boundingSphere.center),rightEye=eye(right.geometry.boundingSphere.center)
    lod.update(leftEye);expect(left.parent.visible).toBe(true);expect(whole.parent.visible).toBe(false)
    lod.update(new ArrayCamera([leftEye,rightEye]));expect(left.parent.visible).toBe(false);expect(whole.parent.visible).toBe(true)
    // Atomic coverage updates continue to address the same original tile IDs.
    base.entries.get('12-0').status='resident';base.refreshFar()
    expect(left.geometry.drawRange.count).toBe(3);expect(right.visible).toBe(false)
    base.entries.get('12-0').status='unloaded';base.refreshFar()
    expect(right.visible).toBe(true);expect(right.geometry.drawRange.count).toBe(3)
  }finally{base.dispose()}
})

test('overview texture resizing releases the decoded source on success and failure',async()=>{
  const previous=globalThis.createImageBitmap;let closed=0,calls:any[]=[]
  const full={width:850,height:1000,close:()=>closed++},half={width:425,height:500,close:()=>{}}
  globalThis.createImageBitmap=(async(input:any,options:any)=>{calls.push(options);return input===full?half:full}) as any
  try{
    expect(await tileTexture(new Blob(),.5)).toBe(half);expect(closed).toBe(1)
    expect(calls[1]).toMatchObject({resizeWidth:425,resizeHeight:500,imageOrientation:'none'})
    expect(await tileTexture(new Blob())).toBe(full);expect(closed).toBe(1)
    globalThis.createImageBitmap=(async(input:any)=>{if(input===full)throw Error('decode');return full}) as any
    await expect(tileTexture(new Blob(),.5)).rejects.toThrow('decode');expect(closed).toBe(2)
  }finally{globalThis.createImageBitmap=previous}
})
