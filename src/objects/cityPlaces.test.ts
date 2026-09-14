import {expect,test} from 'bun:test'
import {planCity,type CityPlan} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {preserveCityPlaces} from './cityPlaces'
import {planPublicPark} from './publicPark'
import {planPublicUnderpass} from './publicUnderpass'
import {planCurvedNeighborhood} from './curvedNeighborhood'
import {planRiverDistrict,riverRoadGeometry} from './riverDistrictPlan'
import {bandPublicPlaces,captureBandPublicPlaces} from './bandPublicPlaces'

const selectors=[planPublicPark,planPublicUnderpass,planCurvedNeighborhood,planRiverDistrict] as const
const empty=():CityPlan=>({roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null})

for(const maxBuildings of [16000,18000,64000])test(`inhabited places survive retired source roads and land at budget ${maxBuildings}`,()=>{
  const city=planCity({radius:3200,length:40000,maxBuildings});rebuildNativeDistricts(city,3200)
  const originals=selectors.map(select=>select(city,3200))
  expect(originals.every(Boolean)).toBe(true)
  const places=preserveCityPlaces(city,3200),contracts=captureBandPublicPlaces(city,3200)
  expect(contracts).toEqual(bandPublicPlaces())
  expect(selectors.map(select=>select(city,3200))).toEqual(originals)
  const bridge=riverRoadGeometry(places.river!,3200).point(0,4,.34)
  const mesh=places.river!.colliders.find(c=>c.surfaceMesh)!.surfaceMesh!
  const firstTriangle=mesh.slice(0,9)
  // Test input mutation as well as wholesale replacement: retained connection
  // descriptors must not still alias the mutable source roads or patches.
  for(const road of city.roads)road.azimuth+=.02
  for(const patch of city.patches)patch.axial+=50
  city.roads=[];city.patches=[];city.trees=[];city.buildings=[];city.expressway=null
  expect(selectors.map(select=>select({...city,places:undefined},3200))).toEqual([null,null,null,null])
  expect(preserveCityPlaces(city,3200)).toBe(places)
  expect(selectors.map(select=>select(city,3200))).toEqual([places.park,places.covered,places.garden,places.river])
  expect(captureBandPublicPlaces(city,3200)).toEqual(contracts)
  expect(riverRoadGeometry(places.river!,3200).point(0,4,.34)).toEqual(bridge)
  expect(mesh.slice(0,9)).toEqual(firstTriangle)
  expect(places.covered!.paths.length).toBeGreaterThan(0)
  expect(places.garden!.colliders.length).toBeGreaterThan(0)
},30000)

test('retained absence, habitat scope and city ownership are explicit',()=>{
  const a=empty(),b=empty(),places=preserveCityPlaces(a,3200)
  expect(selectors.map(select=>select(a,3200))).toEqual([null,null,null,null])
  expect(preserveCityPlaces(a,3200)).toBe(places)
  expect(preserveCityPlaces(b,3200)).not.toBe(places)
  expect(()=>preserveCityPlaces(a,3100)).toThrow('different habitat radius')
  for(const select of selectors)expect(()=>select(a,3100)).toThrow('different habitat radius')
  expect(a.roads).toEqual([])
})
