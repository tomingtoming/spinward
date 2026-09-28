import {test,expect} from 'bun:test'
import {frontageLight} from './frontage-light.js'

test('spill belongs to the source opening and inherits its occupancy and temperature',()=>{
  const part={id:'shop',wall:1,bay:2,purpose:'storefront',kind:'glazing',origin:[10,20,4],u:[0,1],width:3,height:2,light:{colour:'#fff0db',strength:.28}}
  const light=frontageLight(part)
  expect(light).toMatchObject({origin:[10.16,20,5.3],colour:'#fff0db',strength:.28,radius:8})
  expect(light.normal[0]).toBeCloseTo(1);expect(light.normal[1]).toBeCloseTo(0)
  expect(frontageLight({...part,light:{...part.light,strength:0}})).toBeNull()
  expect(frontageLight({...part,purpose:'room',floor:5})).toBeNull()
  expect(frontageLight({...part,purpose:'station-clerestory'})).toBeNull()
  expect(frontageLight({...part,purpose:'station-hall-glazing'}).radius).toBe(12)
})
