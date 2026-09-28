import {test,expect} from 'bun:test'
import {releaseEndpoints} from './metro-release-network.mjs'

test('startup accounting includes the separate CDN and rejects lookalike origins and paths',()=>{
  const e=releaseEndpoints('https://app.example.test/','https://data.example.test/city/')
  expect(e.owns('https://app.example.test/assets/app.js')).toBe(true)
  expect(e.owns('https://data.example.test/city/objects/a.bin.gz')).toBe(true)
  for(const url of ['https://app.example.test.evil/a','https://data.example.test/city-other/a','https://analytics.example.test/a'])expect(e.owns(url)).toBe(false)
  expect(e.wire('objects/a.bin.gz')).toBe('https://data.example.test/city/objects/a.bin.gz')
  expect(releaseEndpoints('https://localhost:5320').dataRoot).toBe('https://localhost:5320/metro-data/')
})
