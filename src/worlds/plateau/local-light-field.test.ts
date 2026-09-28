import {test,expect} from 'bun:test'
import {bakeLocalLight,LOCAL_LIGHT_SIZE as S} from './local-light-field.js'
test('local light follows fixed sources and storefronts cannot illuminate behind their wall',()=>{
  const data=new Uint8Array(S*S*4),work=new Float32Array(S*S*3),read=(x:number,y:number)=>data[(y*S+x)*4]
  bakeLocalLight(data,work,[0,0],[{x:100.5,y:100.5,radius:8,colour:[.1,.05,.02],normal:[1,0],width:3,height:2}])
  expect(read(103,100)).toBeGreaterThan(10);expect(read(97,100)).toBe(0);expect(read(120,100)).toBe(0)
  bakeLocalLight(data,work,[8,0],[{x:100.5,y:100.5,radius:8,colour:[.1,.05,.02],normal:[1,0],width:3,height:2}])
  expect(read(95,100)).toBeGreaterThan(10);expect(read(89,100)).toBe(0)
  bakeLocalLight(data,work,[0,0],[]);expect(read(95,100)).toBe(0)
})
