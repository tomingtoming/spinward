import {expect,test} from 'bun:test'
import {planLocalStreetLinks} from './localStreetLinks'
import {StreetNetwork} from './streetNetwork'
import type {StreetPath} from './streetPath'
const rect=(x0:number,y0:number,x1:number,y1:number)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x,y,u:0,v:0}))
const network=(height=400,angle=0)=>{
 const rotate=([x,y]:number[]):[number,number]=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]
 const points=[[-200,0],[-200,height],[200,height],[200,0]].map(rotate)
 const roads:StreetPath[]=points.slice(1).map((b,i)=>{const a=points[i],tangent:[number,number]=[b[0]-a[0],b[1]-a[1]];return{id:`u-${i}`,azimuth:0,axial:0,kind:'local',width:6,level:0,groundHeight:0,knots:[a,b].map(point=>({point,tangent}))}})
 return new StreetNetwork(roads,3200)
}
const site={areas:[rect(-800,-800,800,800)],reserves:[],eligible:()=>true,maximumLength:650,minimumDetour:1.8,limit:4}
test('local links reduce a real road detour without changing when the site rotates',()=>{
 for(const angle of [0,.37,-.8]){
  const links=planLocalStreetLinks(network(400,angle),site)
  expect(links).toHaveLength(1);expect(links[0].before).toBeCloseTo(1200,5);expect(links[0].after).toBeCloseTo(400,5)
  expect(links[0].path.kind).toBe('local');expect(links[0].path.width).toBe(6)
 }
 expect(planLocalStreetLinks(network(20),site)).toEqual([])
})
test('local links protect the full pavement width and holes in available land',()=>{
 // This reservation touches only the footway, not the centreline or car lane.
 expect(planLocalStreetLinks(network(),{...site,reserves:[rect(-20,4.2,20,7)]})).toEqual([])
 expect(planLocalStreetLinks(network(),{...site,areas:[rect(-800,-800,-20,800),rect(20,-800,800,800)]})).toEqual([])
})
