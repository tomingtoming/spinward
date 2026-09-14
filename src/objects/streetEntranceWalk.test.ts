import {expect,test} from 'bun:test'
import {Group} from 'three'
import {certifyEntranceWalk,type EntranceWalkSite} from './streetEntranceWalk'
import {buildEntranceWalkGeometry} from './streetEntranceWalkGeometry'
import {sampleCitySurface} from './citySurfaceMesh'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
import {routeOnEntranceWalk} from '../app/entranceWalkRoute'
import {StreetAccessLayer} from './streetAccessLayer'
import type {CityPlan} from './cityLayout'
const rect=(x0:number,y0:number,x1:number,y1:number)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x,y,u:0,v:0}))
const site=():EntranceWalkSite=>({id:'door',entrance:{x:0,y:0},normal:{x:0,y:1},width:2,startHeight:.12,maxGap:20,
  sidewalks:[{polygon:rect(-1000,10,1000,13),height:.32}],carriageways:[rect(-1000,13,1000,20)],allowed:[rect(-20,-1,20,25)],obstacles:[]})

test('a full-width entrance ends at the near sidewalk with a supported ramp and landing, not at the road centre',()=>{
  const input=site(),before=JSON.stringify(input),result=certifyEntranceWalk(input,3200)
  expect(result.rejected).toBeUndefined();const w=result.walk!
  expect(w.length).toBe(10);expect(w.landing).toEqual({x:0,y:10.7});expect(w.maximumGrade).toBeCloseTo(.02,8)
  for(const x of [-.9,0,.9])for(let y=0;y<=10;y+=.25)expect(sampleCitySurface(w.surfaceMesh,x,y)).toBeCloseTo(.12+y*.02,8)
  expect(sampleCitySurface(w.surfaceMesh,1.1,5)).toBe(0)
  expect(JSON.stringify(input)).toBe(before)
  expect(certifyEntranceWalk(input,3200)).toEqual(result)
})

test('missing width, a stepped footway edge and a road-side landing fail instead of snapping across',()=>{
  const gap=site();gap.sidewalks=[{polygon:rect(-20,10,-.01,13),height:.32},{polygon:rect(.01,10,20,13),height:.32}]
  expect(certifyEntranceWalk(gap,3200).rejected).toBe('no-footway')
  const stepped=site();stepped.sidewalks=[{polygon:rect(-20,8,0,11),height:.32},{polygon:rect(0,12,20,15),height:.32}]
  expect(certifyEntranceWalk(stepped,3200).rejected).toBe('split-footway')
  const narrow=site();narrow.sidewalks=[{polygon:rect(-20,10,20,10.8),height:.32}]
  expect(certifyEntranceWalk(narrow,3200).rejected).toBe('no-landing')
})

test('a thin crossing obstacle, carriageway, reserve edge or excessive grade rejects the whole entrance',()=>{
  const barrier=site();barrier.obstacles=[rect(-2,3,2,3.02)]
  expect(certifyEntranceWalk(barrier,3200).rejected).toBe('blocked')
  expect(certifyEntranceWalk({...site(),carriageways:barrier.obstacles},3200).rejected).toBe('blocked')
  expect(certifyEntranceWalk({...site(),allowed:[rect(-20,-1,.99,25)]},3200).rejected).toBe('outside-reserve')
  expect(certifyEntranceWalk({...site(),startHeight:1.5},3200).rejected).toBe('steep')
})

test('rotated entrances on a distant cylinder position keep render vertices identical to their grounding triangles',()=>{
  const angle=.72,c=Math.cos(angle),s=Math.sin(angle),x=1100,y=-17600,input=site()
  const transform=(p:ReturnType<typeof rect>)=>p.map(v=>({...v,x:x+c*v.x-s*v.y,y:y+s*v.x+c*v.y}))
  const result=certifyEntranceWalk({...input,entrance:{x,y},normal:{x:-s,y:c},sidewalks:input.sidewalks.map(p=>({...p,polygon:transform(p.polygon)})),
    carriageways:input.carriageways.map(transform),allowed:input.allowed.map(transform)},3200)
  expect(result.rejected).toBeUndefined();const w=result.walk!,g=buildEntranceWalkGeometry(w,3200),vertices=g.getAttribute('position')
  for(let i=0;i<vertices.count;i++){
    const j=i*3,az=w.source.azimuth+w.surfaceMesh[j]/3200,r=3200-w.surfaceMesh[j+2]
    expect(Math.hypot(vertices.getX(i)-Math.cos(az)*r,vertices.getY(i)-w.source.axial-w.surfaceMesh[j+1],vertices.getZ(i)-Math.sin(az)*r)).toBeLessThan(.002)
  }
  expect(w.maximumGrade).toBeCloseTo(.02,8);g.dispose()
  const plan:CityPlan={roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null,entranceWalks:[w]}
  const a={...w.source,groundHeight:.12},b={azimuth:w.landing.x/3200,axial:w.landing.y,groundHeight:w.landingHeight}
  for(const [start,goal]of [[a,b],[b,a]]){
    const route=planNeighborhoodRoute(plan,3200,start,goal,false)!
    expect(route).not.toBeNull()
    expect(route.length).toBeGreaterThan(2)
    for(let i=1;i<route.length;i++)for(let t=0;t<=1;t+=.05){
      const p=route[i-1],q=route[i],lx=((p.azimuth*(1-t)+q.azimuth*t)-w.source.azimuth)*3200,ly=p.axial*(1-t)+q.axial*t-w.source.axial
      const expected=Math.min(.32,.12+(lx*-s+ly*c)*.02)
      expect(p.groundHeight!*(1-t)+q.groundHeight!*t).toBeCloseTo(expected,6)
    }
  }
  expect(planNeighborhoodRoute(plan,3200,a,b,true)).toBeNull()
  expect(planNeighborhoodRoute(plan,3200,{...a,groundHeight:10},b,false)).toBeNull()
  expect(routeOnEntranceWalk([w],3200,a,{...b,axial:b.axial+50})).toBeUndefined()
  const layer=new StreetAccessLayer(new Group());layer.rebuild(plan,3200,w.source.azimuth,w.source.axial)
  expect(layer.group.children.filter(m=>m.name==='certified-entrance-door')).toHaveLength(1)
  layer.rebuild(plan,3200,w.source.azimuth,w.source.axial+1000)
  expect(layer.group.children).toHaveLength(0)
  layer.dispose()
})
