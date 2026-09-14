import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {bandPublicPlaces,captureBandPublicPlaces} from './bandPublicPlaces'

test('public-space contracts stay identical across inhabited quality budgets and cannot be moved by a caller',()=>{
  const expected=bandPublicPlaces()
  expect(expected.map(p=>p.walkingEntrances.length)).toEqual([1,1,4,4])
  expect(expected.flatMap(p=>p.walkingEntrances).every(p=>Number.isFinite(p.height)&&p.point.every(Number.isFinite))).toBe(true)
  for(const maxBuildings of [16000,18000,64000]){
    const city=planCity({radius:3200,length:40000,maxBuildings});rebuildNativeDistricts(city,3200)
    expect(captureBandPublicPlaces(city,3200)).toEqual(expected)
  }
  const copy=bandPublicPlaces();copy[0].reserve.polygon[0][0]+=100
  expect(bandPublicPlaces()).toEqual(expected)
},30000)

test('losing an existing destination fails the migration instead of silently dropping its contract',()=>{
  const city=planCity({radius:3200,length:40000,maxBuildings:16000})
  expect(()=>captureBandPublicPlaces({...city,patches:[]},3200)).toThrow('Existing public destinations')
})
