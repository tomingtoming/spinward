import {test,expect} from 'bun:test'
import {Matrix4} from 'three'
import {findRenderedSupport} from './rendered-support.mjs'

const roof=(height=10)=>({p:[100-height,.05,-1,100-height,1,-1,100-height,.05,1],i:[0,1,2],matrix:new Matrix4().elements})
const probe=(meshes:any[])=>({a:0,y:0,r:100,h:10,radial:89.685,meshes})
test('a rendered roof edge supports the finite sphere even when its centre ray misses',()=>{
 const result=findRenderedSupport(probe([roof()]))
 expect(result).not.toBeNull();expect(result!.lateralOffset).toBeCloseTo(.05,5)
 expect(result!.drawnHeight).toBeCloseTo(10,5);expect(result!.contactDistance).toBeLessThan(.34)
})
test('a missing roof cannot be replaced by a distant floor or a nearby wall',()=>{
 expect(findRenderedSupport(probe([roof(6)]))).toBeNull()
 expect(findRenderedSupport(probe([{p:[89,.05,-1,91,.05,-1,89,.05,1],i:[0,1,2],matrix:new Matrix4().elements}]))).toBeNull()
})
