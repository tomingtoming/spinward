import { expect, test } from 'bun:test'
import { MetroRoads, metroRoadsMatchStudy, roadConnectorClear, type RoadNetwork } from './metroRoads'
import { metroSurfaceLocation } from './metroPlacement'
import { NeighborhoodJourney } from '../app/neighborhoodRoute'

const rectangle=(x:number,y:number,w:number,h:number)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]
const data:RoadNetwork={band:2,radius:3200,nodes:[[0,0,4],[10,0,4],[10,10,4],[20,10,4],[5,-5,0],[5,5,0]],
  edges:[[0,1,0,0],[1,2,1,0],[2,3,0,1],[4,5,0,0]],
  walkable:[[rectangle(-2,-7,24,19)]],places:[{id:'start',label:'Start',node:0},{id:'end',label:'End',node:3}]}
const start=(x:number,y:number,h=4)=>({...metroSurfaceLocation(2,x,y,3200),groundHeight:h})
test('structures and directions must use the same geographic band and crop',()=>{
  const study={radius:3200,span:40000,samples:[{id:'east',band:0,frame:{origin:[1,2]}}]}
  const roads={version:1,region:'east',band:0,radius:3200,span:40000,frames:[['east',0,{origin:[1,2]}]],bridges:[{band:0}]}
  expect(metroRoadsMatchStudy(roads,study)).toBe(true)
  expect(metroRoadsMatchStudy({...roads,bridges:[{band:2}]},study)).toBe(false)
  expect(metroRoadsMatchStudy({...roads,band:2,bridges:[{band:2}]},study)).toBe(false)
  expect(metroRoadsMatchStudy({...roads,frames:[]},study)).toBe(false)
})
test('source connectivity preserves the corner and marks crossings/bridges',()=>{
  const roads=new MetroRoads(data),route=roads.route(start(0,0),'end')!
  expect(route.at(-1)).toMatchObject(start(20,10))
  expect(route.some(p=>p.crosswalk)).toBe(true)
  expect(route.some(p=>p.riverWalk==='bridge')).toBe(true)
  expect(route.length).toBeGreaterThanOrEqual(4)
})
test('a crossing line at a different elevation is not an intersection or snapping target',()=>{
  const roads=new MetroRoads(data)
  expect(roads.route(start(5,-5,0),'end')).toBeNull()
  expect(roads.route({...start(0,0),azimuth:start(0,0).azimuth+2*Math.PI/3},'end')).toBeNull()
  expect(roads.route(start(5,0,50),'end')).toBeNull()
})
test('clear endpoints do not authorize a connector through a very thin wall or moat',()=>{
  const polygons=[[rectangle(0,0,20,20),rectangle(9.99,1,.02,18)]]
  expect(roadConnectorClear(polygons,[1,10],[19,10])).toBe(false)
  expect(roadConnectorClear(polygons,[1,.5],[19,.5])).toBe(true)
  expect(roadConnectorClear(polygons,[-1,10],[1,10])).toBe(false)
})
test('joining nearby streets fails closed when no clear connector exists',()=>{
  const roads=new MetroRoads({...data,walkable:[[rectangle(-1,-1,2,2)],[rectangle(9,9,2,2)]]})
  expect(roads.route(start(5,5),'end')).toBeNull()
})
test('selecting the current place reaches arrived instead of an empty active route',()=>{
  const journey=new NeighborhoodJourney(),route=new MetroRoads(data).route(start(0,0),'start')!
  journey.setRoute(route,false,'Start');journey.update(start(0,0),3200,.1)
  expect(journey.status).toBe('arrived')
})
