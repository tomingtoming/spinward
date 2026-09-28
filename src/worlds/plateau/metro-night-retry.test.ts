import {expect,test} from 'bun:test'
import {MetroNight} from './metro-night.js'

function fixture(){
  const study={samples:[{id:'east',band:0},{id:'west',band:1}]}
  const manifest={bands:{east:{count:1,lamps:'east'},west:{count:1,lamps:'west'}}}
  const requests:string[]=[],fields:string[]=[];let fail=true
  const night=new MetroNight(study,manifest,{defer:true,loadFixtures:async(id:string)=>{
    requests.push(id)
    if(id==='west'&&fail)throw Error('temporary offline')
    return[{attributes:{instances:new Float32Array([0,0,0,0,1,0,1])}}]
  }})
  for(const [id,field] of night.fields)field.load=async()=>{fields.push(id);field.ready=true}
  return{night,requests,fields,recover:()=>{fail=false}}
}

test('night retries only incomplete bands, retaining fields and never duplicating fixtures',async()=>{
  const f=fixture()
  try{
    await f.night.start()
    expect(f.night.loaded).toBe(1);expect(f.night.failures).toHaveLength(1)
    expect(f.night.start()).toBeUndefined() // backoff does not poll the network every frame
    f.recover();await f.night.retry()
    expect(f.requests).toEqual(['east','west','west'])
    expect(f.fields).toEqual(['east','west'])
    expect(f.night.loaded).toBe(2);expect(f.night.count).toBe(2)
    expect(f.night.failures).toEqual([])
    await f.night.start();await f.night.retry()
    expect(f.requests).toHaveLength(3)
  }finally{f.night.dispose()}
})

test('night background retry is bounded and an explicit retry can recover after exhaustion',async()=>{
  const f=fixture()
  try{
    for(let i=0;i<5;i++){f.night.retryAt=0;await f.night.start()}
    expect(f.requests).toEqual(['east','west','west','west'])
    f.recover();await f.night.retry()
    expect(f.night.failures).toEqual([]);expect(f.night.count).toBe(2)
    f.night.dispose();await f.night.retry();expect(f.requests).toHaveLength(5)
  }finally{f.night.dispose()}
})
