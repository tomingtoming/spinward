import {test,expect} from 'bun:test'
import {BaseTiles} from './base-tiles.js'

test('a required near tile can recover after three failures without leaving its district',async()=>{
  let offline=true,requests=0
  const data=[{name:'terrain',colour:'#fff',roughness:1,attributes:{position:new Float32Array([0,0,0,1,0,0,0,1,0]),index:new Uint32Array([0,1,2])}}]
  const tile={id:'arrival',decodedBytes:48,bounds:[0,0,1,1]}
  const base=new BaseTiles({radius:3200},{band:0},{tiles:[tile],overview:{decodedBytes:0}},[],{fetchNear:async()=>{requests++;if(offline)throw Error('503');return data}})
  const e=base.entries.get(tile.id);e.wanted=true;e.distance=0
  const settled=async()=>{for(let n=0;n<100&&base.running;n++)await Bun.sleep(5);expect(base.running).toBe(0)}
  try{
    for(let n=0;n<3;n++){e.nextTry=0;base.pump();await settled()}
    expect(requests).toBe(3);expect(base.ready).toBe(false)
    offline=false;base.pump();await settled();expect(requests).toBe(3)
    base.retry();await settled()
    expect(requests).toBe(4);expect(base.ready).toBe(true)
    expect(base.group.children).toHaveLength(1)
    base.retry();await settled();expect(requests).toBe(4)
  }finally{base.dispose()}
})
